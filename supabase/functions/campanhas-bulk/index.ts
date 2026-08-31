// campanhas-bulk (v4) — CNPJ EM TODA LINHA DE CLIENTE QUE VAI AO REPRESENTANTE. Pedido do gestor: por
// nome fantasia ou razao social o rep nao acha o cliente no sistema dele; pelo CNPJ acha. Vale para
// os cinco pipes operaveis (cobranca, retorno, agendar, saldo e prep), em linha propria, como nas
// campanhas. Na lista AO CLIENTE nao entra: ali o documento seria o dele mesmo, e nao ajuda ninguem.
// campanhas-bulk (v3) — apoio ao ENVIO EM MASSA. Por id selecionado devolve {nome, contatos, lista, instancia} SEM IA. Cliente=contato central da rede (snap_contato+ghl_contato de todas as lojas). REP=snap_rep + snap_contato + ghl_contato do codparc do rep (rep_carteira) — DUAS bases. Consolida por matriz.
// v3: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa com PGRST303) + erro legivel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };
const brl = (v: any) => "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR");
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const lj = (n: any) => (Number(n) > 1 ? ` (${n} lojas)` : "");
/* CNPJ crus de 14 digitos do Sankhya. Ha cadastro com CPF (11) e um cliente do Uruguai com RUT de
   12: o rotulo muda, porque chamar CPF de CNPJ e erro visivel para quem le. */
function fmtDoc(d: any) {
  const x = digits(d);
  if (x.length === 14) return "CNPJ " + x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (x.length === 11) return "CPF " + x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return x ? ("doc " + x) : "";
}
async function docMap(sb: any, codps: any[]): Promise<Record<string, string>> {
  const by: Record<string, string> = {};
  const u = Array.from(new Set(codps.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
  for (let i = 0; i < u.length; i += 300) {
    const { data } = await sb.from("contato_enriquecido").select("codparc,cnpj").in("codparc", u.slice(i, i + 300));
    (data || []).forEach((r: any) => { const d = fmtDoc(r.cnpj); if (d) by[String(r.codparc)] = d; });
  }
  return by;
}
/* Tres linhas: nome, documento, motivo. O documento sozinho na segunda e o que o rep copia — no meio
   da linha do motivo, entre valor e prazo, ele se perde. Cada linha traz o documento DA LOJA daquela
   linha, e nao o da matriz: em pipe consolidado por rede o nome exibido pode ser de uma filial. */
function linhaCli(nome: string, doc: string, motivo: string) {
  return "• " + nome + (doc ? ("\n  " + doc) : "") + "\n  " + motivo;
}
function diasDe(dtneg: any) { if (!dtneg) return 0; const t = new Date(String(dtneg) + "T00:00:00").getTime(); if (!isFinite(t)) return 0; return Math.floor((Date.now() - t) / 86400000); }
function passaSaldo(modo: string, s: any) { const pct = Number(s.pct_atend) || 0; if (modo === "parcial") return pct >= 50 && pct < 90; if (modo === "sem_estoque") return pct < 50; if (modo === "envelhece") return pct >= 90 && s.atende && diasDe(s.dtneg) > 7; if (modo === "consolidar") return pct >= 50 && !s.atende; return pct >= 90 && s.atende; }
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data, error } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); if (error) throw error; (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
function pushCanal(out: any[], seen: any, canal: string, valor: any, funcao: string, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao, origem }); }

const CFG: Record<string, any> = {
  cobranca: { table: "cobranca_cliente", nome: "nome", by: "matriz", val: (c: any) => Number(c.valor_vencido) || 0, linha: (c: any, d: string) => linhaCli(String(c.nome), d, `${brl(c.valor_vencido)} (${c.n_titulos} tit., ${c.maior_atraso}d)`) },
  retorno: { table: "retorno_pedido", nome: "cliente", by: "matriz", val: (c: any) => Number(c.valor) || 0, linha: (c: any, d: string) => linhaCli(String(c.cliente), d, `NF ${c.nunota} (${c.data_retorno || ""}) ${brl(c.valor)}${c.motivo ? " · " + c.motivo : ""}`) },
  agendar: { table: "agendar_pedido", nome: "nome", by: "matriz", val: (c: any) => Number(c.valor) || 0, linha: (c: any, d: string) => linhaCli(String(c.nome), d, `ped ${c.nunota} ${brl(c.valor)}${c.is_saldo ? " (saldo)" : ""} · janela ${c.janela || "a combinar"}`) },
  saldo: { table: "saldo_pedido", nome: "rep", by: "codvend", val: (c: any) => Number(c.valorpend) || 0, linha: (c: any, d: string) => linhaCli(String(c.nome), d, `ped ${c.nunota} — ${brl(c.valorpend)} · ${c.pct_atend}% estoque`) },
  prep: { table: "prep_pedido", nome: "rep", by: "codvend", val: (c: any) => Number(c.valor) || 0, linha: (c: any, d: string) => linhaCli(String(c.nome), d, `ped ${c.nunota} — ${brl(c.valor)} · travado ha ${c.dias}d`) },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams;
    const pipe = p.get("pipe") || ""; const publico = p.get("publico") || "cliente";
    const ids = (p.get("ids") || "").split(",").map((x) => Number(x.trim())).filter((x) => x);
    const cfg = CFG[pipe]; if (!cfg) return j({ erro: "pipe invalido" }, 400);
    if (!ids.length) return j({ itens: [] });
    const mtz = cfg.by === "matriz" ? await matrizMap(sb) : null;
    let { data: rows, error: eRows } = await sb.from(cfg.table).select("*").limit(50000); if (eRows) throw eRows;
    rows = rows || [];
    if (pipe === "cobranca") { const bucket = p.get("bucket"); if (bucket) rows = rows.filter((r: any) => r.bucket === bucket); }
    if (pipe === "saldo") { const modo = p.get("modo") || "liberar"; rows = rows.filter((r: any) => (Number(r.valorpend) || 0) >= 1000 && passaSaldo(modo, r)); }
    if (pipe === "agendar") { const saldo = p.get("saldo"); if (saldo != null) rows = rows.filter((r: any) => saldo === "1" ? !!r.is_saldo : !r.is_saldo); }
    const keyOf = (r: any) => cfg.by === "matriz" ? gk(mtz!, r.codparc) : Number(r.codvend);
    const idset = new Set(ids);
    const by: Record<string, any[]> = {}; rows.forEach((r: any) => { const k = keyOf(r); if (!idset.has(k)) return; (by[k] = by[k] || []).push(r); });

    const itens: any[] = [];
    const repByVend: Record<string, any> = {}; const repBaseByVend: Record<string, any[]> = {};
    if (publico === "rep") {
      const vends = Array.from(new Set(Object.values(by).map((ms: any) => Number(ms[0].codvend)).filter((x) => x)));
      for (let i = 0; i < vends.length; i += 300) { const { data, error } = await sb.from("snap_rep").select("*").in("codvend", vends.slice(i, i + 300)); if (error) throw error; (data || []).forEach((s: any) => repByVend[s.codvend] = s); }
      // DUAS bases: contatos do proprio codparc do rep (rep_carteira) em snap_contato + ghl_contato
      const { data: rc, error: eRc } = await sb.from("rep_carteira").select("codvend,codparc").in("codvend", vends); if (eRc) throw eRc;
      const cpByVend: Record<string, number> = {}; const cps: number[] = [];
      (rc || []).forEach((r: any) => { if (r.codparc != null) { cpByVend[r.codvend] = Number(r.codparc); cps.push(Number(r.codparc)); } });
      const baseByCp: Record<string, any[]> = {};
      for (let i = 0; i < cps.length; i += 300) { const ch = cps.slice(i, i + 300);
        const { data: sc, error: eSc } = await sb.from("snap_contato").select("codparc,fone,email").in("codparc", ch); if (eSc) throw eSc; (sc || []).forEach((c: any) => { baseByCp[c.codparc] = baseByCp[c.codparc] || []; if (c.fone) baseByCp[c.codparc].push({ canal: "whatsapp", valor: c.fone, funcao: "Rep", origem: "Sankhya" }); if (c.email) baseByCp[c.codparc].push({ canal: "email", valor: c.email, funcao: "Rep", origem: "Sankhya" }); });
        const { data: gc, error: eGc } = await sb.from("ghl_contato").select("codparc,fone,email").in("codparc", ch); if (eGc) throw eGc; (gc || []).forEach((c: any) => { baseByCp[c.codparc] = baseByCp[c.codparc] || []; if (c.fone) baseByCp[c.codparc].push({ canal: "whatsapp", valor: c.fone, funcao: "Rep", origem: "CRM" }); if (c.email) baseByCp[c.codparc].push({ canal: "email", valor: c.email, funcao: "Rep", origem: "CRM" }); });
      }
      Object.keys(cpByVend).forEach((v) => { repBaseByVend[v] = baseByCp[cpByVend[v]] || []; });
    }
    /* O documento entra so na lista AO REPRESENTANTE: e ele que precisa achar o cliente no sistema.
       Na lista ao cliente seria o CNPJ dele proprio, ruido puro. */
    const DOC: Record<string, string> = publico === "rep"
      ? await docMap(sb, rows.filter((r: any) => idset.has(keyOf(r))).map((r: any) => Number(r.codparc)))
      : {};
    const doc = (cp: any) => DOC[String(cp)] || "";
    let contBy: Record<string, any[]> = {}; let ghlBy: Record<string, any[]> = {};
    if (publico === "cliente") { const allCps = Array.from(new Set(rows.filter((r: any) => idset.has(keyOf(r))).map((r: any) => Number(r.codparc)))); for (let i = 0; i < allCps.length; i += 300) { const ch = allCps.slice(i, i + 300); const { data: sc, error: eSc } = await sb.from("snap_contato").select("*").in("codparc", ch); if (eSc) throw eSc; (sc || []).forEach((c: any) => { (contBy[c.codparc] = contBy[c.codparc] || []).push(c); }); const { data: gc, error: eGc } = await sb.from("ghl_contato").select("codparc,nome,fone,email").in("codparc", ch); if (eGc) throw eGc; (gc || []).forEach((c: any) => { (ghlBy[c.codparc] = ghlBy[c.codparc] || []).push(c); }); } }

    for (const id of ids) {
      const ms = by[id]; if (!ms || !ms.length) continue;
      const lojasN = new Set(ms.map((x: any) => Number(x.codparc))).size;
      const sede = ms.find((x: any) => Number(x.codparc) === Number(id)) || ms.slice().sort((a: any, b: any) => cfg.val(b) - cfg.val(a))[0];
      const nome = cfg.by === "matriz" ? (String(sede[cfg.nome]) + lj(lojasN)) : String(sede[cfg.nome] || ("Rep " + id));
      const lista = ms.slice().sort((a: any, b: any) => cfg.val(b) - cfg.val(a)).map((r: any) => cfg.linha(r, doc(r.codparc))).join("\n");
      const codvend = Number(sede.codvend);
      const repRow = repByVend[codvend];
      const out: any[] = []; const seen: any = {}; let instancia: any = null;
      if (publico === "cliente") {
        const memCps = Array.from(new Set(ms.map((x: any) => Number(x.codparc))));
        memCps.forEach((cp) => { (contBy[cp] || []).forEach((ct: any) => { pushCanal(out, seen, "whatsapp", ct.fone, ct.funcao || "Contato", "Sankhya"); pushCanal(out, seen, "email", ct.email, ct.funcao || "Contato", "Sankhya"); }); (ghlBy[cp] || []).forEach((g: any) => { pushCanal(out, seen, "whatsapp", g.fone, "CRM", "CRM"); pushCanal(out, seen, "email", g.email, "CRM", "CRM"); }); });
        if (repRow) instancia = repRow.assistente || null;
      } else {
        if (repRow) { instancia = repRow.assistente || null; pushCanal(out, seen, "whatsapp", repRow.celular, "Rep", "Sankhya"); pushCanal(out, seen, "whatsapp", repRow.fone_parc, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email_crm, "Rep", "CRM"); }
        (repBaseByVend[codvend] || []).forEach((c: any) => pushCanal(out, seen, c.canal, c.valor, "Rep", c.origem));
      }
      itens.push({ id, codparc: cfg.by === "matriz" ? Number(id) : null, codvend: codvend || null, nome, lojas: lojasN, instancia, contatos: out, lista });
    }
    return j({ pipe, publico, total: itens.length, itens });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
