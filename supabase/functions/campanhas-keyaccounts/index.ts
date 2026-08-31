// campanhas-keyaccounts (v9) — duas coisas:
// 1. CNPJ NA MENSAGEM INTERNA (rep e gestor). Pedido do gestor: por nome fantasia ou razao social o
//    rep nao acha o cliente no sistema dele; pelo CNPJ acha. Aqui a mensagem e um texto corrido sobre
//    UMA conta, sem lista — entao a identificacao da conta vai anexada no fim, montada em codigo. A
//    IA e proibida de escrever documento: numero de CNPJ escrito por IA pode sair errado e mandar o
//    rep para outra empresa. Na mensagem AO CLIENTE nao entra: seria o documento dele proprio.
// 2. Saiu a chave de servico ESCRITA NO CODIGO. Este arquivo carregava um JWT service_role literal
//    como fallback do SRV_JWT — chave de administrador do banco, no fonte. Agora usa o mesmo
//    srvKey() das outras funcoes: SRV_JWT e, na falta dele, a injetada pela plataforma.
// campanhas-keyaccounts (v8) — grandes contas (Classe A). Lista CONSOLIDADA POR MATRIZ (parc_matriz): 1 card por grupo, soma ticket/saldo. Lista + ?roteiro=cod + ?msg=cod&publico=cliente|rep|gestor. ?angulo=<cod>. Exclui intra-grupo + nao-clientes-Nitron.
// v8: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa)
//     + TOM de parceria na mensagem ao representante.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const brl = (v: any) => v == null ? null : "R$ " + Math.round(Number(v)).toLocaleString("pt-BR");
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const MODELO = "claude-haiku-4-5-20251001";
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
const TOM_REP = "TOM com o representante (obrigatorio): ele e PARCEIRO. Comece cumprimentando pelo primeiro nome e perguntando como ele esta. Apresente tudo como apoio que preparamos para ele, nunca como tarefa nem cobranca. A decisao e dele. TERMINE oferecendo ajuda concreta e com uma pergunta aberta, no espirito de 'o que podemos fazer para te ajudar nessa conta?'. PROIBIDO cobrar, exigir, impor prazo ao rep, escrever 'peca que' ou 'voce precisa', falar de meta/ranking ou insinuar que ele esta atrasado.";
// A IA nao escreve documento: o sistema anexa a identificacao da conta depois, com o dado do cadastro.
const SEM_DOC = "NUNCA escreva CNPJ, CPF ou qualquer numero de documento — o sistema anexa a identificacao da conta no fim da mensagem.";
const ANG: Record<string, string> = {
  ka_cross_sell: "FOCO DESTA ABORDAGEM: CROSS-SELL. Priorize sugerir as LINHAS fortes do canal/ramo desta conta que ela ainda NAO compra (veja o cross-sell no dossie) para ampliar o mix e o ticket. Gancho principal = sortimento/mix.",
  ka_ruptura_rede: "FOCO DESTA ABORDAGEM: RUPTURA NA REDE. Priorize itens/linhas de alto giro que podem estar faltando na rede da conta (use saldo a entregar e tempo sem compra como pistas). Gancho principal = evitar ruptura na gondola.",
  ka_revisao_trimestral: "FOCO DESTA ABORDAGEM: REVISAO TRIMESTRAL / PLANO. Priorize a pauta estrategica do trimestre: desempenho, plano de sortimento, metas e proximos passos.",
};
async function intraSet(sb: any): Promise<Set<number>> { const { data, error } = await sb.from("parc_intragrupo").select("codparc"); if (error) throw error; return new Set((data || []).map((r: any) => Number(r.codparc))); }
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data, error } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); if (error) throw error; (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
function temTitulo(t: any) { const s = String(t || "").trim().toLowerCase(); if (!s) return false; if (["0", "nao", "não", "nenhum", "r$ 0,00", "0,00", "sem"].includes(s)) return false; return /\d/.test(s) && !/^r\$?\s*0/.test(s); }
function alertasDe(c: any): string[] { const a: string[] = []; if (temTitulo(c.titulos_vencidos)) a.push("Títulos vencidos (" + c.titulos_vencidos + ") — regularizar ANTES de nova venda"); if (/vencido|reativa|perdido/i.test(String(c.situacao || ""))) a.push("Fora do ciclo (" + c.situacao + ") — priorizar resgate"); if (Number(c.saldo_entregar) > 0) a.push("Saldo a entregar " + brl(c.saldo_entregar) + " — acompanhar entrega"); if (Number(c.dias) > 120) a.push(Number(c.dias) + " dias sem compra — conta esfriando"); return a; }
async function claude(sys: string, user: string, max = 700): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null;
  try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, max_tokens: max, temperature: 0.8, system: sys, messages: [{ role: "user", content: user }] }) }); if (!r.ok) return null; return (await r.json())?.content?.[0]?.text || null; } catch { return null; }
}
function pushCanal(out: any[], seen: any, canal: string, valor: any, funcao: string, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao, origem }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams;
    const roteiroCod = p.get("roteiro"); const msgCod = p.get("msg"); const angExtra = ANG[p.get("angulo") || ""] || "";

    if (msgCod) {
      const cp = Number(msgCod); const publico = p.get("publico") || "cliente";
      const { data: c, error: eC } = await sb.from("ghl_cliente").select("*").eq("codparc", cp).maybeSingle(); if (eC) throw eC;
      if (!c) return j({ erro: "conta nao encontrada" }, 404);
      // contatos da grande conta = de todas as lojas do grupo
      const mtz = await matrizMap(sb); const g = gk(mtz, cp);
      const membros = new Set<number>([cp]); for (const [k, v] of mtz) { if (v === g) membros.add(k); } if (g !== cp) membros.add(g);
      const memArr = Array.from(membros);
      let repRow: any = null;
      if (c.rep) { const { data: rr, error } = await sb.from("snap_rep").select("*").ilike("rep", String(c.rep)).limit(1); if (error) throw error; repRow = (rr || [])[0] || null; }
      const instancia = repRow?.assistente || null;
      const out: any[] = []; const seen: any = {}; let aviso: string | null = null;
      if (publico === "cliente") {
        const { data: sc, error: eSc } = await sb.from("snap_contato").select("*").in("codparc", memArr); if (eSc) throw eSc;
        const { data: gc, error: eGc } = await sb.from("ghl_contato").select("nome,fone,email").in("codparc", memArr); if (eGc) throw eGc;
        (sc || []).forEach((ct: any) => { pushCanal(out, seen, "whatsapp", ct.fone, ct.funcao || "Contato", "Sankhya"); pushCanal(out, seen, "email", ct.email, ct.funcao || "Contato", "Sankhya"); });
        (gc || []).forEach((gg: any) => { pushCanal(out, seen, "whatsapp", gg.fone, "CRM", "CRM"); pushCanal(out, seen, "email", gg.email, "CRM", "CRM"); });
        if (!out.length) aviso = "cliente sem contato cadastrado (Sankhya/CRM)";
      } else if (publico === "rep") {
        if (!repRow) aviso = "representante '" + (c.rep || "?") + "' sem contato no snapshot";
        else { pushCanal(out, seen, "whatsapp", repRow.celular, "Rep", "Sankhya"); pushCanal(out, seen, "whatsapp", repRow.fone_parc, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email_crm, "Rep", "CRM"); pushCanal(out, seen, "email", repRow.email_parc, "Rep", "Sankhya"); }
      } else { aviso = c.gestor ? ("gestor " + c.gestor + " sem contato — preencha no CRM") : "conta sem gestor definido no CRM (preencha o campo Gestor no GHL)"; }
      const dossie = c.resumo || `Conta ${c.razao} (cod ${c.codparc}). Ticket ${brl(c.ticket)}. Situacao ${c.situacao}. Canal ${c.canal}. Ramo ${c.ramo}. Rep ${c.rep}. Dias sem compra ${c.dias}. Saldo a entregar ${brl(c.saldo_entregar)}.` + (c.crosssell ? ` Cross-sell recomendado: ${c.crosssell}.` : "");
      const persona = "Voce e o DIRETOR COMERCIAL da Nitronplast (utilidades domesticas em plastico: NitronBox, rattan, potes, frasqueiras, lixeiras, limpeza). Balizas: grande conta e relacionamento; nunca prometer estoque/prazo sem confirmar; nunca preco fora de tabela; nunca cobrar/pressionar; nunca chamar saldo de parado.";
      let sys = "";
      if (publico === "cliente") sys = `${persona} Escreva UMA mensagem curta, executiva e consultiva DIRIGIDA AO COMPRADOR/LOJA da grande conta "${c.razao}" (NAO enderece ao representante), personalizada ao dossie, com 1 gancho concreto e 1 chamada para acao (agendar conversa ou revisar plano). 3-5 frases. pt-BR.`;
      else if (publico === "rep") sys = `${persona} Escreva UMA mensagem curta AO REPRESENTANTE responsavel por esta grande conta, oferecendo apoio: o que a gente levantou sobre a conta, ganchos concretos que ele pode usar e o que a gente pode preparar para ele. ${TOM_REP} ${SEM_DOC} Direto, 4-6 frases. pt-BR. So a mensagem.`;
      else sys = `${persona} Escreva UMA mensagem curta AO GESTOR/KAM interno com o briefing de acao desta grande conta. ${SEM_DOC} 3-5 frases. pt-BR.`;
      if (angExtra) sys += " " + angExtra;
      let mensagem = (await claude(sys, "Dossie da conta:\n" + dossie)) || "(nao foi possivel gerar agora)";
      /* Identificacao da conta, anexada em codigo: e por ela que quem recebe acha o cliente no
         sistema. Nao vai na mensagem ao cliente — ali seria o documento dele proprio. */
      const doc = fmtDoc(c.cnpj);
      if (publico !== "cliente") mensagem += "\n\nA conta: " + String(c.razao || "") + (doc ? ("\n" + doc) : "");
      return j({ codparc: cp, razao: c.razao, cnpj: c.cnpj || null, doc, publico, instancia, contatos: out, aviso, mensagem });
    }

    if (roteiroCod) {
      const { data: c, error: eC } = await sb.from("ghl_cliente").select("*").eq("codparc", Number(roteiroCod)).maybeSingle(); if (eC) throw eC;
      if (!c) return j({ erro: "conta nao encontrada" }, 404);
      let sys = "Voce e o DIRETOR COMERCIAL da Nitronplast preparando o BRIEFING de uma GRANDE CONTA (key account) para atendimento HUMANO consultivo. Com base no dossie, escreva um ROTEIRO DE ABORDAGEM em topicos: (1) leitura da conta em 1 linha, (2) objetivo, (3) 3-5 argumentos/ganchos concretos (cross-sell, ruptura, giro, ticket, sortimento das linhas Nitron), (4) pontos de atencao (titulos vencidos, saldo a entregar, tempo sem compra), (5) proximo passo. Direto, ~180 palavras. Balizas: grande conta e tratamento humano; nunca prometer estoque/prazo sem confirmar; nunca preco fora de tabela. " + SEM_DOC;
      if (angExtra) sys += " " + angExtra;
      const dossie = c.resumo || `Conta ${c.razao} (cod ${c.codparc}). Ticket ${brl(c.ticket)}. Situacao ${c.situacao}. Canal ${c.canal}. Ramo ${c.ramo}. Rep ${c.rep}. Dias sem compra ${c.dias}. Saldo a entregar ${brl(c.saldo_entregar)}. Classe ${c.classe}.` + (c.crosssell ? ` Cross-sell recomendado: ${c.crosssell}.` : "");
      const roteiro = await claude(sys, "Dossie da conta:\n" + dossie);
      // o roteiro e material interno: leva a identificacao da conta, com o documento do cadastro
      const doc = fmtDoc(c.cnpj);
      const cab = "Conta: " + String(c.razao || "") + (doc ? ("\n" + doc) : "") + "\n\n";
      return j({ codparc: c.codparc, razao: c.razao, cnpj: c.cnpj || null, doc, roteiro: roteiro ? (cab + roteiro) : "(nao foi possivel gerar agora)" });
    }

    const limit = Number(p.get("limit") || 60);
    const intra = await intraSet(sb); const mtz = await matrizMap(sb);
    const { data, error: eData } = await sb.from("ghl_cliente").select("*").eq("classe", "A").eq("nitron", true).order("ticket", { ascending: false, nullsFirst: false }).limit(limit + 400); if (eData) throw eData;
    const elig = (data || []).filter((c: any) => !intra.has(Number(c.codparc)));
    // consolida por matriz: 1 card por grupo, soma ticket/saldo, sede = maior ticket do grupo
    const by: Record<string, any[]> = {}; elig.forEach((c: any) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); });
    const grupos = Object.keys(by).map((g) => { const ms = by[g].slice().sort((a, b) => (Number(b.ticket) || 0) - (Number(a.ticket) || 0)); const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms[0]; const ticket = ms.reduce((a, b) => a + (Number(b.ticket) || 0), 0); const saldo = ms.reduce((a, b) => a + (Number(b.saldo_entregar) || 0), 0); return { ...sede, codparc: Number(g), ticket, saldo_entregar: saldo, lojas: ms.length }; }).sort((a, b) => (Number(b.ticket) || 0) - (Number(a.ticket) || 0)).slice(0, limit);
    const contas = grupos.map((c: any) => ({ codparc: c.codparc, razao: c.razao + (c.lojas > 1 ? ` (${c.lojas} lojas)` : ""), lojas: c.lojas, cnpj: c.cnpj, doc: fmtDoc(c.cnpj), canal: c.canal, ramo: c.ramo, classe: c.classe, ticket: Number(c.ticket) || 0, ticket_fmt: brl(c.ticket), situacao: c.situacao, rep: c.rep, gestor: c.gestor, dias: c.dias, mix: c.mix, saldo_entregar: Number(c.saldo_entregar) || 0, saldo_fmt: brl(c.saldo_entregar), titulos_vencidos: c.titulos_vencidos, score: c.score, resumo: c.resumo, alertas: alertasDe(c) }));
    return j({ total: contas.length, contas });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
