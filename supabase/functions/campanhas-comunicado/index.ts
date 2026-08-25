// campanhas-comunicado (v3) — apoio a campanha rep_comunicado: recado livre da gestao para a rede
// de representantes. NAO tem gatilho de dado e NAO usa IA: o texto e escrito na tela e muda a cada
// envio, entao aqui so devolvemos a rede inteira com os contatos de cada rep (para a pessoa
// escolher) e guardamos os comunicados anteriores para reuso.
//
// GET  -> { reps:[...], salvos:[...], cfg:{wpp_intervalo_seg,...}, atualizado }
//         cfg vem de fila_config para a tela estimar o tempo do disparo pela cadencia real
//         (1 WhatsApp por instancia a cada wpp_intervalo_seg), em vez de chutar 2 min.
//
// v3: cada rep vem com DUAS instancias: `assistente` (organograma do Sankhya) e `instancia_crm`
// (a assistente que e PROPRIETARIA do contato no GoHighLevel). Quem manda no numero de saida e a
// segunda — o ZaptosWPP roteia pelo usuario remetente, que numa mensagem de API e o assignedTo do
// contato. Em 25/08 o ERP moveu os 17 reps da Beatriz para Juliete/Isadora e o CRM nao acompanhou:
// 19 reps passaram a divergir. Usar o organograma faria a tela mostrar um numero e o cliente
// receber de outro, e faria a fila agrupar errado — dois reps do mesmo numero real disparando
// juntos, que e justamente o que nao se deve fazer com o ZaptosWPP.
// POST { titulo, texto_wpp, assunto, texto_email, id? } -> grava/atualiza um comunicado
// POST { apagar:<id> }                                  -> remove um comunicado
//
// A montagem de contatos e a MESMA do campanhas-preview (snap_rep + rep_contato_extra + as duas
// bases do codparc do rep: snap_contato e ghl_contato), inclusive os rotulos CRM·empresa/CRM·casado,
// que a tela usa para deixar vinculo fraco desmarcado por padrao.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const nf = (s: any) => digits(s).replace(/^0+/, "").replace(/^55/, "");

// canal interno da casa, nao representante de verdade: sem celular ou com e-mail da Nitron
const ehInterno = (s: any) => !digits(s?.celular) || /@(nitron|nitronplast)\.com\.br$/i.test(String(s?.email || "").trim());

function repContatos(sr: any, extras: any[]) {
  const telRaw = [sr?.celular, sr?.fone_parc].concat((extras || []).filter((e) => e.tipo === "telefone").map((e) => ({ v: e.valor, r: e.rotulo })));
  const emRaw = [sr?.email, sr?.email_crm, sr?.email_parc].concat((extras || []).filter((e) => e.tipo === "email").map((e) => ({ v: e.valor, r: e.rotulo })));
  const telSeen = new Set<string>(), telefones: any[] = [];
  for (const t of telRaw) { const val = typeof t === "object" ? t?.v : t; const rot = typeof t === "object" ? t?.r : null; const d = nf(val); if (!d || telSeen.has(d)) continue; telSeen.add(d); telefones.push({ valor: String(val).trim(), rotulo: rot || null }); }
  const emSeen = new Set<string>(), emails: any[] = [];
  for (const t of emRaw) { const val = typeof t === "object" ? t?.v : t; const rot = typeof t === "object" ? t?.r : null; const k = String(val || "").trim().toLowerCase(); if (!k || emSeen.has(k)) continue; emSeen.add(k); emails.push({ valor: String(val).trim(), rotulo: rot || null }); }
  return { telefones, emails };
}
async function repBasesMap(sb: any): Promise<Record<string, any[]>> {
  const { data: rc, error } = await sb.from("rep_carteira").select("codvend,codparc"); if (error) throw error;
  const cpByVend: Record<string, number> = {}; const cps: number[] = [];
  (rc || []).forEach((r: any) => { if (r.codparc != null) { cpByVend[r.codvend] = Number(r.codparc); cps.push(Number(r.codparc)); } });
  const byCp: Record<string, any[]> = {};
  for (let i = 0; i < cps.length; i += 300) {
    const ch = cps.slice(i, i + 300);
    const { data: sc, error: e1 } = await sb.from("snap_contato").select("codparc,fone,email").in("codparc", ch); if (e1) throw e1;
    (sc || []).forEach((c: any) => { byCp[c.codparc] = byCp[c.codparc] || []; if (c.fone) byCp[c.codparc].push({ tipo: "telefone", valor: c.fone, rotulo: "Sankhya" }); if (c.email) byCp[c.codparc].push({ tipo: "email", valor: c.email, rotulo: "Sankhya" }); });
    const { data: gc, error: e2 } = await sb.from("ghl_contato").select("codparc,ghl_id,fone,email").in("codparc", ch); if (e2) throw e2;
    (gc || []).forEach((c: any) => { byCp[c.codparc] = byCp[c.codparc] || []; const gid = String(c.ghl_id || ""); const rot = gid.includes("#biz") ? "CRM·empresa" : (gid.includes("#r") ? "CRM·casado" : "CRM"); if (c.fone) byCp[c.codparc].push({ tipo: "telefone", valor: c.fone, rotulo: rot }); if (c.email) byCp[c.codparc].push({ tipo: "email", valor: c.email, rotulo: rot }); });
  }
  const byVend: Record<string, any[]> = {};
  Object.keys(cpByVend).forEach((v) => { byVend[v] = byCp[cpByVend[v]] || []; });
  return byVend;
}

const API = "https://services.leadconnectorhq.com";
const LOC = "rZ8y7lzqV7fzxsartaX2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
function e164(fone: any): string { const d = digits(fone); if (!d) return ""; if (d.length <= 11) return "+55" + d; return "+" + d; }
// Uma unica busca no GHL com todos os telefones dos reps; devolve fone normalizado -> assignedTo.
async function donosNoCRM(fones: string[]): Promise<Record<string, string> | null> {
  const tok = Deno.env.get("GHL_TOKEN"); if (!tok || !fones.length) return null;
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < fones.length; i += 90) {
      const r = await fetch(API + "/contacts/search", {
        method: "POST",
        headers: { Authorization: "Bearer " + tok, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
        body: JSON.stringify({ locationId: LOC, pageLimit: 100, filters: [{ field: "phone", operator: "contains_set", value: fones.slice(i, i + 90) }] }),
      });
      if (!r.ok) return null;
      const d = await r.json().catch(() => ({}));
      (d?.contacts || []).forEach((c: any) => { const k = nf(c?.phone); if (k && c?.assignedTo) out[k] = String(c.assignedTo); });
    }
    return out;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = srvKey();
    if (!key) return j({ erro: "sem chave de servico (secret SRV_JWT ausente)" }, 500);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);

    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (b.apagar) {
        const { error } = await sb.from("comunicado").delete().eq("id", Number(b.apagar)); if (error) throw error;
        return j({ ok: true, apagado: Number(b.apagar) });
      }
      const titulo = String(b.titulo || "").trim();
      if (!titulo) return j({ erro: "sem titulo" }, 400);
      const linha = { titulo, texto_wpp: String(b.texto_wpp || ""), assunto: String(b.assunto || ""), texto_email: String(b.texto_email || ""), atualizado: new Date().toISOString() };
      if (b.id) {
        const { data, error } = await sb.from("comunicado").update(linha).eq("id", Number(b.id)).select().maybeSingle(); if (error) throw error;
        return j({ ok: true, salvo: data });
      }
      const { data, error } = await sb.from("comunicado").insert(linha).select().maybeSingle(); if (error) throw error;
      return j({ ok: true, salvo: data });
    }

    const { data: sreps, error: eR } = await sb.from("snap_rep").select("*"); if (eR) throw eR;
    const { data: extras, error: eE } = await sb.from("rep_contato_extra").select("*").eq("ativo", true); if (eE) throw eE;
    const exMap: Record<string, any[]> = {}; (extras || []).forEach((e: any) => { (exMap[e.codvend] = exMap[e.codvend] || []).push(e); });
    const baseV = await repBasesMap(sb);
    let reps = (sreps || []).map((s: any) => {
      const rc = repContatos(s, (exMap[s.codvend] || []).concat(baseV[s.codvend] || []));
      return { codvend: Number(s.codvend), nome: String(s.rep || ("Rep " + s.codvend)), assistente: s.assistente || null, instancia_crm: null as string | null, interno: ehInterno(s), telefones: rc.telefones, emails: rc.emails };
    }).sort((a: any, b: any) => (Number(a.interno) - Number(b.interno)) || a.nome.localeCompare(b.nome, "pt-BR"));

    // instancia de verdade: a assistente proprietaria do contato no CRM
    const { data: instRows } = await sb.from("instancia_ghl").select("instancia,usuario_ghl_id").eq("ativa", true);
    const porUsuario: Record<string, string> = {};
    (instRows || []).forEach((x: any) => { if (x.usuario_ghl_id) porUsuario[String(x.usuario_ghl_id)] = String(x.instancia); });
    const fones: string[] = [];
    reps.forEach((r: any) => (r.telefones || []).forEach((t: any) => { const v = e164(t.valor); if (v) fones.push(v); }));
    const donos = await donosNoCRM(Array.from(new Set(fones)));
    if (donos) {
      reps = reps.map((r: any) => {
        let inst: string | null = null;
        for (const t of (r.telefones || [])) { const dono = donos[nf(t.valor)]; if (dono && porUsuario[dono]) { inst = porUsuario[dono]; break; } }
        return { ...r, instancia_crm: inst };
      });
    }

    const { data: salvos, error: eS } = await sb.from("comunicado").select("*").order("atualizado", { ascending: false }).limit(50); if (eS) throw eS;
    const { data: cfg } = await sb.from("fila_config").select("wpp_intervalo_seg,email_lote,wpp_ativo,email_ativo").eq("id", 1).maybeSingle();
    const { data: meta } = await sb.from("cache_meta").select("atualizado").eq("chave", "snapshot").maybeSingle();
    return j({ reps, salvos: salvos || [], cfg: cfg || null, crm_lido: !!donos, atualizado: meta?.atualizado || null });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
