// campanhas-saldo (v6) — duas coisas:
// 1. CNPJ EM TODA LINHA DE CLIENTE. Pedido do gestor: por nome fantasia ou razao social o rep nao
//    acha o cliente no sistema dele; pelo CNPJ acha. Em linha propria, como nas campanhas — e aqui
//    faz ainda mais diferenca, porque rede grande tem loja com nome quase igual ("TUBARAO 61",
//    "TUBARAO 63") e o numero do pedido nao diz qual loja e.
// 2. Saiu a chave de servico ESCRITA NO CODIGO. Este arquivo carregava um JWT service_role literal
//    como fallback do SRV_JWT — chave de administrador do banco, no fonte, valida por anos. Agora usa
//    o mesmo srvKey() das outras funcoes: SRV_JWT e, na falta dele, a injetada pela plataforma.
// campanhas-saldo (v5) — duas mudancas:
// 1. chave de servico via srvKey(): SRV_JWT (JWT legado) e, se nao existir, a injetada pela
//    plataforma. Desde 23/08 a variavel antiga SUPABASE_SERVICE_ROLE_KEY vem com uma chave
//    sb_secret_ que o Data API recusa (PGRST303), e esta tela ficava zerada.
// 2. os cinco prompts SYS falam com REPRESENTANTE e estavam em tom de cobranca ("pedir
//    DECISAO agora", "foco: nao perder o faturamento"). Agora cumprimentam, apresentam a
//    lista como apoio e terminam oferecendo ajuda — mesma regra do TOM_REP.
// (v4) — modos liberar/parcial/sem_estoque/envelhece/consolidar. Vai ao REP (1 contato). [LISTA] AGRUPADA POR MATRIZ (parc_matriz): saldos da mesma rede juntos com subtotal. Sem rep: lista reps.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const brl = (v: any) => "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR");
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const MODELO = "claude-haiku-4-5-20251001";
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
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
// a lista da rede indenta os itens; com o documento em linha propria, o recuo vale para TODAS as linhas
const ind = (t: string, pre: string) => t.split("\n").map((l) => pre + l).join("\n");
function diasDe(dtneg: any) { if (!dtneg) return 0; const t = new Date(String(dtneg) + "T00:00:00").getTime(); if (!isFinite(t)) return 0; return Math.floor((Date.now() - t) / 86400000); }
function passa(modo: string, s: any) { const pct = Number(s.pct_atend) || 0; if (modo === "parcial") return pct >= 50 && pct < 90; if (modo === "sem_estoque") return pct < 50; if (modo === "envelhece") return pct >= 90 && s.atende && diasDe(s.dtneg) > 7; if (modo === "consolidar") return pct >= 50 && !s.atende; return pct >= 90 && s.atende; }
async function inadSet(sb: any) { const s = new Set<number>(); let f = 0; while (true) { const { data } = await sb.from("inadimplente").select("codparc").range(f, f + 999); (data || []).forEach((x: any) => s.add(Number(x.codparc))); if (!data || data.length < 1000) break; f += 1000; } const { data: ig } = await sb.from("parc_intragrupo").select("codparc"); (ig || []).forEach((x: any) => s.add(Number(x.codparc))); return s; }
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
async function claude(sys: string, user: string): Promise<string | null> { const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null; try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, max_tokens: 600, temperature: 0.8, system: sys, messages: [{ role: "user", content: user }] }) }); if (!r.ok) return null; return (await r.json())?.content?.[0]?.text || null; } catch { return null; } }
function pushCanal(out: any[], seen: any, canal: string, valor: any, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao: "Rep", origem }); }

// Tom obrigatorio com representante: parceiro, nunca alguem sendo cobrado.
const TOM = "TOM (obrigatorio): o representante e PARCEIRO. Comece cumprimentando pelo nome e perguntando como ele esta ('Oi [REP], tudo bem?'). Apresente a lista como um levantamento que fizemos para AJUDAR, nunca como tarefa ou pendencia dele. Deixe a decisao com ele. TERMINE oferecendo ajuda concreta e com uma pergunta aberta, no espirito de 'o que podemos fazer para te ajudar?'. PROIBIDO cobrar, exigir, impor prazo ao rep, falar de meta ou insinuar que ele esta atrasado.";
const SYS: Record<string, string> = {
  liberar: `Voce e o diretor comercial/logistica da Nitronplast. ${TOM} Escreva UMA mensagem AO REPRESENTANTE sobre SALDOS (sobra de pedidos entregues em parte) que estao com estoque disponivel agora. Explique que da para liberar e pergunte se ele quer que a gente siga com a liberacao - a decisao e dele. Use [REP] e [LISTA]. pt-BR. So a mensagem.`,
  parcial: `Voce e o diretor comercial/logistica da Nitronplast. ${TOM} Escreva UMA mensagem AO REPRESENTANTE sobre SALDOS com 50-90% em estoque: pergunte como ele prefere seguir, liberar parcial agora ou aguardar completar (cliente que 'nao corta' so recebe 100%), e ofereca ajuda para consultar o cliente. Use [REP] e [LISTA]. pt-BR. So a mensagem.`,
  sem_estoque: `Voce e o diretor de logistica/PCP da Nitronplast. ${TOM} Escreva UMA mensagem AO REPRESENTANTE informando que estes SALDOS dependem de reposicao de estoque (menos de 50% disponivel) e que a gente esta acompanhando com o PCP/compras. E informacao para ele nao ser pego de surpresa pelo cliente, nao tarefa. Use [REP] e [LISTA]. pt-BR. So a mensagem.`,
  envelhece: `Voce e o diretor comercial da Nitronplast. ${TOM} Escreva UMA mensagem AO REPRESENTANTE sobre SALDOS que estao aguardando liberacao ha mais de 7 dias. Leve o caso a ele, explique que pela politica o saldo vence entre 7 e 10 dias, pergunte como ele quer seguir e ofereca ajuda para falar com o cliente. Sem cobrar decisao. Use [REP] e [LISTA]. pt-BR. So a mensagem.`,
  consolidar: `Voce e o diretor comercial/logistica da Nitronplast. ${TOM} Estes SALDOS tem estoque mas o valor nao atinge o minimo para faturar sozinho (frete). Escreva UMA mensagem AO REPRESENTANTE sugerindo juntar este saldo no proximo pedido do cliente para atingir o minimo, e ofereca ajuda para montar a consolidacao. Use [REP] e [LISTA]. pt-BR. So a mensagem.`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams; const repParam = p.get("rep"); const modo = p.get("modo") || "liberar";
    const inad = await inadSet(sb);
    const { data: sal } = await sb.from("saldo_pedido").select("*").gte("valorpend", 1000).limit(20000);
    const elig = (sal || []).filter((s: any) => !inad.has(Number(s.codparc)) && passa(modo, s));
    if (!repParam) {
      const reps: Record<string, any> = {};
      elig.forEach((s: any) => { if (s.codvend == null) return; const k = String(s.codvend); if (!reps[k]) reps[k] = { codvend: s.codvend, rep: s.rep, saldos: 0, total: 0 }; reps[k].saldos++; reps[k].total += Number(s.valorpend) || 0; });
      const lista = Object.values(reps).map((r: any) => ({ ...r, total: Math.round(r.total) })).sort((a: any, b: any) => b.total - a.total);
      return j({ modo, reps: lista, total_saldos: elig.length, total_valor: Math.round(elig.reduce((a: number, b: any) => a + (Number(b.valorpend) || 0), 0)) });
    }
    const rep = parseInt(repParam);
    const meus = elig.filter((s: any) => Number(s.codvend) === rep);
    const { data: sr } = await sb.from("snap_rep").select("*").eq("codvend", rep).maybeSingle();
    const nome = meus[0]?.rep || sr?.rep || ("Rep " + rep);
    const out: any[] = []; const seen: any = {};
    if (sr) { pushCanal(out, seen, "whatsapp", sr.celular, "Sankhya"); pushCanal(out, seen, "whatsapp", sr.fone_parc, "Sankhya"); pushCanal(out, seen, "email", sr.email, "Sankhya"); pushCanal(out, seen, "email", sr.email_crm, "CRM"); }
    // agrupa por matriz
    const mtz = await matrizMap(sb);
    const grp: Record<string, any[]> = {}; meus.forEach((s: any) => { const g = gk(mtz, s.codparc); (grp[g] = grp[g] || []).push(s); });
    const blocos = Object.keys(grp).map((g) => { const ms = grp[g].sort((a, b) => Number(b.valorpend) - Number(a.valorpend)); const lojasN = new Set(ms.map((x) => Number(x.codparc))).size; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms[0]; const tot = ms.reduce((a, b) => a + (Number(b.valorpend) || 0), 0); return { ms, lojasN, nome: sede.nome, tot }; }).sort((a, b) => b.tot - a.tot);
    /* O documento e o da LOJA daquela linha, nao o da matriz do grupo: numa rede as lojas tem nome
       quase igual, e e justamente ai que o rep precisa do CNPJ para nao abrir o pedido errado. */
    const DOC = await docMap(sb, meus.map((s: any) => Number(s.codparc)));
    const linha = (s: any) => "• " + s.nome
      + (DOC[String(s.codparc)] ? ("\n  " + DOC[String(s.codparc)]) : "")
      + `\n  ped ${s.nunota} — ${brl(s.valorpend)} · ${s.pct_atend}% estoque${modo === "envelhece" ? (" · " + diasDe(s.dtneg) + "d parado") : ""}`;
    const lista = blocos.map((b) => b.lojasN > 1 ? (`▸ ${b.nome}${lj(b.lojasN)} — total ${brl(b.tot)}:\n` + b.ms.map((s) => ind(linha(s), "  ")).join("\n")) : linha(b.ms[0])).join("\n");
    const saldosFlat: any[] = []; blocos.forEach((b) => b.ms.forEach((s) => saldosFlat.push({ nunota: s.nunota, nome: s.nome, doc: DOC[String(s.codparc)] || "", valorpend: Math.round(s.valorpend), pct: s.pct_atend, rede: b.lojasN > 1 ? b.nome : null })));
    const modelo = (await claude(SYS[modo] || SYS.liberar, "Escreva usando [REP] e [LISTA].")) || "Oi [REP], tudo bem?\n\nSeparamos alguns saldos da sua carteira que podem fazer sentido resolver agora:\n\n[LISTA]\n\nO que podemos fazer para te ajudar? Se quiser que a gente consulte algum desses clientes antes, me fala.";
    const mensagem = modelo.replace(/\[REP\]/gi, nome).replace(/\[LISTA\]/gi, lista);
    return j({ modo, rep: nome, codvend: rep, instancia: sr?.assistente || null, contatos: out, saldos: saldosFlat, mensagem });
  } catch (e) { return j({ erro: String(e) }, 500); }
});
