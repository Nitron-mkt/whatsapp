// campanhas-agendar (v5) — CNPJ NA LISTA DE PEDIDOS QUE VAI AO REPRESENTANTE, e a lista deixa de ser
// escrita pela IA. Duas coisas ligadas:
//   1. Pedido do gestor: por nome fantasia ou razao social o rep nao acha o cliente no sistema dele;
//      pelo CNPJ acha. Aqui cada linha e uma loja da rede, e o documento diz qual.
//   2. Antes a IA recebia a lista pronta no contexto e a REESCREVIA na mensagem. Com nome e valor
//      isso ja era arriscado; com CNPJ passa a ser inaceitavel — um digito trocado manda o rep para
//      outra empresa. Agora a IA escreve so o texto em volta e o marcador [LISTA]; a lista entra
//      depois, montada em codigo. Se a IA nao devolver o marcador, cai no modelo fixo — melhor um
//      texto padrao do que numero inventado.
// campanhas-agendar (v4) — pedidos a agendar CONSOLIDADOS POR MATRIZ. ?saldo=1 (re-entrega saldo) | 0 (entrega normal) filtra antes de agrupar. ?grupo=<matriz>&publico manda p/ UM contato central listando os pedidos. ?msg=nunota mantido.
// v4: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa),
//     TOM de parceria com o representante e correcao do template do contexto (a lista de pedidos nunca chegava na IA).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const brl = (v: any) => "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR");
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const MODELO = "claude-haiku-4-5-20251001";
const lj = (n: any) => (Number(n) > 1 ? ` (${n} lojas)` : "");
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };
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
// Se a IA repetir o marcador, a lista inteira sairia duas vezes. Mantem so a ultima ocorrencia.
function umaListaSo(t: string) { const partes = String(t || "").split(/\[LISTA\]/i); if (partes.length <= 2) return String(t || ""); return partes.slice(0, -1).join("lista") + "[LISTA]" + partes[partes.length - 1]; }
const temLista = (t: string) => /\[LISTA\]/i.test(String(t || ""));
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data, error } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); if (error) throw error; (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
async function claude(sys: string, user: string): Promise<string | null> { const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null; try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, max_tokens: 500, temperature: 0.7, system: sys, messages: [{ role: "user", content: user }] }) }); if (!r.ok) return null; return (await r.json())?.content?.[0]?.text || null; } catch { return null; } }
function pushCanal(out: any[], seen: any, canal: string, valor: any, funcao: string, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao, origem }); }
async function contatosRede(sb: any, memArr: number[], out: any[], seen: any) { const { data: sc, error: eSc } = await sb.from("snap_contato").select("*").in("codparc", memArr); if (eSc) throw eSc; const { data: gc, error: eGc } = await sb.from("ghl_contato").select("nome,fone,email").in("codparc", memArr); if (eGc) throw eGc; (sc || []).forEach((ct: any) => { pushCanal(out, seen, "whatsapp", ct.fone, ct.funcao || "Contato", "Sankhya"); pushCanal(out, seen, "email", ct.email, ct.funcao || "Contato", "Sankhya"); }); (gc || []).forEach((g: any) => { pushCanal(out, seen, "whatsapp", g.fone, "CRM", "CRM"); pushCanal(out, seen, "email", g.email, "CRM", "CRM"); }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams; const msgNun = p.get("msg"); const grupoCod = p.get("grupo");
    const saldoParam = p.get("saldo"); const flt = (c: any) => saldoParam == null ? true : (saldoParam === "1" ? !!c.is_saldo : !c.is_saldo);
    const mtz = await matrizMap(sb);

    if (grupoCod || msgNun) {
      const publico = p.get("publico") || "cliente";
      const { data: allRaw, error: eAll } = await sb.from("agendar_pedido").select("*").limit(50000); if (eAll) throw eAll;
      const all = (allRaw || []).filter(flt);
      let g: number; let membros: any[];
      if (grupoCod) { g = Number(grupoCod); membros = all.filter((c: any) => gk(mtz, c.codparc) === g); }
      else { const one = all.find((c: any) => Number(c.nunota) === Number(msgNun)); if (!one) return j({ erro: "pedido nao encontrado" }, 404); g = gk(mtz, one.codparc); membros = all.filter((c: any) => gk(mtz, c.codparc) === g); }
      if (!membros.length) return j({ erro: "grupo sem pedido" }, 404);
      const sede = membros.find((x: any) => Number(x.codparc) === g) || membros.slice().sort((a: any, b: any) => Number(b.valor) - Number(a.valor))[0];
      const lojasN = new Set(membros.map((m: any) => Number(m.codparc))).size;
      const memArr = Array.from(new Set(membros.map((m: any) => Number(m.codparc))));
      const valTot = membros.reduce((a: number, b: any) => a + (Number(b.valor) || 0), 0);
      const temSaldo = membros.some((m: any) => m.is_saldo);
      // documento so na lista AO REP: ao cliente seria o CNPJ dele proprio
      const DOC = publico === "rep" ? await docMap(sb, memArr) : {};
      const pedidos = membros.slice().sort((a: any, b: any) => Number(b.valor) - Number(a.valor)).map((c: any) => ({ nunota: c.nunota, loja: c.nome, doc: DOC[String(c.codparc)] || "", valor: Math.round(c.valor), valor_fmt: brl(c.valor), janela: c.janela, is_saldo: c.is_saldo }));
      const bd = pedidos.map((n: any) => "• " + n.loja + (n.doc ? ("\n  " + n.doc) : "")
        + `\n  ped ${n.nunota} ${n.valor_fmt}${n.is_saldo ? " (re-entrega de saldo)" : ""} · janela ${n.janela || "a combinar"}`);
      let repRow: any = null; if (sede.codvend != null) { const { data: rr, error } = await sb.from("snap_rep").select("*").eq("codvend", sede.codvend).maybeSingle(); if (error) throw error; repRow = rr; }
      const instancia = repRow?.assistente || null;
      const out: any[] = []; const seen: any = {}; let aviso: string | null = null;
      if (publico === "cliente") { await contatosRede(sb, memArr, out, seen); if (!out.length) aviso = "rede sem contato cadastrado"; }
      else { if (!repRow) aviso = "rep sem contato no snapshot"; else { pushCanal(out, seen, "whatsapp", repRow.celular, "Rep", "Sankhya"); pushCanal(out, seen, "whatsapp", repRow.fone_parc, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email_crm, "Rep", "CRM"); } }
      const rede = lojasN > 1;
      const nomeGrupo = String(sede.nome) + lj(lojasN);
      /* Ao rep o contexto NAO leva a lista: ela entra depois, em codigo. Levar a lista no prompt era
         o convite para a IA reescrever numero de pedido, valor e agora CNPJ. */
      const ctxBase = `${rede ? "Rede" : "Cliente"} ${nomeGrupo} (matriz cod ${g}). ${membros.length} pedido(s) prontos para agendar entrega, total ${brl(valTot)}${rede ? (", em " + lojasN + " lojas") : ""}.${temSaldo ? " Ha re-entrega(s) de saldo (parte que faltou)." : ""} Representante ${sede.rep}.`;
      const ctx = publico === "cliente" ? (ctxBase + ` Detalhe:\n${bd.join("\n")}`) : ctxBase;
      let sys = "";
      if (publico === "cliente") sys = `Voce e da Nitronplast (logistica/expedicao). Escreva UMA mensagem curta e cordial ao contato central ${rede ? "da REDE " + sede.nome : "do cliente"} avisando que ${rede ? membros.length + " pedidos estao" : "o pedido esta"} pronto(s) para entrega e pedindo o MELHOR DIA para agendar${rede ? " (pode listar os pedidos/lojas e as janelas)" : ", citando a janela dele"}. Se houver re-entrega de saldo, diga que e a parte que faltou. Curta, positiva, pt-BR. So a mensagem.`;
      else sys = `Voce fala em nome da Nitronplast COM o representante, que e PARCEIRO nosso. TOM (obrigatorio): comece cumprimentando pelo primeiro nome dele e perguntando como ele esta ("Oi ${sede.rep}, tudo bem?"). Avise que ${rede ? membros.length + " pedidos da rede " + sede.nome + " estao" : "um pedido de um cliente dele esta"} pronto(s) e so faltando AGENDAR a entrega — e uma boa noticia e um aviso, nao uma tarefa dele. Diga que a nossa logistica pode falar direto com o contato do cliente para marcar a data, ou ir junto com ele, como ele preferir. TERMINE oferecendo ajuda concreta e com uma pergunta aberta, no espirito de "o que podemos fazer para te ajudar a fechar essa data?". FORMATO OBRIGATORIO: NAO escreva a lista de pedidos. No lugar dela escreva o marcador literal [LISTA], em linha propria, exatamente uma vez — o sistema substitui pela lista real (loja, CNPJ, pedido, valor). NUNCA invente numero de pedido, valor, CNPJ ou nome de loja. PROIBIDO cobrar, exigir, impor prazo ao rep, escrever "peca que" ou "voce precisa", falar de meta ou insinuar atraso dele. Curta, pt-BR. So a mensagem.`;
      const fallbackRep = `Oi ${String(sede.rep || "").split(" ")[0] || "tudo bem"}, tudo bem?\n\nBoa noticia: ${membros.length} pedido(s) de ${nomeGrupo} ja estao prontos, so falta marcar a data de entrega (${brl(valTot)}).\n\n[LISTA]\n\nSe voce quiser, a logistica fala direto com o contato do cliente para agendar — ou vamos junto com voce, do jeito que funcionar melhor. O que podemos fazer para te ajudar a fechar essa data?`;
      const bruto = await claude(sys, "Contexto: " + ctx);
      let mensagem: string;
      if (publico === "rep") {
        const modelo = temLista(umaListaSo(bruto || "")) ? umaListaSo(bruto || "") : fallbackRep;
        mensagem = modelo.replace(/\[LISTA\]/gi, bd.join("\n"));
      } else {
        mensagem = bruto || "(nao foi possivel gerar)";
      }
      return j({ codparc: g, nunota: sede.nunota, nome: nomeGrupo, lojas: lojasN, publico, instancia, contatos: out, aviso, mensagem, valor: brl(valTot), pedidos, janela: sede.janela });
    }

    const { data: allRaw, error: eList } = await sb.from("agendar_pedido").select("*").limit(50000); if (eList) throw eList;
    const data = (allRaw || []).filter(flt);
    const by: Record<string, any[]> = {}; data.forEach((c: any) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); });
    const grupos = Object.keys(by).map((g) => { const ms = by[g]; const lojasN = new Set(ms.map((x) => Number(x.codparc))).size; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms.slice().sort((a, b) => Number(b.valor) - Number(a.valor))[0]; const valor = ms.reduce((a, b) => a + (Number(b.valor) || 0), 0); return { codparc: Number(g), nome: String(sede.nome) + lj(lojasN), lojas: lojasN, rep: sede.rep, valor: Math.round(valor), valor_fmt: brl(valor), n: ms.length, saldos: ms.filter((x) => x.is_saldo).length, pedidos: ms.slice().sort((a, b) => Number(b.valor) - Number(a.valor)).map((c) => ({ nunota: c.nunota, loja: c.nome, valor_fmt: brl(c.valor), janela: c.janela, is_saldo: c.is_saldo })) }; }).sort((a, b) => b.valor - a.valor);
    return j({ total: grupos.length, total_pedidos: data.length, saldos: data.filter((c: any) => c.is_saldo).length, total_valor: Math.round(grupos.reduce((a: number, b: any) => a + b.valor, 0)), grupos, clientes: grupos });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
