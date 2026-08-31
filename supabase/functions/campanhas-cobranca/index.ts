// campanhas-cobranca (v6) — CNPJ NA LISTA QUE VAI AO REPRESENTANTE, e a lista deixa de ser escrita
// pela IA. Duas coisas ligadas:
//   1. Pedido do gestor: por nome fantasia ou razao social o rep nao acha o cliente no sistema dele;
//      pelo CNPJ acha. Numa rede com titulo vencido isso e critico — as lojas tem nome quase igual
//      ("TUBARAO 61", "TUBARAO 63") e o rep precisa saber em qual esta o vencido.
//   2. Antes a IA escrevia o texto inteiro a partir do contexto, inclusive os valores por loja. Com
//      CNPJ isso seria inaceitavel: um digito trocado manda o rep cobrar outra empresa. Agora, na
//      mensagem AO REP, a IA escreve so o texto em volta e o marcador [LISTA]; a lista entra depois,
//      em codigo. Sem o marcador, cai no modelo fixo.
// campanhas-cobranca (v5) — chave de servico via srvKey(): SRV_JWT (JWT legado) e, se nao
// existir, a injetada pela plataforma. Desde 23/08 a plataforma preenche a variavel antiga
// SUPABASE_SERVICE_ROLE_KEY com uma chave sb_secret_ que o Data API recusa (PGRST303).
// (v4) — titulo vencido CONSOLIDADO POR MATRIZ (parc_matriz): 1 card por rede, soma vencido/titulos de TODAS as lojas, maior atraso. ?msg=<matriz>&publico=cliente|rep cobra a REDE inteira num contato central, listando o vencido de cada loja. ?bucket=a_cobrar|juridico. Exclui intra-grupo.
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
// Se a IA repetir o marcador, a lista inteira sairia duas vezes. Mantem so a ultima ocorrencia.
function umaListaSo(t: string) { const partes = String(t || "").split(/\[LISTA\]/i); if (partes.length <= 2) return String(t || ""); return partes.slice(0, -1).join("lista") + "[LISTA]" + partes[partes.length - 1]; }
const temLista = (t: string) => /\[LISTA\]/i.test(String(t || ""));
async function intraSet(sb: any): Promise<Set<number>> { const { data } = await sb.from("parc_intragrupo").select("codparc"); return new Set((data || []).map((r: any) => Number(r.codparc))); }
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
async function claude(sys: string, user: string): Promise<string | null> { const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null; try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, max_tokens: 600, temperature: 0.7, system: sys, messages: [{ role: "user", content: user }] }) }); if (!r.ok) return null; return (await r.json())?.content?.[0]?.text || null; } catch { return null; } }
function pushCanal(out: any[], seen: any, canal: string, valor: any, funcao: string, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao, origem }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams; const msgCod = p.get("msg");
    const mtz = await matrizMap(sb);

    if (msgCod) {
      const g = Number(msgCod); const publico = p.get("publico") || "cliente";
      // todas as lojas do grupo com vencido
      const { data: allc } = await sb.from("cobranca_cliente").select("*").limit(50000);
      const membros = (allc || []).filter((c: any) => gk(mtz, c.codparc) === g);
      if (!membros.length) return j({ erro: "grupo sem vencido" }, 404);
      const sede = membros.find((x: any) => Number(x.codparc) === g) || membros.slice().sort((a: any, b: any) => Number(b.valor_vencido) - Number(a.valor_vencido))[0];
      const memArr = membros.map((m: any) => Number(m.codparc));
      const totalVenc = membros.reduce((a: number, b: any) => a + (Number(b.valor_vencido) || 0), 0);
      const totalTit = membros.reduce((a: number, b: any) => a + (Number(b.n_titulos) || 0), 0);
      const maxAtraso = Math.max(...membros.map((m: any) => Number(m.maior_atraso) || 0));
      // documento so na lista AO REP: ao cliente seria o CNPJ dele proprio
      const DOC = publico === "rep" ? await docMap(sb, memArr) : {};
      const breakdown = membros.slice().sort((a: any, b: any) => Number(b.valor_vencido) - Number(a.valor_vencido)).map((m: any) => {
        const doc = DOC[String(m.codparc)] || "";
        return "• " + m.nome + (doc ? ("\n  " + doc) : "") + `\n  ${brl(m.valor_vencido)} (${m.n_titulos} tit., maior atraso ${m.maior_atraso}d)`;
      });
      let repRow: any = null; if (sede.codvend != null) { const { data: rr } = await sb.from("snap_rep").select("*").eq("codvend", sede.codvend).maybeSingle(); repRow = rr; }
      const instancia = repRow?.assistente || null;
      const out: any[] = []; const seen: any = {}; let aviso: string | null = null;
      if (publico === "cliente") {
        // contato central da rede = de todas as lojas do grupo
        const { data: sc } = await sb.from("snap_contato").select("*").in("codparc", memArr);
        const { data: gc } = await sb.from("ghl_contato").select("nome,fone,email").in("codparc", memArr);
        (sc || []).forEach((ct: any) => { pushCanal(out, seen, "whatsapp", ct.fone, ct.funcao || "Contato", "Sankhya"); pushCanal(out, seen, "email", ct.email, ct.funcao || "Contato", "Sankhya"); });
        (gc || []).forEach((gg: any) => { pushCanal(out, seen, "whatsapp", gg.fone, "CRM", "CRM"); pushCanal(out, seen, "email", gg.email, "CRM", "CRM"); });
        if (!out.length) aviso = "rede sem contato cadastrado";
      } else {
        if (!repRow) aviso = "rep sem contato no snapshot";
        else { pushCanal(out, seen, "whatsapp", repRow.celular, "Rep", "Sankhya"); pushCanal(out, seen, "whatsapp", repRow.fone_parc, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email_crm, "Rep", "CRM"); }
      }
      const rede = membros.length > 1;
      const nomeGrupo = String(sede.nome) + lj(membros.length);
      /* Ao rep o contexto NAO leva o detalhe por loja: ele entra depois, em codigo, com o CNPJ. */
      const ctxBase = `Rede ${nomeGrupo} (matriz cod ${g}). Total vencido do grupo ${brl(totalVenc)} em ${totalTit} titulo(s), maior atraso ${maxAtraso} dias, ${membros.length} loja(s).`;
      const ctx = (publico === "cliente" && rede)
        ? (ctxBase + " Detalhe por loja:\n" + breakdown.join("\n") + ` Representante ${sede.rep}.`)
        : (ctxBase + ` Representante ${sede.rep}.`);
      let sys = "";
      if (publico === "cliente") sys = `Voce e o financeiro/comercial da Nitronplast. Escreva UMA mensagem CORDIAL de cobranca (1o toque, SEM ameaca) ao contato central da ${rede ? "REDE" : "loja"} "${sede.nome}". ${rede ? "Trate a rede como um todo: cite o TOTAL vencido do grupo e mencione que ha titulos em " + membros.length + " lojas (pode oferecer o detalhe por loja). " : ""}Ofereca a 2a via consolidada (boleto ou Pix) e um canal para negociar/parcelar. NUNCA cite outros clientes/redes. Curta, profissional, pt-BR. Responda so a mensagem.`;
      else sys = `Voce e o diretor comercial da Nitronplast. Escreva UMA mensagem curta AO REPRESENTANTE avisando que a ${rede ? "rede" : "conta"} da carteira dele esta com titulo vencido (total ${brl(totalVenc)}, maior atraso ${maxAtraso} dias${rede ? ", em " + membros.length + " lojas" : ""}). Comece cumprimentando e perguntando como ele esta. Explique a regra com cuidado, sem culpar o rep: por politica nao da para faturar novo pedido enquanto houver vencido. Ofereca ajuda para regularizar junto ao cliente e termine perguntando o que a Nitron pode fazer para ajudar. FORMATO OBRIGATORIO: NAO escreva o detalhe por loja. No lugar dele escreva o marcador literal [LISTA], em linha propria, exatamente uma vez — o sistema substitui pela lista real (loja, CNPJ, vencido, titulos). NUNCA invente valor, CNPJ ou nome de loja. NAO cobre o rep nem imponha prazo a ele. pt-BR. Responda so a mensagem.`;
      const fallbackRep = `Oi ${String(sede.rep || "").split(" ")[0] || "tudo bem"}, tudo bem?\n\nUm aviso sobre ${nomeGrupo}, da sua carteira: ha ${brl(totalVenc)} vencido em ${totalTit} titulo(s), com maior atraso de ${maxAtraso} dias.\n\n[LISTA]\n\nPela politica, enquanto houver vencido nao da para faturar pedido novo — por isso queria te avisar antes de travar algum pedido seu. Se quiser, a gente fala com o financeiro do cliente para resolver, junto com voce ou no seu lugar. O que a Nitron pode fazer para te ajudar aqui?`;
      const bruto = await claude(sys, "Contexto: " + ctx);
      let mensagem: string;
      if (publico === "rep") {
        const modelo = temLista(umaListaSo(bruto || "")) ? umaListaSo(bruto || "") : fallbackRep;
        mensagem = modelo.replace(/\[LISTA\]/gi, breakdown.join("\n"));
      } else {
        mensagem = bruto || "(nao foi possivel gerar)";
      }
      return j({ codparc: g, nome: nomeGrupo, lojas: membros.length, publico, instancia, contatos: out, aviso, mensagem, valor: brl(totalVenc), atraso: maxAtraso, titulos: totalTit, breakdown });
    }

    const bucket = p.get("bucket") || "a_cobrar"; const limit = Number(p.get("limit") || 200);
    const intra = await intraSet(sb);
    const { data } = await sb.from("cobranca_cliente").select("*").eq("bucket", bucket).limit(50000);
    const elig = (data || []).filter((c: any) => !intra.has(Number(c.codparc)));
    // consolida por matriz
    const by: Record<string, any[]> = {}; elig.forEach((c: any) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); });
    const grupos = Object.keys(by).map((g) => { const ms = by[g]; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms.slice().sort((a, b) => Number(b.valor_vencido) - Number(a.valor_vencido))[0]; return { codparc: Number(g), nome: String(sede.nome) + lj(ms.length), lojas: ms.length, rep: sede.rep, valor: ms.reduce((a, b) => a + (Number(b.valor_vencido) || 0), 0), atraso: Math.max(...ms.map((x) => Number(x.maior_atraso) || 0)), titulos: ms.reduce((a, b) => a + (Number(b.n_titulos) || 0), 0) }; }).sort((a, b) => b.valor - a.valor).slice(0, limit);
    const outro = bucket === "a_cobrar" ? "juridico" : "a_cobrar";
    const { data: od } = await sb.from("cobranca_cliente").select("codparc").eq("bucket", outro);
    const coSet = new Set((od || []).filter((x: any) => !intra.has(Number(x.codparc))).map((x: any) => gk(mtz, x.codparc)));
    const clientes = grupos.map((c: any) => ({ codparc: c.codparc, nome: c.nome, lojas: c.lojas, rep: c.rep, valor: Math.round(c.valor), valor_fmt: brl(c.valor), atraso: c.atraso, titulos: c.titulos }));
    return j({ bucket, total: clientes.length, juridico: bucket === "a_cobrar" ? coSet.size : undefined, a_cobrar: bucket === "juridico" ? coSet.size : undefined, total_valor: Math.round(clientes.reduce((a: number, b: any) => a + b.valor, 0)), clientes });
  } catch (e) { return j({ erro: String(e) }, 500); }
});
