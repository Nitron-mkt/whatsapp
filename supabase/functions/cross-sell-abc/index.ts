// cross-sell-abc (v5) — duas coisas:
// 1. GRAVA curva_a SEPARADO. O crosssell mistura "curva A que o cliente nao compra" com os
//    lancamentos marcados "(lançamento)", e isso fez duas campanhas dizerem a mesma coisa: para 528
//    dos 529 clientes da audiencia a parte de curva A estava VAZIA (o cliente ja compra tudo da
//    curva A do canal dele), entao "Sugestao de produtos p/ a visita" e "Lancamentos" saiam com os
//    mesmos lancamentos. Agora cada campanha tem seu campo:
//      curva_a   = abcGap  — curva A do canal nao comprada, SEM lancamento  -> rep_sugestao_produto
//      novidades = novGap  — lancamentos nao comprados                      -> recompra_novo_produto
//      crosssell = a mistura, mantida para a campanha de ticket/cross-sell
// 2. Saiu a chave de servico ESCRITA NO CODIGO (era a terceira: campanhas-saldo e
//    campanhas-keyaccounts sairam em 31/08). Um JWT service_role literal no fonte e chave de
//    administrador do banco; SRV_JWT existe e funciona.
// cross-sell-abc (v4) — ABC por Linha x (Canal,Segmento) 80/95 + trilha de LANCAMENTOS (linhas <=42 meses ou sem venda). reco = A do canal nao compradas (refino segmento) + novidades nao compradas. Grava ghl_cliente.crosssell/novidades + abc_linha.
// v4: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa com PGRST303),
//     sankhyaQuery() confere o status do Sankhya e a curva ABC nao e mais apagada quando o calculo vem vazio.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };
async function sankhyaLogin(base: string, user: string, pass: string) {
  const url = `${base}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceName: "MobileLoginSP.login", requestBody: { NOMUSU: { $: user }, INTERNO: { $: pass }, KEEPCONNECTED: { $: "true" } } }) });
  const d = JSON.parse(new TextDecoder("iso-8859-1").decode(await r.arrayBuffer()));
  const jsession = d?.responseBody?.jsessionid?.$ ?? d?.responseBody?.jsessionid ?? "";
  return { jsession: String(jsession || ""), cookie: jsession ? `JSESSIONID=${jsession}` : "" };
}
async function sankhyaQuery(base: string, sess: any, sql: string) {
  let url = `${base}/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`;
  if (sess.jsession) url += `&mgeSession=${encodeURIComponent(sess.jsession)}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: sess.cookie }, body: JSON.stringify({ serviceName: "DbExplorerSP.executeQuery", requestBody: { sql } }) });
  const d = JSON.parse(new TextDecoder("iso-8859-1").decode(await r.arrayBuffer()));
  if (String(d?.status) !== "1") throw new Error("Sankhya: " + String(d?.statusMessage).slice(0, 150));
  return (d?.responseBody?.rows ?? []) as any[][];
}
const LINMAP = "WITH linmap AS (SELECT CODGRUPOPROD, CONNECT_BY_ROOT DESCRGRUPOPROD LINHA FROM TGFGRU START WITH CODGRUPAI=1000000 CONNECT BY PRIOR CODGRUPOPROD=CODGRUPAI)";
const EXCLUI = new Set(["Teak Brazil", "Mood"]);
const NOV_MESES = 42;
function aInfo(m: Record<string, number>) { const arr = Object.entries(m).sort((a, b) => b[1] - a[1]); const tot = arr.reduce((s, x) => s + x[1], 0) || 1; let cum = 0; const A = new Set<string>(); const rows: any[] = []; for (const [lin, f] of arr) { const before = cum / tot; cum += f; const classe = before < 0.8 ? "A" : (before < 0.95 ? "B" : "C"); if (classe === "A") A.add(lin); rows.push({ linha: lin, fat: Math.round(f), share: +(f / tot).toFixed(4), cum: +(cum / tot).toFixed(4), classe }); } return { A, order: arr.map((x) => x[0]), rows }; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const base = (Deno.env.get("SANKHYA_URL") || "").replace(/\/$/, "");
    const sess = await sankhyaLogin(base, Deno.env.get("SANKHYA_USER")!, Deno.env.get("SANKHYA_PASS")!);
    // fatura por (codparc, linha) paginado
    const byParc: Record<string, Record<string, number>> = {}; let off = 0;
    while (true) {
      const sql = `${LINMAP} SELECT CODPARC,LINHA,FAT FROM (SELECT c.CODPARC, lm.LINHA, ROUND(SUM(i.VLRTOT)) FAT FROM TGFCAB c JOIN TGFITE i ON i.NUNOTA=c.NUNOTA JOIN TGFPRO p ON p.CODPROD=i.CODPROD JOIN linmap lm ON lm.CODGRUPOPROD=p.CODGRUPOPROD JOIN TGFPAR par ON par.CODPARC=c.CODPARC WHERE c.STATUSNOTA='L' AND c.TIPMOV='V' AND c.CODEMP IN (1,2,14) AND c.DTNEG>=ADD_MONTHS(SYSDATE,-12) AND par.TIPPESSOA='J' AND par.ATIVO='S' GROUP BY c.CODPARC, lm.LINHA) ORDER BY CODPARC,LINHA OFFSET ${off} ROWS FETCH NEXT 5000 ROWS ONLY`;
      const rows = await sankhyaQuery(base, sess, sql);
      rows.forEach((r) => { const cp = String(r[0]); const lin = String(r[1] || "").replace(/^Linha\s+/i, "").trim(); const fat = Number(r[2]) || 0; if (fat <= 0) return; (byParc[cp] = byParc[cp] || {})[lin] = fat; });
      if (rows.length < 5000) break; off += 5000; if (off > 80000) break;
    }
    if (!Object.keys(byParc).length) throw new Error("Sankhya nao retornou faturamento por linha — abortado ANTES de mexer na curva ABC");
    // lancamentos: linhas <= NOV_MESES meses de primeira venda, ou sem venda (pre-lancamento), exceto outras empresas
    const lancRows = await sankhyaQuery(base, sess, `${LINMAP} SELECT lm.LINHA, ROUND(MONTHS_BETWEEN(SYSDATE, MIN(c.DTNEG))) MESES FROM TGFPRO p JOIN linmap lm ON lm.CODGRUPOPROD=p.CODGRUPOPROD LEFT JOIN TGFITE i ON i.CODPROD=p.CODPROD LEFT JOIN TGFCAB c ON c.NUNOTA=i.NUNOTA AND c.STATUSNOTA='L' AND c.TIPMOV='V' AND c.CODEMP IN (1,2,14) WHERE p.ATIVO='S' GROUP BY lm.LINHA`);
    const novSet = new Set<string>();
    lancRows.forEach((r) => { const lin = String(r[0] || "").replace(/^Linha\s+/i, "").trim(); const meses = r[1] == null ? null : Number(r[1]); if (EXCLUI.has(lin)) return; if (meses == null || meses <= NOV_MESES) novSet.add(lin); });
    // ordena novidades por faturamento total (traction) desc
    const lineTot: Record<string, number> = {}; for (const cp in byParc) for (const lin in byParc[cp]) lineTot[lin] = (lineTot[lin] || 0) + byParc[cp][lin];
    const novOrder = Array.from(novSet).sort((a, b) => (lineTot[b] || 0) - (lineTot[a] || 0));
    // canal/ramo
    const canalDe: Record<string, string> = {}, ramoDe: Record<string, string> = {}; let from = 0;
    while (true) { const { data, error } = await sb.from("ghl_cliente").select("codparc,canal,ramo").range(from, from + 999); if (error) throw error; (data || []).forEach((g: any) => { if (g.canal) canalDe[g.codparc] = g.canal; if (g.ramo) ramoDe[g.codparc] = g.ramo; }); if (!data || data.length < 1000) break; from += 1000; }
    // agrega ABC (excluindo lancamentos da curva, pois distorcem)
    const canalLinha: Record<string, Record<string, number>> = {}, ramoLinha: Record<string, Record<string, number>> = {};
    for (const cp in byParc) { const canal = canalDe[cp], ramo = ramoDe[cp]; for (const lin in byParc[cp]) { if (novSet.has(lin)) continue; const f = byParc[cp][lin]; if (canal) { (canalLinha[canal] = canalLinha[canal] || {}); canalLinha[canal][lin] = (canalLinha[canal][lin] || 0) + f; } if (ramo) { (ramoLinha[ramo] = ramoLinha[ramo] || {}); ramoLinha[ramo][lin] = (ramoLinha[ramo][lin] || 0) + f; } } }
    const canalA: Record<string, any> = {}; for (const k in canalLinha) canalA[k] = aInfo(canalLinha[k]);
    const ramoA: Record<string, any> = {}; for (const k in ramoLinha) ramoA[k] = aInfo(ramoLinha[k]);
    const recos: any[] = [];
    for (const cp in byParc) { const canal = canalDe[cp], ramo = ramoDe[cp]; const compra = new Set(Object.keys(byParc[cp])); const cA = canal ? canalA[canal] : null; const rA = ramoA[ramo] || { A: new Set() };
      let abcGap: string[] = [];
      if (cA) { abcGap = cA.order.filter((lin: string) => cA.A.has(lin) && !compra.has(lin)).map((lin: string, i: number) => ({ lin, i, ra: rA.A.has(lin) ? 0 : 1 })).sort((a: any, b: any) => a.ra - b.ra || a.i - b.i).map((x: any) => x.lin).slice(0, 3); }
      const novGap = novOrder.filter((lin) => !compra.has(lin)).slice(0, 2);
      const combined = abcGap.concat(novGap.map((l) => l + " (lançamento)"));
      /* curva_a e novidades vao SEPARADOS de proposito: sao duas campanhas diferentes, e enquanto o
         crosssell juntava as duas coisas elas mandavam a mesma mensagem. crosssell continua sendo a
         mistura, para a campanha de ticket. */
      recos.push({ codparc: Number(cp), curva_a: abcGap.length ? abcGap.join(", ") : null, crosssell: combined.length ? combined.slice(0, 4).join(", ") : null, novidades: novGap.length ? novGap.join(", ") : null, compra_linhas: Array.from(compra).join(", ") });
    }
    let atualizados = 0;
    for (let i = 0; i < recos.length; i += 500) { const chunk = recos.slice(i, i + 500).map((r) => ({ codparc: r.codparc, curva_a: r.curva_a, crosssell: r.crosssell, novidades: r.novidades, compra_linhas: r.compra_linhas })); const { error } = await sb.from("ghl_cliente").upsert(chunk, { onConflict: "codparc" }); if (error) throw error; atualizados += chunk.length; }
    const abcRows: any[] = [];
    for (const k in canalA) canalA[k].rows.forEach((x: any) => abcRows.push({ escopo: "canal", chave: k, ...x }));
    for (const k in ramoA) ramoA[k].rows.forEach((x: any) => abcRows.push({ escopo: "segmento", chave: k, ...x }));
    if (!abcRows.length) throw new Error("curva ABC saiu vazia — abortado ANTES de apagar abc_linha");
    const { error: eDel } = await sb.from("abc_linha").delete().neq("escopo", ""); if (eDel) throw eDel;
    for (let i = 0; i < abcRows.length; i += 500) { const { error } = await sb.from("abc_linha").insert(abcRows.slice(i, i + 500)); if (error) throw error; }
    return j({ ok: true, clientes: Object.keys(byParc).length, com_curva_a: recos.filter((r) => r.curva_a).length, com_novidades: recos.filter((r) => r.novidades).length, com_reco: recos.filter((r) => r.crosssell).length, atualizados, novidades: novOrder, canais: Object.keys(canalA).length, segmentos: Object.keys(ramoA).length });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
