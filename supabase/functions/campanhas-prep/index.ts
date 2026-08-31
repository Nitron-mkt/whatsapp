// campanhas-prep (v5) — CNPJ EM TODA LINHA DE CLIENTE. Pedido do gestor: por nome fantasia ou razao
// social o rep nao acha o cliente no sistema dele; pelo CNPJ acha. Em linha propria, como nas
// campanhas. Aqui pesa mais: numa rede as lojas tem nome quase igual, e o rep precisa saber QUAL
// loja esta com o pedido travado.
// campanhas-prep (v4) — prep_liberar: pedidos bloqueados p/ destravar. Vai ao REP (1 contato). [LISTA] AGRUPADA POR MATRIZ (parc_matriz): pedidos da mesma rede juntos com subtotal. Sem rep: lista reps.
// v3: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa)
//     + TOM de parceria com o representante (aviso e ajuda, nunca cobranca) + guarda umaListaSo() contra [LISTA] duplicado.
// v4: os marcadores voltam EXPLICITOS no prompt (sem eles a IA inventava nome e pedidos falsos) e temMarcadores()
//     descarta qualquer texto que nao traga os dois — e melhor cair no modelo fixo do que mandar dado inventado ao rep.
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
// a lista da rede indenta os itens; com o documento em linha propria, o recuo vale para TODAS as linhas
const ind = (t: string, pre: string) => t.split("\n").map((l) => pre + l).join("\n");
// Se a IA repetir o token, a lista inteira iria duas vezes na mensagem do rep. Mantem so a ultima ocorrencia.
function umaListaSo(t: string) { const partes = String(t || "").split(/\[LISTA\]/i); if (partes.length <= 2) return String(t || ""); return partes.slice(0, -1).join("lista") + "[LISTA]" + partes[partes.length - 1]; }
// Sem os dois marcadores o texto da IA teria nome e pedidos INVENTADOS: descarta e usa o modelo fixo.
const temMarcadores = (t: string) => /\[REP\]/i.test(String(t || "")) && /\[LISTA\]/i.test(String(t || ""));
async function inadSet(sb: any) { const s = new Set<number>(); let f = 0; while (true) { const { data, error } = await sb.from("inadimplente").select("codparc").range(f, f + 999); if (error) throw error; (data || []).forEach((x: any) => s.add(Number(x.codparc))); if (!data || data.length < 1000) break; f += 1000; } return s; }
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data, error } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); if (error) throw error; (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
async function claude(sys: string, user: string): Promise<string | null> { const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null; try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, max_tokens: 600, temperature: 0.8, system: sys, messages: [{ role: "user", content: user }] }) }); if (!r.ok) return null; return (await r.json())?.content?.[0]?.text || null; } catch { return null; } }
function pushCanal(out: any[], seen: any, canal: string, valor: any, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao: "Rep", origem }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams; const repParam = p.get("rep");
    const inad = await inadSet(sb);
    const { data: ped, error: ePed } = await sb.from("prep_pedido").select("*").limit(20000); if (ePed) throw ePed;
    const elig = (ped || []).filter((s: any) => !inad.has(Number(s.codparc)));
    if (!repParam) {
      const reps: Record<string, any> = {};
      elig.forEach((s: any) => { if (s.codvend == null) return; const k = String(s.codvend); if (!reps[k]) reps[k] = { codvend: s.codvend, rep: s.rep, saldos: 0, total: 0 }; reps[k].saldos++; reps[k].total += Number(s.valor) || 0; });
      const lista = Object.values(reps).map((r: any) => ({ ...r, total: Math.round(r.total) })).sort((a: any, b: any) => b.total - a.total);
      return j({ reps: lista, total_saldos: elig.length, total_valor: Math.round(elig.reduce((a: number, b: any) => a + (Number(b.valor) || 0), 0)) });
    }
    const rep = parseInt(repParam);
    const meus = elig.filter((s: any) => Number(s.codvend) === rep);
    const { data: sr, error: eSr } = await sb.from("snap_rep").select("*").eq("codvend", rep).maybeSingle(); if (eSr) throw eSr;
    const nome = meus[0]?.rep || sr?.rep || ("Rep " + rep);
    const primeiro = String(nome).split(" ")[0] || nome;
    const out: any[] = []; const seen: any = {};
    if (sr) { pushCanal(out, seen, "whatsapp", sr.celular, "Sankhya"); pushCanal(out, seen, "whatsapp", sr.fone_parc, "Sankhya"); pushCanal(out, seen, "email", sr.email, "Sankhya"); pushCanal(out, seen, "email", sr.email_crm, "CRM"); }
    const mtz = await matrizMap(sb);
    const grp: Record<string, any[]> = {}; meus.forEach((s: any) => { const g = gk(mtz, s.codparc); (grp[g] = grp[g] || []).push(s); });
    const blocos = Object.keys(grp).map((g) => { const ms = grp[g].sort((a, b) => Number(b.valor) - Number(a.valor)); const lojasN = new Set(ms.map((x) => Number(x.codparc))).size; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms[0]; const tot = ms.reduce((a, b) => a + (Number(b.valor) || 0), 0); return { ms, lojasN, nome: sede.nome, tot }; }).sort((a, b) => b.tot - a.tot);
    /* O documento e o da LOJA daquela linha, nao o da matriz do grupo: e o pedido daquela loja que
       esta travado, e e por ele que o rep vai procurar. */
    const DOC = await docMap(sb, meus.map((s: any) => Number(s.codparc)));
    const linha = (s: any) => "• " + s.nome
      + (DOC[String(s.codparc)] ? ("\n  " + DOC[String(s.codparc)]) : "")
      + `\n  ped ${s.nunota} — ${brl(s.valor)} · travado ha ${s.dias}d`;
    const lista = blocos.map((b) => b.lojasN > 1 ? (`▸ ${b.nome}${lj(b.lojasN)} — total ${brl(b.tot)}:\n` + b.ms.map((s) => ind(linha(s), "  ")).join("\n")) : linha(b.ms[0])).join("\n");
    const saldosFlat: any[] = []; blocos.forEach((b) => b.ms.forEach((s) => saldosFlat.push({ nunota: s.nunota, nome: s.nome, doc: DOC[String(s.codparc)] || "", valorpend: Math.round(s.valor), pct: null, dias: s.dias, rede: b.lojasN > 1 ? b.nome : null })));
    const sys = "Voce fala em nome da Nitronplast COM o representante, que e PARCEIRO nosso. Assunto: pedidos DELE que estao BLOQUEADOS aguardando liberacao (comercial/financeiro/cadastro) e por isso nao faturam. " +
      "FORMATO OBRIGATORIO: escreva um MODELO com dois marcadores literais. Use [REP] no lugar do nome dele (exatamente uma vez) e [LISTA] no lugar da lista de pedidos (exatamente uma vez, em linha propria). " +
      "NUNCA invente nome de pessoa, numero de pedido, valor ou item de lista — quem preenche isso e o sistema, depois. Nao escreva exemplos de pedidos. " +
      "TOM (obrigatorio): comece cumprimentando [REP] e perguntando como ele esta. Apresente a lista como um LEVANTAMENTO que fizemos para ajudar — ele pode nem saber que travou. Deixe claro que a gente pode correr atras da liberacao internamente. " +
      "TERMINE oferecendo ajuda concreta e com uma pergunta aberta, no espirito de 'o que podemos fazer para te ajudar a destravar?'. " +
      "PROIBIDO cobrar, exigir, impor prazo ao rep, escrever 'peca que', 'voce precisa', 'e importante que voce', falar de meta, ranking ou insinuar que ele esta atrasado ou que vai perder a venda por culpa dele. " +
      "Direto, pt-BR, curta. So a mensagem.";
    const fixo = `Oi [REP], tudo bem?\n\nDei uma olhada nos seus pedidos e alguns estao parados aguardando liberacao — queria te avisar para voce nao ser pego de surpresa:\n\n[LISTA]\n\nSe voce quiser, a gente corre atras da liberacao por aqui. O que podemos fazer para te ajudar a destravar?`;
    const bruto = umaListaSo((await claude(sys, "Escreva o modelo com [REP] e [LISTA].")) || "");
    const modelo = temMarcadores(bruto) ? bruto : fixo;
    const mensagem = modelo.replace(/\[REP\]/gi, primeiro).replace(/\[LISTA\]/gi, lista);
    return j({ rep: nome, codvend: rep, instancia: sr?.assistente || null, contatos: out, saldos: saldosFlat, mensagem });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
