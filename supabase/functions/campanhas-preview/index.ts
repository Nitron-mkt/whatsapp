// campanhas-preview (v31) — A TELA MOSTRA O CNPJ, E O MESMO TEXTO QUE A MENSAGEM MOSTRA.
// O gestor conferiu a previa e nao viu documento: a mensagem do campanhas-disparar ja trazia, mas a
// previa monta a lista com regra propria e nao tinha o dado. Agora cada cliente vem com `doc` PRONTO
// — mascara e sufixo incluidos — em vez de a tela remontar a regra. Se o sufixo mudar, muda aqui e a
// tela acompanha sozinha.
// Duas regras que vieram do campanhas-disparar, e valem igual aqui:
//   1) NOME E CNPJ SAO DA MESMA LOJA. As listas consolidam por matriz, mas a matriz nem sempre esta
//      na lista, e ai o nome exibido e de uma filial: buscar o documento pela matriz daria nome de
//      uma loja com CNPJ de outra. Por isso consGiro/consVoucher passaram a expor `_sede`, o codparc
//      de quem esta de fato nomeado na linha. `codparc` continua sendo o do grupo, porque e a chave
//      de selecao da tela — trocar isso mudaria o que o disparo recebe.
//   2) No Clube o documento e o da matriz do contrato, e o sufixo so aparece quando o grupo tem mais
//      de uma loja (18 dos 68) — nos outros 50 mandaria o rep procurar uma rede que nao existe.
// campanhas-preview (v30) — a janela do Clube a vencer saiu do codigo e foi para o banco:
// campanhas.filtros_padrao->>'clube_venc_dias' (hoje 60), a mesma linha que o campanhas-disparar le.
// Com o numero em constante nos dois lados, ajustar a regra pedia dois redeploys e podia deixar a
// tela contando uma audiencia e o disparo mandando para outra.
// campanhas-preview (v29) — CLUBE A VENCER: teto de 45 dias na audiencia. A vigencia do Clube dura
// um ano e o filtro era so "tem vigencia": a tela contava 148 clientes, 141 deles com 46 a 362 dias
// pela frente. O teto tem de ser o mesmo do campanhas-disparar, senao a tela conta uma audiencia
// e o disparo manda para outra.
// (v28) — chave de servico via srvKey(). Desde 23/08 a plataforma injeta em
// SUPABASE_SERVICE_ROLE_KEY uma chave sb_secret_ que o Data API recusa (PGRST303 "JWT issued
// at future"), e esta tela devolvia zero em tudo sem reclamar. SRV_JWT guarda o JWT legado.
// (v27) — clube/voucher/giro + MOTOR. GIRO agora traz TICKET MEDIO por cliente (contato_enriquecido: fat12m/num_compras) p/ mostrar na tela. Contato do rep rotula origem (CRM·empresa/CRM·casado/CRM) p/ o front desmarcar vinculo fraco. Consolida por matriz. Dedup fone 55. Exclui INAD+INTRA. MOTOR nitron=true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
// chave de servico: SRV_JWT (JWT legado) e, se nao existir, a injetada pela plataforma
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const nf = (s: any) => digits(s).replace(/^0+/, "").replace(/^55/, "");
const brl = (v: any) => v == null ? "" : "R$ " + Math.round(Number(v)).toLocaleString("pt-BR");
const fmtDate = (s: any) => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s ? String(s) : null); };
const GIRO: Record<string, string[]> = { recompra_giro_a_vencer: ["A_VENCER"], recompra_giro_vencido: ["VENCIDO"], rep_sem_comprar: ["VENCIDO", "REATIVACAO"] };
const MOTOR: Record<string, number> = { recompra_cross_sell: 1, rep_sugestao_produto: 1, rep_roteiro_visitas: 1, clube_a_vencer: 1, recompra_novo_produto: 1 };
// janela de aviso do Clube a vencer: vem de campanhas.filtros_padrao, igual ao campanhas-disparar
const CLUBE_VENC_PADRAO = 60;
function clubeVencDias(camp: any): number {
  const v = Number((camp?.filtros_padrao || {}).clube_venc_dias);
  return Number.isFinite(v) && v > 0 ? v : CLUBE_VENC_PADRAO;
}
const nlojas = (n: any, base: string) => (Number(n) > 1 ? base + " (" + n + " lojas)" : base);
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
// linha consolidada de rede: o documento e da loja NOMEADA, e o rep tem de saber disso
const sufRede = (lojas: any) => (Number(lojas) > 1 ? " (desta loja)" : "");
// quantas lojas tem a rede. parc_matriz guarda so as FILIAIS: o total e 1 + filiais.
function filiaisMap(mtz: Map<number, number>): Map<number, number> {
  const f = new Map<number, number>();
  mtz.forEach((m: number) => f.set(Number(m), (f.get(Number(m)) || 0) + 1));
  return f;
}

async function inadSet(sb: any) { const s = new Set<number>(); let from = 0; while (true) { const { data } = await sb.from("inadimplente").select("codparc").range(from, from + 999); (data || []).forEach((x: any) => s.add(Number(x.codparc))); if (!data || data.length < 1000) break; from += 1000; } const { data: ig } = await sb.from("parc_intragrupo").select("codparc"); (ig || []).forEach((x: any) => s.add(Number(x.codparc))); return s; }
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
async function ticketMap(sb: any, codps: number[]) { const by: Record<string, any> = {}; const u = Array.from(new Set(codps.filter((x) => x != null))); for (let i = 0; i < u.length; i += 300) { const ch = u.slice(i, i + 300); const { data } = await sb.from("contato_enriquecido").select("codparc,num_compras,ticket_medio").in("codparc", ch); (data || []).forEach((x: any) => by[x.codparc] = { nc: Number(x.num_compras) || 0, tk: Number(x.ticket_medio) || 0 }); } return by; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
function consGiro(rows: any[], mtz: Map<number, number>, teBy?: any) {
  const t = teBy || {};
  const by: Record<string, any[]> = {}; rows.forEach((c) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); });
  return Object.keys(by).map((g) => { const ms = by[g]; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms.slice().sort((a, b) => Number(b.fat12m) - Number(a.fat12m))[0]; const fat = ms.reduce((a, b) => a + (Number(b.fat12m) || 0), 0); const nc = ms.reduce((a, b) => a + ((t[b.codparc] || {}).nc || 0), 0); const ticket = nc > 0 ? Math.round(fat / nc) : ((t[sede.codparc] || {}).tk || 0); return { codparc: Number(g), _sede: Number(sede.codparc), nomeparc: String(sede.nomeparc), codvend: sede.codvend, rep: sede.rep, fat12m: fat, dias: Math.min(...ms.map((x) => Number(x.dias) || 9999)), lojas: ms.length, ticket, _codps: ms.map((x) => Number(x.codparc)) }; });
}
function consVoucher(rows: any[], mtz: Map<number, number>) {
  const by: Record<string, any[]> = {}; rows.forEach((c) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); });
  return Object.keys(by).map((g) => { const ms = by[g].slice().sort((a, b) => String(a.dtvalidade).localeCompare(String(b.dtvalidade))); const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms[0]; return { codparc: Number(g), _sede: Number(sede.codparc), nome: String(sede.nome), codvend: sede.codvend, pct: Number(ms[0].pct), dtvalidade: ms[0].dtvalidade, lojas: ms.length, _codps: ms.map((x) => Number(x.codparc)) }; });
}
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
  const { data: rc } = await sb.from("rep_carteira").select("codvend,codparc");
  const cpByVend: Record<string, number> = {}; const cps: number[] = [];
  (rc || []).forEach((r: any) => { if (r.codparc != null) { cpByVend[r.codvend] = Number(r.codparc); cps.push(Number(r.codparc)); } });
  const byCp: Record<string, any[]> = {};
  for (let i = 0; i < cps.length; i += 300) { const ch = cps.slice(i, i + 300);
    const { data: sc } = await sb.from("snap_contato").select("codparc,fone,email").in("codparc", ch);
    (sc || []).forEach((c: any) => { byCp[c.codparc] = byCp[c.codparc] || []; if (c.fone) byCp[c.codparc].push({ tipo: "telefone", valor: c.fone, rotulo: "Sankhya" }); if (c.email) byCp[c.codparc].push({ tipo: "email", valor: c.email, rotulo: "Sankhya" }); });
    const { data: gc } = await sb.from("ghl_contato").select("codparc,ghl_id,fone,email").in("codparc", ch);
    (gc || []).forEach((c: any) => { byCp[c.codparc] = byCp[c.codparc] || []; const gid = String(c.ghl_id || ""); const rot = gid.includes("#biz") ? "CRM·empresa" : (gid.includes("#r") ? "CRM·casado" : "CRM"); if (c.fone) byCp[c.codparc].push({ tipo: "telefone", valor: c.fone, rotulo: rot }); if (c.email) byCp[c.codparc].push({ tipo: "email", valor: c.email, rotulo: rot }); });
  }
  const byVend: Record<string, any[]> = {};
  Object.keys(cpByVend).forEach((v) => { byVend[v] = byCp[cpByVend[v]] || []; });
  return byVend;
}
function dedupContatos(rows: any[], codpFallback: number) {
  const seen = new Set<string>(), out: any[] = [];
  for (const ct of rows) { const k = (ct.email || ct.fone || "").toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); out.push({ funcao: ct.funcao || "Contato", nome: ct.nome || null, email: ct.email || null, fone: ct.fone || null, codparc: ct.codparc || codpFallback, origem: ct.origem || "Sankhya" }); }
  return out;
}
async function contatosPorCodparc(sb: any, codps: number[]) {
  const uniq = Array.from(new Set(codps.filter((x) => x != null))); const by: Record<string, any[]> = {};
  for (let i = 0; i < uniq.length; i += 300) { const chunk = uniq.slice(i, i + 300); const { data } = await sb.from("snap_contato").select("*").in("codparc", chunk); (data || []).forEach((c: any) => { (by[c.codparc] = by[c.codparc] || []).push(c); }); }
  return by;
}
async function ghlPorCodparc(sb: any, codps: number[]) {
  const uniq = Array.from(new Set(codps.filter((x) => x != null))); const by: Record<string, any[]> = {};
  for (let i = 0; i < uniq.length; i += 300) { const chunk = uniq.slice(i, i + 300); const { data } = await sb.from("ghl_contato").select("codparc,nome,fone,email").in("codparc", chunk); (data || []).forEach((g: any) => { (by[g.codparc] = by[g.codparc] || []).push(g); }); }
  return by;
}
function contatosDe(cp: number, contBy: any, ghlBy: any) {
  const snap = (contBy[cp] || []); const ghl = (ghlBy[cp] || []).map((g: any) => ({ funcao: "CRM", nome: g.nome, email: g.email, fone: g.fone, codparc: cp, origem: "CRM" }));
  return dedupContatos(snap, cp).concat(dedupContatos(ghl, cp));
}
function contatosMembros(codps: number[], contBy: any, ghlBy: any, fallback: number) {
  const snapRows: any[] = []; const ghlRows: any[] = [];
  (codps || [fallback]).forEach((cp: number) => { (contBy[cp] || []).forEach((ct: any) => snapRows.push(ct)); (ghlBy[cp] || []).forEach((g: any) => ghlRows.push({ funcao: "CRM", nome: g.nome, email: g.email, fone: g.fone, codparc: cp, origem: "CRM" })); });
  return dedupContatos(snapRows, fallback).concat(dedupContatos(ghlRows, fallback));
}
function motorVal(codigo: string, c: any) {
  if (codigo === "clube_a_vencer") return { saldo: Number(c.clube_saldo_pedir) || 0, valtxt: "Clube vence em " + (c.clube_vig_dias) + "d", vig_dias: Number(c.clube_vig_dias), sort: -(Number(c.clube_vig_dias) || 99999) };
  if (codigo === "rep_roteiro_visitas") return { saldo: Number(c.ticket) || 0, valtxt: (c.situacao || "") + (Number(c.saldo_entregar) > 0 ? (" · saldo " + brl(c.saldo_entregar)) : "") + (Number(c.dias) ? (" · " + c.dias + "d") : ""), sort: Number(c.ticket) || 0 };
  if (codigo === "recompra_novo_produto") return { saldo: Number(c.ticket) || 0, valtxt: "lançamentos: " + (c.novidades || ""), sort: Number(c.ticket) || 0 };
  return { saldo: Number(c.ticket) || 0, valtxt: "sugerir: " + (c.crosssell || ""), sort: Number(c.ticket) || 0 };
}
async function motorRows(sb: any, codigo: string, vencDias: number) {
  let q = sb.from("ghl_cliente").select("codparc,razao,rep,situacao,ticket,dias,mix,compra_linhas,crosssell,novidades,saldo_entregar,titulos_vencidos,clube_vig_dias,clube_saldo_pedir,score").eq("nitron", true);
  if (codigo === "recompra_cross_sell" || codigo === "rep_sugestao_produto") q = q.not("crosssell", "is", null).eq("situacao", "Em dia");
  else if (codigo === "recompra_novo_produto") q = q.not("novidades", "is", null).eq("situacao", "Em dia");
  // so quem esta DE FATO perto de vencer, e nao qualquer um que tenha vigencia
  else if (codigo === "clube_a_vencer") q = q.not("clube_vig_dias", "is", null).gte("clube_vig_dias", 0).lte("clube_vig_dias", vencDias);
  else q = q.not("rep", "is", null).neq("situacao", "Em dia");
  const { data } = await q.limit(50000);
  return (data || []).map((c: any) => ({ ...c, _v: motorVal(codigo, c) }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const p = new URL(req.url).searchParams;
    const codigo = p.get("codigo") || "clube_saldo";
    const repParam = p.get("rep");
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const { data: camp } = await sb.from("campanhas").select("nome,ativa,filtros_padrao").eq("codigo", codigo).maybeSingle();
    const vencDias = clubeVencDias(camp);
    const isClube = codigo === "clube_saldo"; const isVoucher = codigo === "voucher_empurrar"; const isGiro = !!GIRO[codigo]; const isMotor = !!MOTOR[codigo];
    if (!isClube && !isVoucher && !isGiro && !isMotor) return j({ campanha: camp?.nome, aviso: "gatilho ainda nao mapeado" });

    if (isMotor) {
      const inad = await inadSet(sb); const mtz = await matrizMap(sb);
      let rows = (await motorRows(sb, codigo, vencDias)).filter((c: any) => !inad.has(Number(c.codparc)));
      { const by: Record<string, any[]> = {}; rows.forEach((c: any) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); }); rows = Object.keys(by).map((g) => { const ms = by[g]; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms.slice().sort((a, b) => (b._v.sort) - (a._v.sort))[0]; const tick = ms.reduce((a, b) => a + (Number(b.ticket) || 0), 0); return { ...sede, ticket: tick, lojas: ms.length, _codps: ms.map((x) => Number(x.codparc)), _v: { ...sede._v, saldo: ms.reduce((a, b) => a + (Number(b._v.saldo) || 0), 0) } }; }); }
      const { data: sreps } = await sb.from("snap_rep").select("*");
      const repByName: Record<string, any> = {}; (sreps || []).forEach((s: any) => { if (s.rep) repByName[String(s.rep).toUpperCase()] = s; });
      const codvendDe = (rep: any) => { const s = repByName[String(rep || "").toUpperCase()]; return s ? Number(s.codvend) : null; };
      if (p.get("flat")) {
        rows.sort((a: any, b: any) => b._v.sort - a._v.sort);
        const allc: number[] = []; rows.forEach((c: any) => (c._codps || [c.codparc]).forEach((x: number) => allc.push(x))); const contBy = await contatosPorCodparc(sb, allc); const ghlBy = await ghlPorCodparc(sb, allc);
        const DOC = await docMap(sb, rows.map((c: any) => c.codparc));
        const clientes = rows.map((c: any) => { const s = repByName[String(c.rep || "").toUpperCase()]; const dc = DOC[String(c.codparc)] || ""; return { codparc: c.codparc, nome: nlojas(c.lojas, c.razao), doc: dc ? (dc + sufRede(c.lojas)) : "", codvend: s ? Number(s.codvend) : null, rep: c.rep || "", saldo: c._v.saldo, pct: null, validade: null, valtxt: c._v.valtxt, vig_dias: (c._v.vig_dias != null && !isNaN(c._v.vig_dias)) ? c._v.vig_dias : null, crosssell: c.crosssell, novidades: c.novidades, mix: c.compra_linhas || c.mix, situacao: c.situacao, lojas: c.lojas, assistente: s?.assistente || null, contatos: contatosMembros(c._codps || [c.codparc], contBy, ghlBy, c.codparc) }; });
        const { data: meta } = await sb.from("cache_meta").select("atualizado").eq("chave", "snapshot").maybeSingle();
        return j({ campanha: camp?.nome, codigo, flat: true, total: clientes.length, clientes, atualizado: meta?.atualizado || null });
      }
      if (repParam) {
        const rep = parseInt(repParam); const meus = rows.filter((c: any) => codvendDe(c.rep) === rep).sort((a: any, b: any) => b._v.sort - a._v.sort);
        const allc: number[] = []; meus.forEach((c: any) => (c._codps || [c.codparc]).forEach((x: number) => allc.push(x))); const contBy = await contatosPorCodparc(sb, allc); const ghlBy = await ghlPorCodparc(sb, allc);
        const sr = (sreps || []).find((s: any) => Number(s.codvend) === rep);
        const DOC = await docMap(sb, meus.map((c: any) => c.codparc));
        const clientes = meus.map((c: any) => { const dc = DOC[String(c.codparc)] || ""; return { chave: c.codparc, codparc: c.codparc, nome: nlojas(c.lojas, c.razao), doc: dc ? (dc + sufRede(c.lojas)) : "", saldo: c._v.saldo, pct: null, validade: null, valtxt: c._v.valtxt, vig_dias: (c._v.vig_dias != null && !isNaN(c._v.vig_dias)) ? c._v.vig_dias : null, lojas: c.lojas, contatos: contatosMembros(c._codps || [c.codparc], contBy, ghlBy, c.codparc) }; });
        return j({ codigo, rep, assistente: sr?.assistente || null, clientes });
      }
      const byRep: Record<string, any> = {};
      rows.forEach((c: any) => { const cv = codvendDe(c.rep); if (cv == null) return; const k = String(cv); if (!byRep[k]) byRep[k] = { codvend: cv, rep: c.rep, n: 0, saldo: 0 }; byRep[k].n++; byRep[k].saldo += c._v.saldo; });
      const { data: extras } = await sb.from("rep_contato_extra").select("*").eq("ativo", true);
      const exMap: Record<string, any[]> = {}; (extras || []).forEach((e: any) => { (exMap[e.codvend] = exMap[e.codvend] || []).push(e); });
      const srMap: Record<string, any> = {}; (sreps || []).forEach((s: any) => srMap[s.codvend] = s);
      const baseV = await repBasesMap(sb);
      // o Clube a vencer nao e uma campanha de dinheiro: o assunto e o prazo. Somar o direito de
      // compra na tela fazia a pessoa (e a previa da mensagem) tratarem o valor como o tema.
      const somaMotor = codigo !== "clube_a_vencer";
      const por_rep = Object.values(byRep).map((r: any) => { const rc = repContatos(srMap[r.codvend], (exMap[r.codvend] || []).concat(baseV[r.codvend] || [])); return { codvend: r.codvend, nome: r.rep, clientes: r.n, saldo: Math.round(r.saldo), assistente: srMap[r.codvend]?.assistente || null, telefones: rc.telefones, emails: rc.emails }; }).sort((a: any, b: any) => somaMotor ? (b.saldo - a.saldo) : (b.clientes - a.clientes));
      const totais = { representantes: por_rep.length, clientes: rows.length, saldo: Math.round(rows.reduce((a: number, b: any) => a + b._v.saldo, 0)) };
      const { data: meta } = await sb.from("cache_meta").select("atualizado").eq("chave", "snapshot").maybeSingle();
      return j({ campanha: camp?.nome, codigo, ativa: camp?.ativa, somaSaldo: somaMotor, motor: true, janela_dias: codigo === "clube_a_vencer" ? vencDias : null, totais, por_rep, atualizado: meta?.atualizado || null });
    }

    if (p.get("flat")) {
      const { data: sreps } = await sb.from("snap_rep").select("codvend,assistente");
      const asMap: Record<string, any> = {}; (sreps || []).forEach((s: any) => asMap[s.codvend] = s.assistente);
      const repName: Record<string, string> = {}; let clientes: any[] = [];
      if (isGiro) {
        const mtz = await matrizMap(sb);
        const { data: gs } = await sb.from("snap_giro").select("codparc,nomeparc,codvend,rep,dias,fat12m").in("bucket", GIRO[codigo]).eq("inadimp", false).limit(50000);
        const teBy = await ticketMap(sb, (gs || []).map((x: any) => Number(x.codparc)));
        consGiro(gs || [], mtz, teBy).sort((a: any, b: any) => Number(b.fat12m) - Number(a.fat12m)).forEach((c: any) => clientes.push({ codparc: c.codparc, _sede: c._sede, nome: nlojas(c.lojas, c.nomeparc), codvend: c.codvend, rep: String(c.rep || ""), saldo: Number(c.fat12m), ticket: c.ticket, pct: null, validade: null, dias: c.dias, lojas: c.lojas, assistente: asMap[c.codvend] || null, _codps: c._codps }));
      } else if (isVoucher) {
        const mtz = await matrizMap(sb);
        const { data: vr } = await sb.from("voucher_rep").select("codvend,rep"); (vr || []).forEach((r: any) => repName[r.codvend] = r.rep);
        const { data: clis } = await sb.from("voucher_cli").select("codparc,nome,codvend,pct,dtvalidade").limit(50000);
        consVoucher(clis || [], mtz).sort((a: any, b: any) => String(a.dtvalidade).localeCompare(String(b.dtvalidade))).forEach((c: any) => clientes.push({ codparc: c.codparc, _sede: c._sede, nome: nlojas(c.lojas, c.nome), codvend: c.codvend, rep: repName[c.codvend] || "", saldo: null, pct: Number(c.pct), validade: fmtDate(c.dtvalidade), lojas: c.lojas, assistente: asMap[c.codvend] || null, _codps: c._codps }));
      } else {
        const mtz = await matrizMap(sb); const fil = filiaisMap(mtz);
        const { data: cr } = await sb.from("clube_rep").select("codvend,rep"); (cr || []).forEach((r: any) => repName[r.codvend] = r.rep);
        const { data: grupos } = await sb.from("clube_grupo").select("contrato,matriz,grupo,saldo,codvend").limit(50000);
        const { data: membros } = await sb.from("snap_parceiro").select("codparc,contrato").limit(50000);
        const memBy: Record<string, number[]> = {}; (membros || []).forEach((m: any) => { (memBy[m.contrato] = memBy[m.contrato] || []).push(m.codparc); });
        (grupos || []).sort((a: any, b: any) => Number(b.saldo) - Number(a.saldo)).forEach((g: any) => { const cps = memBy[g.contrato] || [g.matriz]; const nl = 1 + (fil.get(Number(g.matriz)) || 0); clientes.push({ codparc: g.matriz, _sede: Number(g.matriz), _clubeLojas: nl, nome: nlojas(nl, g.grupo), codvend: g.codvend, rep: repName[g.codvend] || "", saldo: Number(g.saldo), pct: null, validade: null, assistente: asMap[g.codvend] || null, _codps: cps }); });
      }
      const inad = await inadSet(sb); clientes = clientes.filter((c: any) => !inad.has(Number(c.codparc)));
      const allCodps: number[] = []; clientes.forEach((c) => (c._codps || []).forEach((x: number) => allCodps.push(x)));
      const contBy = await contatosPorCodparc(sb, allCodps); const ghlBy = await ghlPorCodparc(sb, allCodps);
      /* O documento e o da loja NOMEADA na linha (_sede), nao o da matriz do grupo. No Clube a linha
         fala do contrato, entao ali o sufixo diz "matriz do contrato" — e so quando ha rede. */
      const DOC = await docMap(sb, clientes.map((c: any) => c._sede || c.codparc));
      clientes.forEach((c) => {
        const dc = DOC[String(c._sede || c.codparc)] || "";
        c.doc = dc ? (dc + (isClube ? (Number(c._clubeLojas) > 1 ? " (matriz do contrato)" : "") : sufRede(c.lojas))) : "";
        c.contatos = contatosMembros(c._codps || [c.codparc], contBy, ghlBy, c.codparc); delete c._codps; delete c._sede; delete c._clubeLojas;
      });
      const { data: meta } = await sb.from("cache_meta").select("atualizado").eq("chave", "snapshot").maybeSingle();
      return j({ campanha: camp?.nome, codigo, flat: true, total: clientes.length, clientes, atualizado: meta?.atualizado || null });
    }

    if (repParam) {
      const rep = parseInt(repParam); const inad = await inadSet(sb);
      const { data: sr } = await sb.from("snap_rep").select("assistente").eq("codvend", rep).maybeSingle();
      const clientes: any[] = [];
      if (isClube) {
        const mtz = await matrizMap(sb); const fil = filiaisMap(mtz);
        const { data: grupos } = await sb.from("clube_grupo").select("contrato,matriz,grupo,saldo").eq("codvend", rep);
        const contratos = (grupos || []).map((g: any) => g.contrato);
        const { data: membros } = contratos.length ? await sb.from("snap_parceiro").select("codparc,contrato").in("contrato", contratos) : { data: [] } as any;
        const codpByContrato: Record<string, number[]> = {}; (membros || []).forEach((m: any) => { (codpByContrato[m.contrato] = codpByContrato[m.contrato] || []).push(m.codparc); });
        const contBy = await contatosPorCodparc(sb, (membros || []).map((m: any) => m.codparc)); const ghlBy = await ghlPorCodparc(sb, (membros || []).map((m: any) => m.codparc));
        const ok = (grupos || []).filter((g: any) => !inad.has(Number(g.matriz))).sort((a: any, b: any) => Number(b.saldo) - Number(a.saldo));
        const DOC = await docMap(sb, ok.map((g: any) => g.matriz));
        ok.forEach((g: any) => { const cps = codpByContrato[g.contrato] || [g.matriz]; const rows2: any[] = []; cps.forEach((cp) => rows2.push(...contatosDe(cp, contBy, ghlBy))); const nl = 1 + (fil.get(Number(g.matriz)) || 0); const dc = DOC[String(g.matriz)] || ""; clientes.push({ chave: g.contrato, codparc: g.matriz, nome: nlojas(nl, g.grupo), doc: dc ? (dc + (nl > 1 ? " (matriz do contrato)" : "")) : "", saldo: Number(g.saldo), pct: null, validade: null, lojas: nl, contatos: rows2 }); });
      } else if (isVoucher) {
        const mtz = await matrizMap(sb);
        const { data: clis } = await sb.from("voucher_cli").select("*").eq("codvend", rep).order("dtvalidade", { ascending: true });
        const cons = consVoucher((clis || []).filter((c: any) => !inad.has(Number(c.codparc))), mtz).sort((a: any, b: any) => String(a.dtvalidade).localeCompare(String(b.dtvalidade)));
        const allc: number[] = []; cons.forEach((c: any) => c._codps.forEach((x: number) => allc.push(x))); const contBy = await contatosPorCodparc(sb, allc); const ghlBy = await ghlPorCodparc(sb, allc);
        const DOC = await docMap(sb, cons.map((c: any) => c._sede));
        cons.forEach((c: any) => { const dc = DOC[String(c._sede)] || ""; clientes.push({ chave: c.codparc, codparc: c.codparc, nome: nlojas(c.lojas, c.nome), doc: dc ? (dc + sufRede(c.lojas)) : "", saldo: null, pct: Number(c.pct), validade: fmtDate(c.dtvalidade), lojas: c.lojas, contatos: contatosMembros(c._codps, contBy, ghlBy, c.codparc) }); });
      } else {
        const mtz = await matrizMap(sb);
        const { data: gs } = await sb.from("snap_giro").select("codparc,nomeparc,codvend,rep,dias,fat12m").eq("codvend", rep).in("bucket", GIRO[codigo]).eq("inadimp", false);
        const teBy = await ticketMap(sb, (gs || []).map((x: any) => Number(x.codparc)));
        const cons = consGiro((gs || []).filter((c: any) => !inad.has(Number(c.codparc))), mtz, teBy).sort((a: any, b: any) => Number(b.dias) - Number(a.dias));
        const allc: number[] = []; cons.forEach((c: any) => c._codps.forEach((x: number) => allc.push(x))); const contBy = await contatosPorCodparc(sb, allc); const ghlBy = await ghlPorCodparc(sb, allc);
        const DOC = await docMap(sb, cons.map((c: any) => c._sede));
        cons.forEach((c: any) => { const dc = DOC[String(c._sede)] || ""; clientes.push({ chave: c.codparc, codparc: c.codparc, nome: nlojas(c.lojas, c.nomeparc), doc: dc ? (dc + sufRede(c.lojas)) : "", saldo: Number(c.fat12m), ticket: c.ticket, pct: null, validade: null, dias: c.dias, lojas: c.lojas, contatos: contatosMembros(c._codps, contBy, ghlBy, c.codparc) }); });
      }
      return j({ codigo, rep, assistente: sr?.assistente || null, clientes });
    }

    let por_rep_base: any[] = [];
    if (isGiro) {
      const mtz = await matrizMap(sb); const inad = await inadSet(sb);
      const { data: gr } = await sb.from("snap_giro").select("codparc,codvend,rep,fat12m").in("bucket", GIRO[codigo]).eq("inadimp", false).limit(50000);
      const cons = consGiro((gr || []).filter((r: any) => !inad.has(Number(r.codparc))), mtz);
      const byRep: Record<string, any> = {}; cons.forEach((r: any) => { if (r.codvend == null) return; const k = String(r.codvend); if (!byRep[k]) byRep[k] = { codvend: Number(r.codvend), rep: String(r.rep || ""), n: 0, saldo: 0 }; byRep[k].n++; byRep[k].saldo += Number(r.fat12m); });
      por_rep_base = Object.values(byRep);
    } else if (isVoucher) {
      const mtz = await matrizMap(sb); const inad = await inadSet(sb);
      const { data: vc } = await sb.from("voucher_cli").select("codparc,codvend,pct,dtvalidade").limit(50000);
      const { data: vr } = await sb.from("voucher_rep").select("codvend,rep"); const rn: Record<string, string> = {}; (vr || []).forEach((r: any) => rn[r.codvend] = r.rep);
      const cons = consVoucher((vc || []).filter((c: any) => !inad.has(Number(c.codparc))), mtz);
      const byRep: Record<string, any> = {}; cons.forEach((r: any) => { if (r.codvend == null) return; const k = String(r.codvend); if (!byRep[k]) byRep[k] = { codvend: Number(r.codvend), rep: rn[r.codvend] || "", n: 0, saldo: 0 }; byRep[k].n++; });
      por_rep_base = Object.values(byRep);
    } else {
      const { data: reps } = await sb.from("clube_rep").select("*");
      por_rep_base = (reps || []).map((r: any) => ({ codvend: Number(r.codvend), rep: String(r.rep), n: Number(r.n), saldo: Number(r.saldo || 0) }));
    }
    const { data: sreps } = await sb.from("snap_rep").select("*");
    const { data: extras } = await sb.from("rep_contato_extra").select("*").eq("ativo", true);
    const srMap: Record<string, any> = {}; (sreps || []).forEach((s: any) => srMap[s.codvend] = s);
    const exMap: Record<string, any[]> = {}; (extras || []).forEach((e: any) => { (exMap[e.codvend] = exMap[e.codvend] || []).push(e); });
    const baseV = await repBasesMap(sb);
    const somaSaldo = isClube || isGiro;
    const por_rep = por_rep_base.map((r: any) => { const rc = repContatos(srMap[r.codvend], (exMap[r.codvend] || []).concat(baseV[r.codvend] || [])); return { codvend: r.codvend, nome: r.rep, clientes: Number(r.n), saldo: Number(r.saldo || 0), assistente: srMap[r.codvend]?.assistente || null, telefones: rc.telefones, emails: rc.emails }; }).sort((a: any, b: any) => somaSaldo ? b.saldo - a.saldo : b.clientes - a.clientes);
    const totais = { representantes: por_rep.length, clientes: por_rep.reduce((a: number, b: any) => a + b.clientes, 0), saldo: Math.round(por_rep.reduce((a: number, b: any) => a + b.saldo, 0)) };
    const { data: meta } = await sb.from("cache_meta").select("atualizado").eq("chave", "snapshot").maybeSingle();
    return j({ campanha: camp?.nome, codigo, ativa: camp?.ativa, somaSaldo, totais, por_rep, atualizado: meta?.atualizado || null });
  } catch (e) { return j({ erro: String(e) }, 500); }
});
