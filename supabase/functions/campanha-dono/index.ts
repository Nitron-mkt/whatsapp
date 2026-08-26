// campanha-dono (v1) — empresta e devolve a propriedade dos contatos de uma campanha de cliente.
//
// Por que existe: o numero de WhatsApp que o cliente ve e o do usuario remetente, e numa mensagem de
// API o remetente e o assignedTo do contato. Testamos `fromNumber` em 26/08 com o numero novo: o GHL
// IGNORA — a mensagem foi gravada com o userId da dona do contato. Logo, para a campanha sair pelo
// numero dela, a instancia de campanha tem de ser dona do contato no momento do envio.
//
// Isso e um EMPRESTIMO, nao uma troca de carteira: o dono anterior fica guardado em
// campanha_dono_emprestado e `devolver` recoloca cada um no lugar. Sem esse registro, devolver seria
// adivinhar — e foi exatamente esse tipo de troca cega que a gestao tirou do CRM.
//
// POST { acao:"assumir", fones:[...], campanha? }  -> passa os contatos para a instancia de cliente
// POST { acao:"devolver", campanha? }              -> devolve todos os emprestados em aberto
// POST { acao:"varrer" }                           -> quem RESPONDEU volta para a assistente certa
// Qualquer uma aceita { seco:true } para so relatar.
//
// `varrer` cobre o periodo em que ainda nao existe o workflow no CRM: pergunta ao GHL quais conversas
// da instancia de campanha tem a ULTIMA mensagem de entrada e devolve esses contatos, cada um para a
// assistente do representante daquele cliente (via crm-resposta-roteia). Cliente que respondeu nao
// pode ficar esperando numa caixa que ninguem atende.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const nf = (s: any) => digits(s).replace(/^0+/, "").replace(/^55/, "");
function e164(f: any): string { const d = digits(f); if (!d) return ""; return d.length <= 11 ? "+55" + d : "+" + d; }
function variantes(fone: any): string[] {
  const d = nf(fone); if (d.length < 10) return [];
  const out = new Set<string>([d]);
  if (d.length === 10) out.add(d.slice(0, 2) + "9" + d.slice(2));
  if (d.length === 11 && d[2] === "9") out.add(d.slice(0, 2) + d.slice(3));
  return [...out];
}
const API = "https://services.leadconnectorhq.com";
const LOC = "rZ8y7lzqV7fzxsartaX2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
function ghl(method: string, path: string, body?: any) {
  return fetch(API + path, { method, headers: { "Authorization": "Bearer " + Deno.env.get("GHL_TOKEN"), "Version": "2021-07-28", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA }, body: body ? JSON.stringify(body) : undefined });
}
async function acharPorFone(fone: string): Promise<any> {
  for (const v of variantes(fone)) {
    for (const q of [e164(v), v]) {
      try {
        const r = await ghl("GET", `/contacts/?locationId=${LOC}&query=${encodeURIComponent(q)}&limit=1`);
        if (!r.ok) continue;
        const d = await r.json();
        const c = (d?.contacts || [])[0];
        if (c?.id) return c;
      } catch { /* tenta a proxima forma */ }
    }
  }
  return null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const acao = String(b.acao || "").trim();
    const seco = b.seco === true;
    const campanha = b.campanha ? String(b.campanha) : null;
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");

    // a instancia de campanha e a de escopo cliente, ativa
    const { data: instCli } = await sb.from("instancia_ghl").select("instancia,usuario_ghl_id").eq("ativa", true).eq("escopo", "cliente").order("instancia").limit(1).maybeSingle();
    if (!instCli?.usuario_ghl_id) return j({ ok: false, erro: "nenhuma instancia de escopo 'cliente' ativa com usuario_ghl_id no cadastro" }, 400);
    const alvo = String(instCli.usuario_ghl_id);

    if (acao === "assumir") {
      const fones: string[] = Array.isArray(b.fones) ? b.fones.map((x: any) => String(x)) : [];
      if (!fones.length) return j({ ok: false, erro: "sem fones" }, 400);
      const out: any[] = [];
      for (const f of fones) {
        const c = await acharPorFone(f);
        if (!c?.id) { out.push({ fone: f, acao: "nao_achei_no_crm" }); continue; }
        const antes = String(c.assignedTo || "") || null;
        if (antes === alvo) { out.push({ fone: f, contato: c.id, acao: "ja_era_da_campanha" }); continue; }
        if (seco) { out.push({ fone: f, contato: c.id, acao: "assumiria", dono_antes: antes }); continue; }
        const r = await ghl("PUT", `/contacts/${c.id}`, { assignedTo: alvo });
        if (!r.ok) { out.push({ fone: f, contato: c.id, acao: "erro", motivo: "PUT " + r.status }); continue; }
        await sb.from("campanha_dono_emprestado").upsert(
          { contact_id: c.id, fone: f, dono_antes: antes, dono_depois: alvo, campanha },
          { onConflict: "contact_id", ignoreDuplicates: false },
        );
        out.push({ fone: f, contato: c.id, acao: "assumido", dono_antes: antes });
      }
      const cont: Record<string, number> = {}; out.forEach((o) => cont[o.acao] = (cont[o.acao] || 0) + 1);
      return j({ ok: true, acao, seco, instancia: instCli.instancia, total: out.length, contagem: cont, itens: out });
    }

    if (acao === "devolver") {
      let q = sb.from("campanha_dono_emprestado").select("*").is("devolvido_em", null);
      if (campanha) q = q.eq("campanha", campanha);
      const { data: abertos, error } = await q; if (error) throw error;
      const out: any[] = [];
      for (const e of (abertos || [])) {
        if (seco) { out.push({ contato: e.contact_id, acao: "devolveria", para: e.dono_antes }); continue; }
        // sem dono anterior nao ha para onde devolver sem inventar; a varredura resolve pelo ERP
        if (!e.dono_antes) { out.push({ contato: e.contact_id, acao: "sem_dono_anterior" }); continue; }
        const r = await ghl("PUT", `/contacts/${e.contact_id}`, { assignedTo: e.dono_antes });
        if (!r.ok) { out.push({ contato: e.contact_id, acao: "erro", motivo: "PUT " + r.status }); continue; }
        await sb.from("campanha_dono_emprestado").update({ devolvido_em: new Date().toISOString(), devolvido_para: e.dono_antes }).eq("id", e.id);
        out.push({ contato: e.contact_id, acao: "devolvido", para: e.dono_antes });
      }
      const cont: Record<string, number> = {}; out.forEach((o) => cont[o.acao] = (cont[o.acao] || 0) + 1);
      return j({ ok: true, acao, seco, total: out.length, contagem: cont, itens: out });
    }

    if (acao === "varrer") {
      // conversas da instancia de campanha cuja ULTIMA mensagem e de ENTRADA = cliente respondeu
      const r = await ghl("GET", `/conversations/search?locationId=${LOC}&assignedTo=${alvo}&lastMessageDirection=inbound&limit=100`);
      if (!r.ok) return j({ ok: false, erro: "conversations/search " + r.status + ": " + (await r.text()).slice(0, 200) }, 502);
      const d = await r.json().catch(() => ({}));
      const convs = d?.conversations || [];
      const out: any[] = [];
      for (const c of convs) {
        const cid = String(c?.contactId || "");
        if (!cid) continue;
        if (seco) { out.push({ contato: cid, acao: "rotearia" }); continue; }
        const rr = await fetch(base + "/functions/v1/crm-resposta-roteia", {
          method: "POST",
          headers: { "Authorization": "Bearer " + srvKey(), "Content-Type": "application/json" },
          body: JSON.stringify({ contact_id: cid }),
        });
        const dd = await rr.json().catch(() => ({}));
        if (dd?.acao === "atribuido") {
          await sb.from("campanha_dono_emprestado").update({ devolvido_em: new Date().toISOString(), devolvido_para: dd.usuario_ghl_id || null }).eq("contact_id", cid).is("devolvido_em", null);
        }
        out.push({ contato: cid, acao: dd?.acao || "erro", instancia: dd?.instancia, motivo: dd?.motivo });
      }
      const cont: Record<string, number> = {}; out.forEach((o) => cont[o.acao] = (cont[o.acao] || 0) + 1);
      return j({ ok: true, acao, seco, responderam: convs.length, contagem: cont, itens: out });
    }

    return j({ ok: false, erro: "acao deve ser assumir, devolver ou varrer" }, 400);
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
