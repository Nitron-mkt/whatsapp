// campanhas-disparar (v46) — trava umaListaSo(): se a IA escrever [LISTA] duas vezes, a lista
// inteira saia repetida para o rep. Agora vale a ultima ocorrencia.
// (v45) — TOM_REP: toda mensagem ao representante cumprimenta, apresenta a
// lista como apoio (nao tarefa) e termina oferecendo ajuda com pergunta aberta. Proibido cobrar,
// dar prazo, falar de meta/ranking ou de perder cliente pro concorrente.
// (v44) — GIRO/resgate: bullet do rep mostra 'ticket medio R$X · Yd sem comprar' (ticket medio = faturamento_12m / num_compras, de contato_enriquecido = valor medio por pedido/reposicao). IA explica que e o quanto o cliente costuma por em cada pedido, NAO cobranca/saldo. Consolida por matriz. Exclui INAD+INTRA. MOTOR nitron=true. GARANTE [LISTA].
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const brl = (v: number) => "R$ " + Math.round(v).toLocaleString("pt-BR");
const MODELO = "claude-haiku-4-5-20251001";
const fmtDate = (s: any) => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}` : (s ? String(s) : ""); };
const lj = (n: any) => (Number(n) > 1 ? ` (${n} lojas)` : "");
const GIRO: Record<string, string[]> = { recompra_giro_a_vencer: ["A_VENCER"], recompra_giro_vencido: ["VENCIDO"], rep_sem_comprar: ["VENCIDO", "REATIVACAO"] };
const MOTOR: Record<string, number> = { recompra_cross_sell: 1, rep_sugestao_produto: 1, rep_roteiro_visitas: 1, clube_a_vencer: 1, recompra_novo_produto: 1 };
function parseJSON(t: string): any { try { const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } }
function fill(s: string, map: Record<string, string>) { let o = String(s || ""); for (const k in map) o = o.replace(new RegExp("\\[" + k + "\\]", "gi"), map[k]); return o; }
function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function umaListaSo(t: string) {
  const partes = String(t || "").split(/\[LISTA\]/i);
  if (partes.length <= 2) return String(t || "");
  return partes.slice(0, -1).join("lista") + "[LISTA]" + partes[partes.length - 1];
}
function garantirLista(p: any) {
  if (!/\[LISTA\]/i.test(String(p.whatsapp || ""))) p.whatsapp = String(p.whatsapp || "").replace(/\s+$/, "") + "\n\n[LISTA]";
  if (!/\[LISTA\]/i.test(String(p.email_corpo || ""))) p.email_corpo = String(p.email_corpo || "").replace(/\s+$/, "") + "\n\n[LISTA]";
  p.whatsapp = umaListaSo(p.whatsapp); p.email_corpo = umaListaSo(p.email_corpo);
  return p;
}
async function inadSet(sb: any) { const s = new Set<number>(); let from = 0; while (true) { const { data } = await sb.from("inadimplente").select("codparc").range(from, from + 999); (data || []).forEach((x: any) => s.add(Number(x.codparc))); if (!data || data.length < 1000) break; from += 1000; } const { data: ig } = await sb.from("parc_intragrupo").select("codparc"); (ig || []).forEach((x: any) => s.add(Number(x.codparc))); return s; }
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
function consVoucher(rows: any[], mtz: Map<number, number>) { const by: Record<string, any[]> = {}; rows.forEach((c) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); }); return Object.keys(by).map((g) => { const ms = by[g].slice().sort((a, b) => String(a.dtvalidade).localeCompare(String(b.dtvalidade))); const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms[0]; return { codparc: Number(g), nome: String(sede.nome), pct: Number(ms[0].pct), dtvalidade: ms[0].dtvalidade, lojas: ms.length }; }); }

const BASE = "Voce e o DIRETOR COMERCIAL da Nitronplast - industria de utilidades domesticas em plastico do Grupo Hyak. Linhas: organizacao (NitronBox, rattan), potes, frasqueiras, lixeiras, limpeza/cozinha/banheiro. Clientes sao LOJISTAS que revendem. Escreva como vendedor senior consultivo: humano, direto, com bons ARGUMENTOS DE VENDA - nunca robotico, generico nem insistente. Lidere pelo BENEFICIO do lojista (giro, nao faltar na gondola, ticket, sortimento, margem), baixa friccao, UMA chamada para acao, tom de parceria. NUNCA pressionar/cobrar; NUNCA prometer prazo/estoque sem confirmar; NUNCA preco fora de contexto; NUNCA chamar saldo de parado. pt-BR do varejo, frases curtas, no maximo 1 emoji, VARIE a abertura (fuja de cliche).";
const ANG_CLI = ["Enfatize evitar RUPTURA na gondola.", "Enfatize GIRO das linhas Nitron.", "Enfatize a CONDICAO/oportunidade agora.", "Puxe pelo RELACIONAMENTO/parceria.", "Enfatize a FACILIDADE de fechar o pedido.", "Traga gancho de MIX/sortimento para subir o ticket."];
const ANG_REP = ["Ofereca ajudar a priorizar a carteira dele.", "Ofereca levantar informacao do cliente antes do contato.", "Puxe pela parceria rep + Nitron.", "Ofereca apoio para montar a condicao ou a proposta.", "Reconheca o trabalho dele e pergunte como a Nitron pode facilitar."];

// Tom obrigatorio de TODA mensagem que vai para representante. O rep e parceiro, nao alvo de
// cobranca: a lista que vai junto e apoio que preparamos, nao tarefa que estamos exigindo.
const TOM_REP = "TOM COM O REPRESENTANTE (obrigatorio, vale mais que qualquer outra instrucao): o rep e PARCEIRO, nunca alguem sendo cobrado. "
  + "1) Comece cumprimentando pelo nome e perguntando como ele esta - ex 'Oi [REP], tudo bem?'. "
  + "2) Apresente a lista como um LEVANTAMENTO QUE FIZEMOS PARA AJUDAR ele: 'separamos', 'levantamos', 'pode fazer sentido para voce'. Nunca como tarefa ou pendencia dele. "
  + "3) Deixe claro que a decisao e dele: e sugestao, ele ajusta como preferir. "
  + "4) TERMINE SEMPRE oferecendo ajuda concreta e com uma PERGUNTA ABERTA, no espirito de: 'O que podemos fazer para te ajudar? Tem algum cliente em que voce queira um apoio antes do contato, ou alguma informacao que a gente possa levantar para voce?'. "
  + "5) PROIBIDO: cobrar, exigir, dar prazo ao rep, mandar ('precisa', 'tem que', 'nao deixe de', 'cobre', 'garanta', 'priorize'), falar de meta, resultado do mes, ranking, ou insinuar que ele esta devendo ou atrasado. PROIBIDO falar de perder cliente para o concorrente. "
  + "6) Sem tom de chefia nem de auditoria: escreva como colega que preparou material para facilitar o dia dele.";

const CTX: Record<string, any> = {
  clube_saldo: { valor: "[VALOR] e um valor em dinheiro (ex: 'R$ 12.500') = DIREITO DE COMPRA do trimestre no Clube Nitron. Escreva ex: 'voce tem [VALOR] de direito de compra no Clube Nitron'. NUNCA saldo parado.", cliente: "Convide a aproveitar a condicao do Clube e repor o trimestre.", rep: "A lista traz clientes DELE com direito de compra do trimestre disponivel no Clube. Explique o que e e ofereca ajuda para ele aproveitar isso junto desses clientes." },
  voucher_empurrar: { valor: "[VALOR] e um percentual (ex '6%') de desconto no voucher e [VALIDADE] e a DATA LIMITE. Escreva ex 'voce tem [VALOR] de desconto no voucher, valido ate [VALIDADE]'. De DIRECIONAMENTO: e a hora de fazer o pedido do mes / repor o sortimento que mais gira aproveitando o desconto, fechando ANTES do prazo.", cliente: "Avise do [VALOR] de desconto valido ate [VALIDADE] e de DIRECIONAMENTO CONCRETO: convide a MONTAR O PEDIDO AGORA para repor o sortimento/estoque que gira aproveitando a condicao, completando o mix, com urgencia gentil (o prazo esta chegando). Um argumento concreto + 1 CTA clara. NAO seja generico.", rep: "A lista logo abaixo traz os clientes DELE com voucher a vencer (nome + % + validade). Diga que a lista vem abaixo e explique que e um desconto ja liberado, com data limite real. Ofereca ajuda para ele falar com esses clientes antes do prazo - sem cobrar visita nem impor prazo a ele." },
  recompra_giro_a_vencer: { valor: "[VALOR] e um tempo (ex '45 dias') sem comprar; o ciclo de recompra (giro) esta chegando ao fim. Escreva ex 'ja faz [VALOR] desde a ultima compra'. NUNCA saldo/cobranca.", cliente: "Lembre, leve, que e bom momento de repor o giro antes de faltar na gondola.", rep: "A lista traz clientes DELE cujo giro esta chegando ao fim. Na lista cada cliente vem com o TICKET MEDIO dele (valor medio por pedido/reposicao, ex 'ticket medio R$ 44.000') e os dias sem comprar — explique que esse valor e o quanto ele COSTUMA colocar em cada pedido (a reposicao tipica), a referencia de quanto ele deveria repor agora, NAO e cobranca nem saldo." },
  recompra_giro_vencido: { valor: "[VALOR] e um tempo (ex '83 dias') sem comprar: o giro do cliente JA VENCEU (passou do ciclo de recompra). Escreva ex 'faz [VALOR] desde seu ultimo pedido — o giro ja venceu'. Deixe claro que e a HORA DE REPOR o estoque. NUNCA cobranca/saldo.", cliente: "Reative acolhedor: faz [VALOR] (giro vencido), convide a repor o giro antes de faltar na gondola. Deixe claro que e sobre repor a compra, NAO e cobranca.", rep: "A lista traz clientes DELE que passaram do giro (giro VENCIDO). IMPORTANTE: cada cliente na lista vem com o TICKET MEDIO dele (valor medio por pedido/reposicao, ex 'ticket medio R$ 44.000') e os dias sem comprar — explique ao rep que esse valor e o quanto o cliente COSTUMA colocar em CADA pedido (a reposicao tipica dele), a referencia de quanto ele deveria estar repondo agora, e NAO e cobranca nem saldo." },
  rep_sem_comprar: { valor: "[VALOR] e um tempo (ex '120 dias') sem pedido. Escreva ex 'faz [VALOR] sem um pedido'. NUNCA saldo/cobranca.", cliente: "Cliente parado: pergunte gentil se ha algo a melhorar e convide a retomar as compras.", rep: "A lista traz clientes DELE que estao sem pedido ha um tempo. Em vez de cobrar contato, PERGUNTE se ele sabe o que aconteceu com esses clientes e ofereca ajuda para retomar. Na lista cada cliente vem com o TICKET MEDIO historico (valor medio por pedido, ex 'ticket medio R$ 44.000') e os dias sem comprar — explique que esse valor e o quanto ele COSTUMAVA colocar em cada pedido, a referencia do que se perde parado, NAO e cobranca nem saldo." },
  recompra_cross_sell: { valor: "[VALOR] sao LINHAS de produto que o cliente ainda NAO compra mas que vendem bem no canal dele (ex 'Frasqueiras, Lixeiras'). Se aparecer '(lancamento)', e uma linha NOVA. Escreva ex 'que tal incluir as linhas [VALOR] no proximo pedido'. NUNCA saldo/tempo.", cliente: "Sugira incluir essas linhas para ampliar o sortimento e o ticket.", rep: "A lista traz clientes DELE e as linhas que fazem sentido oferecer a cada um. Apresente como sugestao de mix e ofereca material ou informacao para ele levar." },
  rep_sugestao_produto: { valor: "[VALOR] sao LINHAS sugeridas para o cliente experimentar (ex 'Potes, Cozinha'). Escreva ex 'sugiro incluir [VALOR] na proxima compra'.", cliente: "Sugira ao lojista experimentar essas linhas na proxima visita/pedido.", rep: "A lista traz sugestao de linhas por cliente para ele levar na visita, se fizer sentido. Ofereca ajuda com material ou argumento de venda." },
  recompra_novo_produto: { valor: "[VALOR] sao LINHAS recem-lancadas (novidades) que o cliente ainda NAO compra (ex 'Teca, Decor Util'). Apresente como LANCAMENTO/novidade: chance de sair na frente, diferenciar a loja e pegar giro novo. NUNCA trate como saldo/tempo.", cliente: "Apresente os lancamentos e convide a conhecer/experimentar. Tom de novidade e pioneirismo, sem pressao.", rep: "A lista traz clientes DELE que ainda nao compram os lancamentos. Apresente como novidade que ele pode levar primeiro, e ofereca material ou amostra para apoiar." },
  clube_a_vencer: { valor: "[VALOR] e um tempo ate a condicao do Clube VENCER (ex '30 dias'). Escreva ex 'sua condicao do Clube vence em [VALOR]'. Convide a usar antes de vencer.", cliente: "Avise que a condicao do Clube esta a vencer e convide a aproveitar antes do prazo.", rep: "A lista traz clientes DELE com a condicao do Clube perto de vencer. Avise do prazo e ofereca ajuda para ele aproveitar com esses clientes." },
  rep_roteiro_visitas: { valor: "[VALOR] e o motivo/prioridade da visita (ex 'Giro vencido').", cliente: "Convide para uma conversa/visita.", rep: "A lista traz clientes DELE que podem fazer sentido na rota, do mais relevante ao menos. Apresente como sugestao de roteiro pensada para facilitar o caminho, e ofereca levantar informacao de qualquer um deles antes da visita." },
};
function ctxDe(codigo: string) { return CTX[codigo] || CTX.recompra_giro_vencido; }

async function claude(sys: string, user: string, max = 700): Promise<any> {
  const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null;
  try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, max_tokens: max, temperature: 1, system: sys, messages: [{ role: "user", content: user }] }) }); if (!r.ok) return null; return parseJSON((await r.json())?.content?.[0]?.text || ""); } catch { return null; }
}
async function modeloRep(promptIa: string, ctx: any) {
  const fb = {
    whatsapp: "Oi [REP], tudo bem?\n\nSeparamos alguns clientes seus que podem fazer sentido para um contato agora:\n\n[LISTA]\n\nE uma sugestao, fique a vontade para ajustar. O que podemos fazer para te ajudar? Se quiser apoio em algum desses clientes, ou alguma informacao que a gente possa levantar antes, me fala.",
    email_assunto: "[REP], separamos alguns clientes para te ajudar",
    email_corpo: "Oi [REP], tudo bem?\n\nSeparamos alguns clientes seus que podem fazer sentido para um contato agora:\n\n[LISTA]\n\nE uma sugestao, fique a vontade para ajustar como preferir.\n\nO que podemos fazer para te ajudar? Se quiser apoio em algum desses clientes, ou alguma informacao que a gente possa levantar antes do contato, me fala que eu preparo."
  };
  const sys = `${BASE}\n\n${TOM_REP}\n\nTAREFA: escreva um MODELO AO REPRESENTANTE. OBRIGATORIO: inclua o token [LISTA] no WhatsApp E no e-mail - e onde entra a lista real dos clientes dele (nome, condicao, prazo); SEM [LISTA] a mensagem NAO serve. Use tambem [REP]. Fale COM o rep, como parceiro. CONTEXTO DA LISTA (explique isso a ele, sem virar ordem): ${ctx.rep} ANGULO DE APOIO: ${pick(ANG_REP)} Responda APENAS JSON {whatsapp, email_assunto, email_corpo}. pt-BR, direto - mas com o cumprimento no inicio e a oferta de ajuda no fim, sempre.`;
  const p0 = await claude(sys, (promptIa ? promptIa + "\n" : "") + "Use [REP] e SEMPRE [LISTA] no corpo.", 650);
  const p = (p0 && p0.whatsapp) ? { ...fb, ...p0 } : fb; return garantirLista(p);
}
async function modeloCliente(promptIa: string, ctx: any) {
  const fb = { whatsapp: "Ola [CLIENTE]! Aqui e da Nitron. Que tal montarmos um novo pedido? Estamos a disposicao.", email_assunto: "Nitron — vamos conversar?", email_corpo: "Ola [CLIENTE],\n\nQue tal montar um novo pedido com a gente?\n\nEstamos a disposicao." };
  const sys = `${BASE}\n\nTAREFA: escreva um MODELO AO CLIENTE (lojista). Use [CLIENTE] e [VALOR]${ctx === CTX.voucher_empurrar ? " e [VALIDADE]" : ""}. CRITICO sobre [VALOR]: ${ctx.valor} A mensagem precisa fazer sentido quando substituido. OBJETIVO: ${ctx.cliente} ANGULO: ${pick(ANG_CLI)} 1 argumento concreto + 1 CTA. Responda APENAS JSON {whatsapp, email_assunto, email_corpo}. Curto, pt-BR.`;
  const p = await claude(sys, (promptIa ? promptIa + "\n" : "") + "Escreva o modelo.", 550); return (p && p.whatsapp) ? { ...fb, ...p } : fb;
}
function valorCliente(codigo: string, c: any) {
  if (codigo === "clube_saldo") return `${brl(Number(c.saldo))}`;
  if (codigo === "voucher_empurrar") return `${Number(c.pct)}%`;
  if (codigo === "recompra_cross_sell" || codigo === "rep_sugestao_produto") return String(c.crosssell || "novas linhas");
  if (codigo === "recompra_novo_produto") return String(c.novidades || "nossos lancamentos");
  if (codigo === "clube_a_vencer") return (c.clube_vig_dias != null ? `${c.clube_vig_dias} dias` : "em breve");
  if (codigo === "rep_roteiro_visitas") return String(c.valtxt || c.situacao || "");
  return `${Number(c.dias)} dias`;
}
function motorBullet(codigo: string, c: any) {
  const nome = (c.razao || ("Cod " + c.codparc)) + lj(c.lojas);
  if (codigo === "clube_a_vencer") return `• ${nome} — Clube vence em ${c.clube_vig_dias}d`;
  if (codigo === "rep_roteiro_visitas") return `• ${nome} — ${c.situacao || ""}${Number(c.saldo_entregar) > 0 ? (" · saldo " + brl(Number(c.saldo_entregar))) : ""}${Number(c.dias) ? (" · " + c.dias + "d") : ""}`;
  if (codigo === "recompra_novo_produto") return `• ${nome} — apresentar lancamento: ${c.novidades || ""}`;
  return `• ${nome} — sugerir ${c.crosssell || ""}`;
}
async function motorFetch(sb: any, codigo: string) {
  let q = sb.from("ghl_cliente").select("codparc,razao,rep,situacao,ticket,dias,crosssell,novidades,saldo_entregar,clube_vig_dias,clube_saldo_pedir").eq("nitron", true);
  if (codigo === "recompra_cross_sell" || codigo === "rep_sugestao_produto") q = q.not("crosssell", "is", null).eq("situacao", "Em dia");
  else if (codigo === "recompra_novo_produto") q = q.not("novidades", "is", null).eq("situacao", "Em dia");
  else if (codigo === "clube_a_vencer") q = q.not("clube_vig_dias", "is", null);
  else q = q.not("rep", "is", null).neq("situacao", "Em dia");
  const { data } = await q.limit(50000); return data || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const codigo = body.codigo || "clube_saldo"; const modo = body.modo || "rascunho"; const publico = body.publico || "rep";
    const reps: number[] = Array.isArray(body.reps) ? body.reps.map((x: any) => Number(x)) : [];
    const clientesSel: any[] = Array.isArray(body.clientes) ? body.clientes : [];
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: camp } = await sb.from("campanhas").select("*").eq("codigo", codigo).maybeSingle();
    if (!camp) return j({ erro: `campanha '${codigo}' nao encontrada` }, 404);
    const isClube = codigo === "clube_saldo"; const isVoucher = codigo === "voucher_empurrar"; const isGiro = !!GIRO[codigo]; const isMotor = !!MOTOR[codigo];
    if (!isClube && !isVoucher && !isGiro && !isMotor) return j({ campanha: camp.nome, aviso: "gatilho ainda nao mapeado" });
    const promptIa = camp.prompt_ia || ""; const ctx = ctxDe(codigo);

    if (body.modelo) { const [mr, mc] = await Promise.all([modeloRep(promptIa, ctx), modeloCliente(promptIa, ctx)]); return j({ campanha: camp.nome, codigo, modeloRep: mr, modeloCliente: mc }); }
    const mr = garantirLista(body.modeloRep || await modeloRep(promptIa, ctx));
    const mc = body.modeloCliente || await modeloCliente(promptIa, ctx);
    const out: any[] = [];

    if (publico === "cliente") {
      const rows: any[] = [];
      for (const c of clientesSel) {
        const map = { CLIENTE: String(c.nome || ""), VALOR: valorCliente(codigo, c), VALIDADE: String(c.validade || "") };
        const wpp = fill(mc.whatsapp, map); const corpo = fill(mc.email_corpo, map); const assunto = fill(mc.email_assunto, map);
        out.push({ alvo: "cliente", codparc: c.codparc, nome: map.CLIENTE, whatsapp: wpp, email_assunto: assunto, email_corpo: corpo });
        rows.push({ campanha_id: camp.id, publico: "cliente", codparc: Number(c.codparc) || null, canal: "whatsapp", mensagem: wpp, email_assunto: assunto, email_corpo: corpo, status: modo === "enviar" ? "enviado" : "rascunho" });
      }
      if (rows.length) await sb.from("disparos").insert(rows);
      return j({ campanha: camp.nome, codigo, modo, publico, gerados: out.length, itens: out });
    }

    const inad = await inadSet(sb); const mtz = await matrizMap(sb);
    let repList: { codvend: number; rep: string }[] = [];
    let giroByRep: Record<string, any[]> = {}; let motorByRep: Record<string, any[]> = {};
    if (isMotor) {
      const rowsM = (await motorFetch(sb, codigo)).filter((c: any) => !inad.has(Number(c.codparc)));
      const { data: sreps } = await sb.from("snap_rep").select("codvend,rep"); const nameMap: Record<string, number> = {}; (sreps || []).forEach((s: any) => { if (s.rep) nameMap[String(s.rep).toUpperCase()] = Number(s.codvend); });
      const tmp: Record<string, Record<string, any[]>> = {};
      rowsM.forEach((c: any) => { const cv = nameMap[String(c.rep || "").toUpperCase()]; if (cv == null) return; const g = gk(mtz, c.codparc); (tmp[cv] = tmp[cv] || {}); (tmp[cv][g] = tmp[cv][g] || []).push(c); });
      Object.keys(tmp).forEach((cv) => { motorByRep[cv] = Object.keys(tmp[cv]).map((g) => { const ms = tmp[cv][g]; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms.slice().sort((a, b) => (Number(b.ticket) || 0) - (Number(a.ticket) || 0))[0]; return { ...sede, ticket: ms.reduce((a, b) => a + (Number(b.ticket) || 0), 0), lojas: ms.length }; }); });
      repList = Object.keys(motorByRep).map((k) => ({ codvend: Number(k), rep: String((motorByRep[k][0] || {}).rep || "") }));
    } else if (isGiro) {
      const { data: gr } = await sb.from("snap_giro").select("codvend,rep,codparc,nomeparc,dias,fat12m").in("bucket", GIRO[codigo]).eq("inadimp", false);
      const grF = (gr || []).filter((r: any) => !inad.has(Number(r.codparc)));
      const codpsG = Array.from(new Set(grF.map((r: any) => Number(r.codparc))));
      const teBy: Record<string, any> = {};
      for (let i = 0; i < codpsG.length; i += 300) { const ch = codpsG.slice(i, i + 300); const { data } = await sb.from("contato_enriquecido").select("codparc,num_compras,ticket_medio").in("codparc", ch); (data || []).forEach((x: any) => teBy[x.codparc] = { nc: Number(x.num_compras) || 0, tk: Number(x.ticket_medio) || 0 }); }
      const tmp: Record<string, Record<string, any[]>> = {};
      grF.forEach((r: any) => { if (r.codvend == null) return; const cv = String(r.codvend); const g = gk(mtz, r.codparc); (tmp[cv] = tmp[cv] || {}); (tmp[cv][g] = tmp[cv][g] || []).push(r); });
      Object.keys(tmp).forEach((cv) => { giroByRep[cv] = Object.keys(tmp[cv]).map((g) => { const ms = tmp[cv][g]; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms.slice().sort((a, b) => Number(b.fat12m) - Number(a.fat12m))[0]; const fat = ms.reduce((a, b) => a + (Number(b.fat12m) || 0), 0); const nc = ms.reduce((a, b) => a + ((teBy[b.codparc] || {}).nc || 0), 0); const ticket = nc > 0 ? Math.round(fat / nc) : ((teBy[sede.codparc] || {}).tk || 0); return { nomeparc: sede.nomeparc, rep: sede.rep, fat12m: fat, dias: Math.min(...ms.map((x) => Number(x.dias) || 9999)), lojas: ms.length, ticket }; }); });
      repList = Object.keys(giroByRep).map((k) => ({ codvend: Number(k), rep: String((giroByRep[k][0] || {}).rep || "") }));
    } else {
      const { data: rl } = await sb.from(isClube ? "clube_rep" : "voucher_rep").select("*");
      repList = (rl || []).map((r: any) => ({ codvend: Number(r.codvend), rep: String(r.rep) }));
    }
    if (reps.length) repList = repList.filter((r) => reps.includes(Number(r.codvend)));
    async function bulletsDe(codvend: number): Promise<{ bl: string[]; metric: number }> {
      if (isMotor) { const its = (motorByRep[String(codvend)] || []).sort((a: any, b: any) => (Number(b.ticket) || 0) - (Number(a.ticket) || 0)); return { bl: its.map((c: any) => motorBullet(codigo, c)), metric: its.reduce((a: number, b: any) => a + (Number(b.ticket) || 0), 0) }; }
      if (isClube) { const { data: gs } = await sb.from("clube_grupo").select("matriz,grupo,saldo").eq("codvend", codvend).order("saldo", { ascending: false }); return { bl: (gs || []).filter((g: any) => !inad.has(Number(g.matriz))).map((g: any) => `• ${g.grupo} — ${brl(Number(g.saldo))} de direito de compra`), metric: (gs || []).filter((g: any) => !inad.has(Number(g.matriz))).reduce((a: number, b: any) => a + Number(b.saldo), 0) }; }
      if (isVoucher) { const { data: cs } = await sb.from("voucher_cli").select("codparc,nome,pct,dtvalidade").eq("codvend", codvend); const cons = consVoucher((cs || []).filter((c: any) => !inad.has(Number(c.codparc))), mtz).sort((a: any, b: any) => String(a.dtvalidade).localeCompare(String(b.dtvalidade))); return { bl: cons.map((c: any) => `• ${c.nome}${lj(c.lojas)} — ${Number(c.pct)}% de desconto, vence ${fmtDate(c.dtvalidade)}`), metric: 0 }; }
      const its = (giroByRep[String(codvend)] || []).sort((a: any, b: any) => Number(b.dias) - Number(a.dias));
      return { bl: its.map((c: any) => `• ${c.nomeparc}${lj(c.lojas)} — ${Number(c.ticket) > 0 ? ("ticket medio " + brl(Number(c.ticket))) : ("media " + brl(Math.round(Number(c.fat12m) / 12)) + "/mes")} · ${c.dias}d sem comprar`), metric: its.reduce((a: number, b: any) => a + Number(b.fat12m), 0) };
    }
    const built = await Promise.all(repList.map(async (rr) => ({ rr, ...(await bulletsDe(rr.codvend)) })));
    const rows: any[] = [];
    for (const b of built) {
      if (!b.bl.length) continue;
      const bl = b.bl.join("\n"); const map = { REP: b.rr.rep, LISTA: bl };
      const wpp = fill(mr.whatsapp, map); const corpo = fill(mr.email_corpo, map); const assunto = fill(mr.email_assunto, map);
      out.push({ alvo: "rep", codvend: b.rr.codvend, rep: b.rr.rep, clientes: b.bl.length, saldo: b.metric, whatsapp: wpp, email_assunto: assunto, email_corpo: corpo });
      rows.push({ campanha_id: camp.id, publico: "rep", codvend: b.rr.codvend, canal: "whatsapp", mensagem: wpp, email_assunto: assunto, email_corpo: corpo, status: modo === "enviar" ? "enviado" : "rascunho" });
    }
    if (rows.length) await sb.from("disparos").insert(rows);
    return j({ campanha: camp.nome, codigo, modo, publico, gerados: out.length, itens: out });
  } catch (e) { return j({ erro: String(e) }, 500); }
});
