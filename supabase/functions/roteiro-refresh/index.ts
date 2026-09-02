// roteiro-refresh (v10) — grava tambem pedido_aberto_dias: o pedido EM ABERTO mais recente
// (TIPMOV='P' com PENDENTE='S'). Sobravam 32 clientes na rota com pedido travado ha ~1 mes — pediram,
// o pedido esta parado aguardando liberacao interna, e o ciclo deles venceu de novo, entao passavam
// o filtro. A view ja excluia o pedido PARCIALMENTE entregue (saldo_entregar > 0); faltava o irmao
// dele. O limite de idade e parametro: campanhas.filtros_padrao -> roteiro_pedido_aberto_dias (120).
// roteiro-refresh (v9) — duas coisas:
// 1. PEDIDO CONTA COMO COMPRA. O `dias` do snapshot vinha SO do faturamento (TGFCAB TIPMOV='V',
//    STATUSNOTA='L'), entao cliente que FEZ PEDIDO e ainda nao foi faturado continuava aparecendo
//    como quem parou de comprar: 163 dos 2.071 clientes aptos tinham pedido no sistema, 142 deles
//    com o pedido TRAVADO aguardando liberacao interna — o rep ia visitar quem acabou de comprar.
//    (O filtro que existia, ce.saldo_entregar > 0, nao pega esses: saldo_entregar so e preenchido
//    quando o pedido foi PARCIALMENTE entregue; nos 163 casos vinha NULL.)
//    Agora o snapshot tambem grava ult_pedido e dias_pedido (TIPMOV='P', faturado ou nao, 24 meses),
//    e a view roteiro_cliente_apto expoe `dias` como o MENOR entre os dois — o faturamento e etapa
//    nossa, nao dele. Conta TODO tipo de pedido de venda, inclusive bonificado e troca.
// 2. Saiu a chave de servico ESCRITA NO CODIGO — a quarta (campanhas-saldo, campanhas-keyaccounts e
//    cross-sell-abc sairam antes). JWT service_role literal no fonte e chave de administrador do
//    banco; SRV_JWT existe e funciona.
// roteiro-refresh (v8) — snapshot roteiro_cliente (+codparcmatriz p/ agrupar rede) + `inadimplente` = titulo vencido HA MAIS DE 30 DIAS (por CNPJ).
// v8: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa),
//     query() passa a conferir o status do Sankhya e o refresh aborta ANTES de apagar se vier vazio (evitava perder o snapshot inteiro).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };
async function login(base: string, u: string, p: string) { const r = await fetch(`${base}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceName: "MobileLoginSP.login", requestBody: { NOMUSU: { $: u }, INTERNO: { $: p }, KEEPCONNECTED: { $: "true" } } }) }); const d = JSON.parse(new TextDecoder("iso-8859-1").decode(await r.arrayBuffer())); const s = d?.responseBody?.jsessionid?.$ ?? d?.responseBody?.jsessionid ?? ""; return { jsession: String(s || ""), cookie: s ? `JSESSIONID=${s}` : "" }; }
async function query(base: string, sess: any, sql: string) { let url = `${base}/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`; if (sess.jsession) url += `&mgeSession=${encodeURIComponent(sess.jsession)}`; const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: sess.cookie }, body: JSON.stringify({ serviceName: "DbExplorerSP.executeQuery", requestBody: { sql } }) }); const d = JSON.parse(new TextDecoder("iso-8859-1").decode(await r.arrayBuffer())); if (String(d?.status) !== "1") throw new Error("Sankhya: " + String(d?.statusMessage).slice(0, 150)); return (d?.responseBody?.rows ?? []) as any[][]; }
const ATRASO_DIAS = 30;
const INAD_Q = (off: number) => `SELECT p.CODPARC FROM TGFPAR p WHERE p.TIPPESSOA='J' AND EXISTS(SELECT 1 FROM TGFFIN f WHERE f.CODPARC=p.CODPARC AND f.RECDESP=1 AND f.DHBAIXA IS NULL AND f.PROVISAO='N' AND f.DTVENC < TRUNC(SYSDATE)-${ATRASO_DIAS} AND f.CODEMP IN (1,2,14)) ORDER BY p.CODPARC OFFSET ${off} ROWS FETCH NEXT 5000 ROWS ONLY`;
/* `ped`: ultimo PEDIDO de venda, faturado ou nao. TIPMOV='P' e pedido de venda em todas as suas
   variacoes (Top Padrao, Site, Fat Antecipado, LOJA, Especial, por Ordem, Bonificado, Troca) — o
   pedido bonificado e o de troca entram junto, e se o gestor quiser tirar e filtrar CODTIPOPER aqui.
   Janela de 24 meses: o roteiro nunca olha mais longe que ~1 ano de inatividade. */
const Q = (off: number) => `SELECT CODPARC,NOME,CODVEND,REP,CEP,CIDADE,UF,FAT12,DIAS,SALDOCLUBE,MTZ,ULTPED,DIASPED,DIASAB FROM (
  SELECT p.CODPARC, SUBSTR(p.NOMEPARC,1,60) NOME, p.CODVEND, v.APELIDO REP, REGEXP_REPLACE(p.CEP,'[^0-9]','') CEP, ci.NOMECID CIDADE, ci.UF,
    NVL(fat.FAT12,0) FAT12, NVL(TRUNC(SYSDATE)-fat.D1,9999) DIAS, NVL(ad.SALDOCLUBE,0) SALDOCLUBE, NVL(p.CODPARCMATRIZ,0) MTZ,
    TO_CHAR(ped.DP,'YYYY-MM-DD') ULTPED, NVL(TRUNC(SYSDATE)-ped.DP,9999) DIASPED, NVL(TRUNC(SYSDATE)-ab.DA,9999) DIASAB
  FROM TGFPAR p JOIN TGFVEN v ON v.CODVEND=p.CODVEND
  LEFT JOIN TSICID ci ON ci.CODCID=p.CODCID LEFT JOIN AD_PARCEIRO ad ON ad.CODPARC=p.CODPARC
  LEFT JOIN (SELECT CODPARC, SUM(VLRNOTA) FAT12, MAX(TRUNC(DTNEG)) D1 FROM TGFCAB WHERE STATUSNOTA='L' AND TIPMOV='V' AND CODEMP IN (1,2,14) AND DTNEG>=ADD_MONTHS(SYSDATE,-12) GROUP BY CODPARC) fat ON fat.CODPARC=p.CODPARC
  LEFT JOIN (SELECT CODPARC, MAX(TRUNC(DTNEG)) DP FROM TGFCAB WHERE TIPMOV='P' AND CODEMP IN (1,2,14) AND DTNEG>=ADD_MONTHS(SYSDATE,-24) GROUP BY CODPARC) ped ON ped.CODPARC=p.CODPARC
  LEFT JOIN (SELECT CODPARC, MAX(TRUNC(DTNEG)) DA FROM TGFCAB WHERE TIPMOV='P' AND PENDENTE='S' AND CODEMP IN (1,2,14) AND DTNEG>=ADD_MONTHS(SYSDATE,-24) GROUP BY CODPARC) ab ON ab.CODPARC=p.CODPARC
  WHERE p.TIPPESSOA='J' AND p.ATIVO='S' AND p.CLIENTE='S' AND fat.FAT12>0
) ORDER BY CODPARC OFFSET ${off} ROWS FETCH NEXT 5000 ROWS ONLY`;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const base = (Deno.env.get("SANKHYA_URL") || "").replace(/\/$/, "");
    const sess = await login(base, Deno.env.get("SANKHYA_USER")!, Deno.env.get("SANKHYA_PASS")!);
    const inadSet = new Set<number>(); let io = 0;
    while (true) { const rows = await query(base, sess, INAD_Q(io)); rows.forEach((r) => inadSet.add(Number(r[0]))); if (rows.length < 5000) break; io += 5000; if (io > 60000) break; }
    let off = 0; const all: any[] = [];
    while (true) { const rows = await query(base, sess, Q(off)); rows.forEach((r) => { const cp = Number(r[0]); const mtz = Number(r[10]) || 0; all.push({ codparc: cp, nome: r[1] ? String(r[1]) : null, codvend: r[2] != null ? Number(r[2]) : null, rep: r[3] ? String(r[3]) : null, cep: r[4] ? String(r[4]) : null, cidade: r[5] ? String(r[5]) : null, uf: r[6] != null ? Number(r[6]) : null, fat12m: Number(r[7]) || 0, dias: Number(r[8]) || 0, clube_saldo: Number(r[9]) || 0, codparcmatriz: (mtz > 0 ? mtz : null), ult_pedido: r[11] ? String(r[11]).slice(0, 10) : null, dias_pedido: r[12] != null ? Number(r[12]) : 9999, pedido_aberto_dias: r[13] != null ? Number(r[13]) : 9999, inad: inadSet.has(cp), atualizado: new Date().toISOString() }); }); if (rows.length < 5000) break; off += 5000; if (off > 60000) break; }
    if (!all.length) throw new Error("Sankhya nao retornou clientes — abortado ANTES de apagar o snapshot");
    const { error: eDel } = await sb.from("roteiro_cliente").delete().neq("codparc", -1); if (eDel) throw eDel;
    for (let i = 0; i < all.length; i += 500) { const { error } = await sb.from("roteiro_cliente").insert(all.slice(i, i + 500)); if (error) throw error; }
    const inadArr = Array.from(inadSet).map((c) => ({ codparc: c, atualizado: new Date().toISOString() }));
    const { error: eDel2 } = await sb.from("inadimplente").delete().neq("codparc", -1); if (eDel2) throw eDel2;
    for (let i = 0; i < inadArr.length; i += 500) { const { error } = await sb.from("inadimplente").insert(inadArr.slice(i, i + 500)); if (error) throw error; }
    return j({ ok: true, clientes: all.length, com_matriz: all.filter((x) => x.codparcmatriz).length, com_pedido: all.filter((x) => x.dias_pedido < 9999).length, pedido_mais_novo_que_fat: all.filter((x) => x.dias_pedido < x.dias).length, com_pedido_aberto: all.filter((x) => x.pedido_aberto_dias < 9999).length, inadimplentes: inadArr.length });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
