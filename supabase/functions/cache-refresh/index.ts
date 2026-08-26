// cache-refresh (v9) — snap_*. Contatos cobrem clube+voucher+GIRO. ?parte=parc|cont|rep|giro|all&empresa=<painel_id>
//
// v9: MULTI-EMPRESA. Ate a v8 esta funcao era da Nitron e so dela: o CODEMP estava chumbado
//     em quatro pontos do SQL e trocar() apagava a tabela INTEIRA antes de inserir. O roteiro
//     de docs/nova-conta-como-comecar.md mandava "rodar cache-refresh com os CODEMP dela" —
//     feito assim, o snapshot da Nitron ia embora (medido em 26/08: snap_giro cairia de 1175
//     linhas para 2). Agora:
//       - a empresa vem em ?empresa= e o CODEMP sai do cadastro `empresa`, nao do fonte;
//       - trocar() apaga SO as linhas daquela empresa, e estampa empresa em cada linha;
//       - o universo e escolhido por empresa.universo, porque a pergunta "quem entra" muda:
//         na Nitron e o Clube (AD_PARCEIRO com contrato ou voucher, 1050 parceiros, e esse
//         universo nao tem CODEMP nenhum); na Teak nao existe Clube, entao e quem comprou no
//         CODEMP dela nos ultimos 12 meses.
// v8: tira o JWT de service_role que estava chumbado no fonte como fallback do srvKey().
// v7: VOUCHER EM DUAS PARTES. O CRM tem tres campos (voucher_positivacao = PERC_VOUCHER,
//     adicional_positivacao = PERC_ADIC, total_pontos = a soma), e AD_PARCEIRO.PERCCAMPANHA ja
//     vem somado. Q_PARC le AD_CAMPANHA direto, com a MESMA regra da view AD_PARCEIRO (mes de
//     referencia = mes anterior, maior ID por CODPARC), e grava perc_voucher e perc_adic separados.
// v6: a INSTANCIA deixa de ser chutada do apelido do gerente. O apelido cru vai para
//     snap_rep.assistente_raw e snap_rep.assistente recebe SO um token valido do cadastro
//     instancia_ghl (via instancia_alias). Nao resolveu -> NULL, e o envio de WhatsApp e
//     recusado la na frente em vez de sair pela instancia errada.
// v5: chave de servico via SRV_JWT + sankhyaQuery() confere status do Sankhya + cada parte
//     aborta ANTES de apagar se vier vazia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };

async function sankhyaLogin(base: string, user: string, pass: string) {
  const url = `${base}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`;
  const body = { serviceName: "MobileLoginSP.login", requestBody: { NOMUSU: { $: user }, INTERNO: { $: pass }, KEEPCONNECTED: { $: "true" } } };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = JSON.parse(new TextDecoder("iso-8859-1").decode(await r.arrayBuffer()));
  const jsession = d?.responseBody?.jsessionid?.$ ?? d?.responseBody?.jsessionid ?? "";
  return { jsession: String(jsession || ""), cookie: jsession ? `JSESSIONID=${jsession}` : "" };
}
async function sankhyaQuery(base: string, sess: { cookie: string; jsession: string }, sql: string) {
  let url = `${base}/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`;
  if (sess.jsession) url += `&mgeSession=${encodeURIComponent(sess.jsession)}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: sess.cookie }, body: JSON.stringify({ serviceName: "DbExplorerSP.executeQuery", requestBody: { sql } }) });
  const d = JSON.parse(new TextDecoder("iso-8859-1").decode(await r.arrayBuffer()));
  if (String(d?.status) !== "1") throw new Error("Sankhya: " + String(d?.statusMessage).slice(0, 150));
  return (d?.responseBody?.rows ?? []) as unknown[][];
}
// normaliza para casar com instancia_alias: sem acento, primeira palavra, minusculo, so a-z0-9
function normAlias(v: any): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ------------------------------------------------------------------ SQL por empresa
// Tudo aqui e funcao do CODEMP e do universo da empresa. Nada de CODEMP chumbado: era o que
// obrigava a editar o fonte para cada empresa, e o que fazia o roteiro do doc ser destrutivo.
type Emp = { painel_id: string; codemp: number[]; universo: string };

const inCodemp = (e: Emp) => e.codemp.join(",");
// Inadimplencia e faturamento sao POR EMPRESA: titulo vencido na Nitron nao trava a Teak.
const INAD = (e: Emp) => `CASE WHEN EXISTS(SELECT 1 FROM TGFFIN f WHERE f.CODPARC=p.CODPARC AND f.RECDESP=1 AND f.DHBAIXA IS NULL AND f.PROVISAO='N' AND f.DTVENC<TRUNC(SYSDATE) AND f.CODEMP IN (${inCodemp(e)})) THEN 1 ELSE 0 END`;
const FAT12 = (e: Emp) => `SELECT c.CODPARC, COUNT(DISTINCT TRUNC(c.DTNEG)) N, MIN(TRUNC(c.DTNEG)) D0, MAX(TRUNC(c.DTNEG)) D1, SUM(c.VLRNOTA) FAT12
  FROM TGFCAB c WHERE c.STATUSNOTA='L' AND c.TIPMOV='V' AND c.CODEMP IN (${inCodemp(e)}) AND c.DTNEG>=ADD_MONTHS(SYSDATE,-12) GROUP BY c.CODPARC`;
// Clientes que compraram no CODEMP da empresa nos ultimos 12 meses. E o universo da Teak e a
// base do giro de todas as empresas.
const COMPROU = (e: Emp) => `SELECT DISTINCT c.CODPARC FROM TGFCAB c WHERE c.STATUSNOTA='L' AND c.TIPMOV='V' AND c.CODEMP IN (${inCodemp(e)}) AND c.DTNEG>=ADD_MONTHS(SYSDATE,-12)`;

// Universo do Clube (Nitron). NAO tem CODEMP: e cadastro de contrato/voucher, nao movimento.
const UNIV_CLUBE = `(p.CONTRATO<>0 OR NVL(p.PERCCAMPANHA,0)>0)`;
// CODPARC dos clientes de giro acionaveis (dias>giro*0.8 e <=180) — para cobrir contatos da Recompra.
const GIRO_CODP = (e: Emp) => `SELECT CODPARC FROM (
    SELECT p.CODPARC, TRUNC(SYSDATE)-fat.D1 DIAS, CASE WHEN fat.N>=2 AND (fat.D1-fat.D0)>0 THEN GREATEST(30,(fat.D1-fat.D0)/(fat.N-1)) ELSE 60 END GEFF
    FROM TGFPAR p JOIN (${FAT12(e)}) fat ON fat.CODPARC=p.CODPARC
    WHERE p.TIPPESSOA='J' AND p.ATIVO='S'
  ) WHERE DIAS > GEFF*0.8 AND DIAS <= 180`;
// As duas partes do voucher, com a MESMA regra que a view AD_PARCEIRO usa para somar: mes de
// referencia = mes anterior, e quando ha mais de uma linha para o parceiro vale a de maior ID.
const CAMPANHA_PARTES = `SELECT CODPARC, PERC_VOUCHER, PERC_ADIC FROM (
    SELECT CODPARC, NVL(PERC_VOUCHER,0) PERC_VOUCHER, NVL(PERC_ADIC,0) PERC_ADIC,
           ROW_NUMBER() OVER (PARTITION BY CODPARC ORDER BY ID DESC) RN
      FROM AD_CAMPANHA
     WHERE ANOREF = EXTRACT(YEAR FROM ADD_MONTHS(TRUNC(SYSDATE,'MM'), -1))
       AND MESREF = EXTRACT(MONTH FROM ADD_MONTHS(TRUNC(SYSDATE,'MM'), -1))
  ) WHERE RN = 1`;

// Universo em uma expressao reaproveitavel pelas tres consultas de contato/rep.
const UNIV_CODP = (e: Emp) => e.universo === "clube"
  ? `SELECT DISTINCT p.CODPARC FROM AD_PARCEIRO p WHERE ${UNIV_CLUBE}`
  : COMPROU(e);

// Parceiros. Duas formas, porque a fonte do universo e diferente — as COLUNAS sao as mesmas,
// na mesma ordem, porque o map() abaixo le por posicao.
const Q_PARC = (e: Emp) => e.universo === "clube"
  ? `SELECT p.CODPARC, p.CONTRATO, p.NOMEPARC, NVL(p.SALDOCLUBE,0), p.CODVEND, v.APELIDO,
            pa.CODPARCMATRIZ, NVL(p.PERCCAMPANHA,0), TO_CHAR(p.DTVALIDADECAMPANHA,'YYYY-MM-DD'),
            ${INAD(e)}, cam.PERC_VOUCHER, cam.PERC_ADIC
       FROM AD_PARCEIRO p JOIN TGFPAR pa ON pa.CODPARC=p.CODPARC LEFT JOIN TGFVEN v ON v.CODVEND=p.CODVEND
            LEFT JOIN (${CAMPANHA_PARTES}) cam ON cam.CODPARC=p.CODPARC
      WHERE ${UNIV_CLUBE}`
  // Sem Clube: o parceiro entra por ter comprado. Contrato, saldo do clube e voucher saem
  // zerados/nulos de proposito — nao existem nesta empresa, e inventar numero aqui viraria
  // campanha de voucher com publico fantasma.
  : `SELECT p.CODPARC, 0, p.NOMEPARC, 0, p.CODVEND, v.APELIDO,
            p.CODPARCMATRIZ, 0, CAST(NULL AS VARCHAR2(10)),
            ${INAD(e)}, CAST(NULL AS NUMBER), CAST(NULL AS NUMBER)
       FROM TGFPAR p LEFT JOIN TGFVEN v ON v.CODVEND=p.CODVEND
      WHERE p.CODPARC IN (${COMPROU(e)})`;

const Q_CONT = (e: Emp) => `
  SELECT m.CODPARC, t.FUNCAO, t.CNOME, t.EMAIL, t.FONE FROM (
    ${UNIV_CODP(e)}
    UNION
    ${GIRO_CODP(e)}
  ) m
  JOIN (
    SELECT CODPARC, 'Principal' FUNCAO, CAST(NULL AS VARCHAR2(100)) CNOME, EMAIL, TELEFONE FONE FROM TGFPAR
    UNION ALL
    SELECT CODPARC, AD_DPTOCONTATO, NOMECONTATO, EMAIL, TELEFONE FROM TGFCTT WHERE AD_DPTOCONTATO IS NOT NULL
  ) t ON t.CODPARC=m.CODPARC
  WHERE t.EMAIL IS NOT NULL OR t.FONE IS NOT NULL`;

const Q_REP = (e: Emp) => `
  SELECT v.CODVEND, v.APELIDO, v.AD_CELULAR, v.EMAIL, v.AD_EMAILCRM, pa.TELEFONE, pa.EMAIL, a.APELIDO
  FROM TGFVEN v LEFT JOIN TGFPAR pa ON pa.CODPARC=v.CODPARC LEFT JOIN TGFVEN a ON a.CODVEND=v.CODGER
  WHERE v.CODVEND IN (
    SELECT DISTINCT p2.CODVEND FROM TGFPAR p2 WHERE p2.CODPARC IN (${UNIV_CODP(e)})
    UNION
    SELECT DISTINCT p3.CODVEND FROM TGFPAR p3 WHERE p3.CODPARC IN (${GIRO_CODP(e)})
  )`;

const Q_GIRO = (e: Emp) => `
  SELECT CODPARC, NOMEPARC, CODVEND, REP, TO_CHAR(D1,'YYYY-MM-DD') ULT, DIAS, ROUND(FAT12) FAT12,
         CASE WHEN DIAS <= GEFF THEN 'A_VENCER' WHEN DIAS <= 90 THEN 'VENCIDO' ELSE 'REATIVACAO' END BUCKET, INAD
  FROM (
    SELECT p.CODPARC, p.NOMEPARC, p.CODVEND, v.APELIDO REP, fat.D1, TRUNC(SYSDATE)-fat.D1 DIAS, fat.FAT12,
           CASE WHEN fat.N>=2 AND (fat.D1-fat.D0)>0 THEN GREATEST(30,(fat.D1-fat.D0)/(fat.N-1)) ELSE 60 END GEFF,
           ${INAD(e)} INAD
    FROM TGFPAR p JOIN TGFVEN v ON v.CODVEND=p.CODVEND
    JOIN (${FAT12(e)}) fat ON fat.CODPARC=p.CODPARC
    WHERE p.TIPPESSOA='J' AND p.ATIVO='S'
  ) WHERE DIAS > GEFF*0.8 AND DIAS <= 180`;

async function chunkInsert(sb: any, table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
// Troca o snapshot DE UMA EMPRESA. O .eq("empresa") no delete e a linha mais importante
// deste arquivo: sem ele, gerar o snapshot da Teak apagava o da Nitron.
async function trocar(sb: any, table: string, emp: string, data: any[]) {
  if (!data.length) throw new Error(`${table}: Sankhya nao retornou linhas para ${emp} — abortado ANTES de apagar o snapshot`);
  const { error } = await sb.from(table).delete().eq("empresa", emp); if (error) throw new Error(`${table} delete: ${error.message}`);
  await chunkInsert(sb, table, data.map((r) => ({ ...r, empresa: emp })));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const parte = url.searchParams.get("parte") || "all";
    const empId = url.searchParams.get("empresa") || "nitron";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());

    // A empresa sai do cadastro. Se nao esta cadastrada, para aqui — melhor recusar do que
    // gerar snapshot orfao, que ninguem consegue explicar depois.
    const { data: erow, error: eEmp } = await sb.from("empresa")
      .select("painel_id, nome, codemp, universo, ativa").eq("painel_id", empId).maybeSingle();
    if (eEmp) throw eEmp;
    if (!erow) throw new Error(`empresa "${empId}" nao esta no cadastro`);
    const codemp = String(erow.codemp || "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (!codemp.length) throw new Error(`empresa "${empId}" sem CODEMP no cadastro — sem isso o snapshot sairia com o faturamento de outra empresa`);
    const e: Emp = { painel_id: erow.painel_id, codemp, universo: String(erow.universo || "clube") };

    const base = (Deno.env.get("SANKHYA_URL") || "").replace(/\/$/, "");
    const sess = await sankhyaLogin(base, Deno.env.get("SANKHYA_USER")!, Deno.env.get("SANKHYA_PASS")!);
    const res: Record<string, unknown> = { empresa: e.painel_id, codemp: e.codemp, universo: e.universo };

    if (parte === "all" || parte === "parc") {
      const rows = await sankhyaQuery(base, sess, Q_PARC(e));
      const data = rows.map((r) => ({ codparc: Number(r[0]), contrato: Number(r[1] || 0), nomeparc: r[2] ? String(r[2]) : null, saldoclube: Number(r[3] || 0), codvend: r[4] != null ? Number(r[4]) : null, rep: r[5] ? String(r[5]) : null, codparcmatriz: r[6] != null ? Number(r[6]) : null, perccampanha: Number(r[7] || 0), dtvalidade: r[8] ? String(r[8]) : null, inadimp: String(r[9]) === "1", perc_voucher: r[10] != null ? Number(r[10]) : null, perc_adic: r[11] != null ? Number(r[11]) : null }));
      await trocar(sb, "snap_parceiro", e.painel_id, data);
      res.parceiros = data.length;
      res.com_voucher_separado = data.filter((x) => x.perc_voucher != null).length;
      // conferencia: as partes tem de somar o total que a AD_PARCEIRO ja entrega
      res.soma_divergente = data.filter((x) => x.perc_voucher != null && Math.abs((x.perc_voucher || 0) + (x.perc_adic || 0) - x.perccampanha) > 0.001).length;
    }
    if (parte === "all" || parte === "cont") {
      const rows = await sankhyaQuery(base, sess, Q_CONT(e));
      const data = rows.map((r) => ({ codparc: Number(r[0]), funcao: r[1] ? String(r[1]) : "Principal", nome: r[2] ? String(r[2]) : null, email: r[3] ? String(r[3]).trim() : null, fone: r[4] ? String(r[4]).trim() : null }));
      await trocar(sb, "snap_contato", e.painel_id, data);
      res.contatos = data.length;
    }
    if (parte === "all" || parte === "rep") {
      // cadastro de instancias: so token valido e ativo entra em snap_rep.assistente
      const { data: alias, error: eAlias } = await sb.from("instancia_alias").select("alias, instancia"); if (eAlias) throw eAlias;
      const { data: insts, error: eInst } = await sb.from("instancia_ghl").select("instancia, ativa, escopo").eq("empresa", e.painel_id); if (eInst) throw eInst;
      const repInst = (insts || []).filter((x: any) => x.ativa && x.escopo === "rep");
      const ativa = new Set(repInst.map((x: any) => x.instancia));
      const mapa: Record<string, string> = {};
      (alias || []).forEach((a: any) => { if (ativa.has(a.instancia)) mapa[a.alias] = a.instancia; });
      // O aborto vale quando a empresa TEM instancia de rep cadastrada e o de-para de apelido
      // esta vazio: config pela metade, e resolver instancia no chute foi o bug da v6.
      // Empresa sem instancia de rep (a Teak nao tem: e uma pessoa so) segue com assistente
      // nulo, e o envio de WhatsApp e recusado la na frente, que e o comportamento correto.
      if (repInst.length && !Object.keys(mapa).length) throw new Error(`instancia_alias vazio para ${e.painel_id} — abortado: sem cadastro nao da para resolver a instancia`);

      const rows = await sankhyaQuery(base, sess, Q_REP(e));
      const semInst: any[] = [];
      const data = rows.map((r) => {
        const raw = r[7] ? String(r[7]).trim() : null;
        const inst = mapa[normAlias(raw)] || null;
        if (!inst) semInst.push({ codvend: Number(r[0]), rep: r[1] ? String(r[1]) : null, gerente_sankhya: raw });
        return { codvend: Number(r[0]), rep: r[1] ? String(r[1]) : null, celular: r[2] ? String(r[2]).trim() : null, email: r[3] ? String(r[3]).trim() : null, email_crm: r[4] ? String(r[4]).trim() : null, fone_parc: r[5] ? String(r[5]).trim() : null, email_parc: r[6] ? String(r[6]).trim() : null, assistente: inst, assistente_raw: raw };
      });
      await trocar(sb, "snap_rep", e.painel_id, data);
      res.reps = data.length;
      res.reps_com_instancia = data.filter((x) => x.assistente).length;
      res.reps_sem_instancia = semInst.length;
      res.sem_instancia_detalhe = semInst.slice(0, 20);
    }
    if (parte === "all" || parte === "giro") {
      const rows = await sankhyaQuery(base, sess, Q_GIRO(e));
      const data = rows.map((r) => ({ codparc: Number(r[0]), nomeparc: r[1] ? String(r[1]) : null, codvend: r[2] != null ? Number(r[2]) : null, rep: r[3] ? String(r[3]) : null, ultima: r[4] ? String(r[4]) : null, dias: Number(r[5] || 0), fat12m: Number(r[6] || 0), bucket: r[7] ? String(r[7]) : null, inadimp: String(r[8]) === "1" }));
      await trocar(sb, "snap_giro", e.painel_id, data);
      res.giro = data.length;
    }
    // cache_meta por empresa: uma chave so faria a data da Teak sobrescrever a da Nitron e o
    // painel mostrar "atualizado agora" para quem nao foi atualizado.
    const { error: eMeta } = await sb.from("cache_meta").upsert({ chave: `snapshot:${e.painel_id}`, atualizado: new Date().toISOString(), detalhe: JSON.stringify(res) }); if (eMeta) throw eMeta;
    if (e.painel_id === "nitron") {
      // a chave antiga continua sendo escrita: o painel da Nitron le "snapshot" e nao vou
      // quebrar a tela dele nesta mudanca.
      const { error: e2 } = await sb.from("cache_meta").upsert({ chave: "snapshot", atualizado: new Date().toISOString(), detalhe: JSON.stringify(res) }); if (e2) throw e2;
    }
    return j({ ok: true, parte, ...res });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
