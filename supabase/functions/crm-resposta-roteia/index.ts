// crm-resposta-roteia (v1) — o CRM chama aqui quando um cliente RESPONDE, e a gente atribui o
// contato a assistente certa.
//
// Por que nao um workflow do GHL: o workflow sabe atribuir a um usuario fixo ou fazer round-robin.
// Ele nao sabe QUAL assistente atende aquele cliente — isso esta no ERP: o cliente tem um
// representante (codvend), o representante tem uma assistente (rep_instancia, vinda do CODGER do
// Sankhya por ID). Entao o workflow so avisa, e a decisao fica aqui, onde o dado existe.
//
// Isso NAO reintroduz o workflow antigo que a gestao tirou. Aquele trocava o dono a cada mensagem,
// conforme a instancia, e por isso o contato sumia da vista da outra assistente. Aqui o dono muda uma
// vez, no momento em que o cliente responde, e muda para quem de fato atende aquele cliente.
//
// POST (webhook do GHL) { contact_id | contactId | id, phone?, ... }
// POST { seco:true, ... } -> so diz para quem iria, sem escrever no CRM
//
// Resolucao: telefone -> codparc (snap_contato/ghl_contato) -> codvend (sankhya_carteira) ->
//            instancia (rep_instancia) -> usuario_ghl_id (instancia_ghl) -> PUT assignedTo.
// Sem dono conhecido, NAO mexe: melhor a resposta ficar onde esta do que ir para a pessoa errada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const nf = (s: any) => digits(s).replace(/^0+/, "").replace(/^55/, "");
function variantes(fone: any): string[] {
  const d = nf(fone); if (d.length < 10) return [];
  const out = new Set<string>([d]);
  if (d.length === 10) out.add(d.slice(0, 2) + "9" + d.slice(2));
  if (d.length === 11 && d[2] === "9") out.add(d.slice(0, 2) + d.slice(3));
  return [...out];
}
const API = "https://services.leadconnectorhq.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
function ghl(method: string, path: string, body?: any) {
  return fetch(API + path, { method, headers: { "Authorization": "Bearer " + Deno.env.get("GHL_TOKEN"), "Version": "2021-07-28", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA }, body: body ? JSON.stringify(body) : undefined });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    // o webhook do GHL varia de forma conforme o gatilho; aceita as que aparecem
    const contactId = String(b.contact_id || b.contactId || b.id || b?.contact?.id || "").trim();
    let fone = String(b.phone || b.Phone || b?.contact?.phone || "").trim();
    const registrar = async (o: any) => { await sb.from("resposta_roteada").insert({ contact_id: contactId || "(sem id)", fone: fone || null, payload: b, ...o }); return j({ ok: o.acao !== "erro", ...o }); };

    if (!contactId) return registrar({ acao: "erro", motivo: "webhook sem contact_id" });

    // sem telefone no payload, busca no proprio contato
    if (!fone) {
      const r = await ghl("GET", `/contacts/${contactId}`);
      if (r.ok) { const d = await r.json().catch(() => ({})); fone = String(d?.contact?.phone || ""); }
    }
    if (!fone) return registrar({ acao: "sem_dono_conhecido", motivo: "contato sem telefone — nao da para achar o cliente no ERP" });

    const vs = variantes(fone);
    if (!vs.length) return registrar({ acao: "sem_dono_conhecido", motivo: "telefone curto demais: " + fone });

    // telefone -> codparc. Filtra no banco pelos 8 ultimos digitos (o numero local), porque o `fone`
    // esta gravado em formatos variados e igualdade exata nao casa; depois confere de verdade com nf().
    let codparc: number | null = null;
    const finais = Array.from(new Set(vs.map((v) => v.slice(-8)).filter((x) => x.length === 8)));
    for (const tab of ["snap_contato", "ghl_contato"]) {
      for (const f8 of finais) {
        const { data } = await sb.from(tab).select("codparc,fone").ilike("fone", "%" + f8 + "%").limit(50);
        const achou = (data || []).find((c: any) => vs.includes(nf(c.fone)));
        if (achou) { codparc = Number(achou.codparc); break; }
      }
      if (codparc) break;
    }
    if (!codparc) return registrar({ acao: "sem_dono_conhecido", motivo: "telefone nao casa com nenhum contato de cliente na base" });

    // codparc -> codvend -> instancia
    const { data: cart } = await sb.from("sankhya_carteira").select("codparc,codvend,nome_parc").eq("codparc", codparc).maybeSingle();
    const codvend = cart?.codvend ? Number(cart.codvend) : null;
    if (!codvend) return registrar({ acao: "sem_dono_conhecido", codparc, motivo: "cliente sem representante na carteira do Sankhya" });

    const { data: ri } = await sb.from("rep_instancia").select("codvend,rep,instancia").eq("codvend", codvend).maybeSingle();
    const instancia = ri?.instancia || null;
    if (!instancia) return registrar({ acao: "sem_dono_conhecido", codparc, codvend, rep: ri?.rep || null, motivo: "representante sem assistente com instancia ativa" });

    const { data: inst } = await sb.from("instancia_ghl").select("instancia,usuario_ghl_id").eq("instancia", instancia).eq("ativa", true).maybeSingle();
    const uid = inst?.usuario_ghl_id || null;
    if (!uid) return registrar({ acao: "erro", codparc, codvend, rep: ri?.rep, instancia, motivo: "instancia sem usuario_ghl_id no cadastro" });

    // ja e dele?
    const rc = await ghl("GET", `/contacts/${contactId}`);
    const dc = rc.ok ? await rc.json().catch(() => ({})) : {};
    if (String(dc?.contact?.assignedTo || "") === uid) {
      return registrar({ acao: "ja_era_dele", codparc, codvend, rep: ri?.rep, instancia, usuario_ghl_id: uid });
    }
    if (b.seco === true) return registrar({ acao: "seco", codparc, codvend, rep: ri?.rep, instancia, usuario_ghl_id: uid, motivo: "modo seco — nada gravado no CRM" });

    const r = await ghl("PUT", `/contacts/${contactId}`, { assignedTo: uid });
    if (!r.ok) return registrar({ acao: "erro", codparc, codvend, rep: ri?.rep, instancia, usuario_ghl_id: uid, motivo: "PUT " + r.status + ": " + (await r.text()).slice(0, 200) });
    return registrar({ acao: "atribuido", codparc, codvend, rep: ri?.rep, instancia, usuario_ghl_id: uid });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
