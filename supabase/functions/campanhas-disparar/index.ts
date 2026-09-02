// campanhas-disparar (v51) — "Sugestao de produtos p/ a visita" e "Lancamentos" pararam de dizer a
// MESMA COISA. O crosssell mistura curva A nao comprada com lancamentos marcados, e para 528 dos 529
// clientes da audiencia a parte de curva A estava vazia (o cliente ja compra tudo da curva A do
// canal dele): as duas campanhas saiam com os mesmos lancamentos. Agora cada uma le seu campo:
//   rep_sugestao_produto  -> ghl_cliente.curva_a   (curva A do canal que ele nao compra, SEM lanc.)
//   recompra_novo_produto -> ghl_cliente.novidades (lancamento, e cada linha marcada "(Lançamento)")
//   recompra_cross_sell   -> ghl_cliente.crosssell (a mistura, campanha de ticket)
// O texto da campanha de lancamentos passou a pedir o formato da mensagem que o gestor aprovou em
// 01/09 (levantamento para a visita, beneficio do lojista, decisao dele, oferta concreta de apoio) e
// proibe explicitamente o angulo de concorrencia — a IA escreveu "chegar antes da concorrencia", que
// o TOM_REP ja vetava.
// campanhas-disparar (v50) — CNPJ EM TODA LISTA DE CLIENTE QUE VAI AO REPRESENTANTE. Pedido do
// gestor em 28/08: com nome fantasia ou razao social o rep nao acha o cliente no sistema dele; pelo
// CNPJ acha. Vale para as quatro fontes de lista (Clube, voucher, giro e motor), em linha propria,
// porque no meio da linha do motivo o numero se perde.
// Duas regras que as listas consolidadas por rede impuseram:
//   1) NOME E CNPJ SAO SEMPRE DA MESMA LOJA. As listas agrupam por matriz, mas a matriz nem sempre
//      esta na lista (5 dos 13 grupos do giro vencido): antes disso a linha sairia com o nome de uma
//      filial e o CNPJ da matriz. Quando a linha resume mais de uma loja, o texto marca
//      "(desta loja)" — senao o rep leria o CNPJ como se cobrisse o grupo inteiro.
//   2) O Clube fala de CONTRATO, e ai o CNPJ e o da matriz mesmo — mas so 18 dos 68 grupos tem mais
//      de uma loja. Nos outros 50 dizer "matriz do contrato" mandaria o rep procurar uma rede que
//      nao existe, entao o sufixo so aparece quando ha rede de fato.
// campanhas-disparar (v49) — a janela do Clube a vencer saiu do codigo e foi para o banco:
// campanhas.filtros_padrao->>'clube_venc_dias' (hoje 60). Ela mudou duas vezes em um dia; deixar o
// numero em constante obrigava a redeployar duas funcoes para ajustar uma regra comercial, com o
// risco de as duas ficarem com valores diferentes. Agora as duas leem a MESMA linha do banco e um
// UPDATE resolve. A constante abaixo e so o padrao de quem nao tiver o campo preenchido.
// campanhas-disparar (v48) — CLUBE A VENCER: (a) a audiencia agora tem teto de 45 dias. A vigencia
// do Clube dura um ano, e o filtro era so "tem vigencia": entravam 148 clientes, dos quais 141 com
// 46 a 362 dias pela frente — e a mensagem ao rep os apresentava como "perto de vencer" (havia
// bullet de 240d). (b) TODO prompt de IA agora comeca declarando A CAMPANHA, o assunto dela e o que
// e proibido nela: a IA recebia so a regra do [VALOR] e nunca o nome da campanha, entao escrevia
// texto plausivel e errado (chegou a escrever "seu desconto do Clube" e a citar valor em dinheiro,
// quando o assunto do Clube a vencer e so o prazo que resta). (c) ctxDe() nao inventa mais contexto:
// campanha sem CTX proprio agora BARRA o disparo, em vez de escrever com o texto de "giro vencido".
// campanhas-disparar (v47) — chave de servico via srvKey(). Desde 23/08 a plataforma injeta
// em SUPABASE_SERVICE_ROLE_KEY uma chave sb_secret_ que o Data API recusa (PGRST303
// "JWT issued at future"); SRV_JWT guarda o JWT legado, que segue valido.
// (v46) — trava umaListaSo(): se a IA escrever [LISTA] duas vezes, a lista
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
// chave de servico: SRV_JWT (JWT legado) e, se nao existir, a injetada pela plataforma
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const fmtDate = (s: any) => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}` : (s ? String(s) : ""); };
const lj = (n: any) => (Number(n) > 1 ? ` (${n} lojas)` : "");
/* CNPJ chega do Sankhya como 14 digitos crus. Formatado para o rep ler e copiar direto no sistema
   dele. Alguns cadastros sao CPF (11 digitos): mascara e rotulo diferentes — chamar CPF de CNPJ na
   mensagem seria um erro visivel para quem recebe. */
function fmtDoc(d: any) {
  const x = String(d || "").replace(/\D/g, "");
  if (x.length === 14) return "CNPJ " + x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (x.length === 11) return "CPF " + x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return x ? ("doc " + x) : "";
}
/* O documento por codparc, de contato_enriquecido (99,9% de cobertura). Em lote de 300 porque a lista
   do motor chega a 9 mil codparc e o `in` do PostgREST tem limite de URL. */
async function docMap(sb: any, codps: any[]): Promise<Record<string, string>> {
  const by: Record<string, string> = {};
  const u = Array.from(new Set(codps.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
  for (let i = 0; i < u.length; i += 300) {
    const { data } = await sb.from("contato_enriquecido").select("codparc,cnpj").in("codparc", u.slice(i, i + 300));
    (data || []).forEach((r: any) => { const d = fmtDoc(r.cnpj); if (d) by[String(r.codparc)] = d; });
  }
  return by;
}
/* A linha do cliente na lista do rep. Duas linhas de proposito: o CNPJ sozinho na segunda e o que o
   rep copia, e enfiado no meio da primeira ele se perde entre nome e motivo. */
function linhaCli(nome: string, doc: string, sufixo: string, motivo: string) {
  return "• " + nome + (doc ? ("\n  " + doc + (sufixo || "")) : "") + "\n  " + motivo;
}
/* Linha consolidada de rede: o nome mostrado e o de UMA loja e o CNPJ e o dela — o rep precisa
   saber disso, senao acha que o CNPJ cobre o grupo todo e procura a loja errada. Quantas lojas a
   linha resume ja vem no nome, por lj(). */
const sufDoc = (lojas: any) => (Number(lojas) > 1 ? " (desta loja)" : "");
/* "(Lançamento)" escrito em CADA linha, pedido do gestor: quando a campanha e de lancamento, tem de
   estar dito — senao a linha parece uma sugestao de mix qualquer, e foi assim que a campanha de
   lancamentos e a de sugestao viraram a mesma mensagem aos olhos de quem recebe. */
const tagLanc = (v: any) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => x + " (Lançamento)").join(", ");
const GIRO: Record<string, string[]> = { recompra_giro_a_vencer: ["A_VENCER"], recompra_giro_vencido: ["VENCIDO"], rep_sem_comprar: ["VENCIDO", "REATIVACAO"] };
const MOTOR: Record<string, number> = { recompra_cross_sell: 1, rep_sugestao_produto: 1, rep_roteiro_visitas: 1, clube_a_vencer: 1, recompra_novo_produto: 1 };
// Janela de aviso do Clube a vencer. Sem teto, "a condicao esta perto de vencer" saia para quem
// tem quase um ano de vigencia pela frente. O valor vem de campanhas.filtros_padrao (mesma linha
// que o campanhas-preview le, para os dois nunca discordarem); isto aqui e so o padrao.
const CLUBE_VENC_PADRAO = 60;
function clubeVencDias(camp: any): number {
  const v = Number((camp?.filtros_padrao || {}).clube_venc_dias);
  return Number.isFinite(v) && v > 0 ? v : CLUBE_VENC_PADRAO;
}
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
function consVoucher(rows: any[], mtz: Map<number, number>) { const by: Record<string, any[]> = {}; rows.forEach((c) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); }); return Object.keys(by).map((g) => { const ms = by[g].slice().sort((a, b) => String(a.dtvalidade).localeCompare(String(b.dtvalidade))); const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms[0]; return { codparc: Number(sede.codparc), nome: String(sede.nome), pct: Number(ms[0].pct), dtvalidade: ms[0].dtvalidade, lojas: ms.length }; }); }

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
  clube_saldo: { assunto: "o DIREITO DE COMPRA em dinheiro que o cliente tem para usar no trimestre do Clube Nitron", proibido: "chamar isso de saldo parado, de desconto, de credito, de bonus ou de divida; falar de prazo em dias", valor: "[VALOR] e um valor em dinheiro (ex: 'R$ 12.500') = DIREITO DE COMPRA do trimestre no Clube Nitron. Escreva ex: 'voce tem [VALOR] de direito de compra no Clube Nitron'. NUNCA saldo parado.", cliente: "Convide a aproveitar a condicao do Clube e repor o trimestre.", rep: "A lista traz clientes DELE com direito de compra do trimestre disponivel no Clube. Explique o que e e ofereca ajuda para ele aproveitar isso junto desses clientes." },
  voucher_empurrar: { assunto: "um DESCONTO em percentual, ja liberado, com DATA LIMITE para usar", proibido: "citar valor em dinheiro (R$), saldo, faturamento ou dias sem comprar", valor: "[VALOR] e um percentual (ex '6%') de desconto no voucher e [VALIDADE] e a DATA LIMITE. Escreva ex 'voce tem [VALOR] de desconto no voucher, valido ate [VALIDADE]'. De DIRECIONAMENTO: e a hora de fazer o pedido do mes / repor o sortimento que mais gira aproveitando o desconto, fechando ANTES do prazo.", cliente: "Avise do [VALOR] de desconto valido ate [VALIDADE] e de DIRECIONAMENTO CONCRETO: convide a MONTAR O PEDIDO AGORA para repor o sortimento/estoque que gira aproveitando a condicao, completando o mix, com urgencia gentil (o prazo esta chegando). Um argumento concreto + 1 CTA clara. NAO seja generico.", rep: "A lista logo abaixo traz os clientes DELE com voucher a vencer (nome + % + validade). Diga que a lista vem abaixo e explique que e um desconto ja liberado, com data limite real. Ofereca ajuda para ele falar com esses clientes antes do prazo - sem cobrar visita nem impor prazo a ele." },
  recompra_giro_a_vencer: { assunto: "o TEMPO desde a ultima compra: o ciclo de recompra (giro) esta chegando ao fim", proibido: "citar valor em dinheiro ao cliente, falar de desconto, de divida ou de cobranca", valor: "[VALOR] e um tempo (ex '45 dias') sem comprar; o ciclo de recompra (giro) esta chegando ao fim. Escreva ex 'ja faz [VALOR] desde a ultima compra'. NUNCA saldo/cobranca.", cliente: "Lembre, leve, que e bom momento de repor o giro antes de faltar na gondola.", rep: "A lista traz clientes DELE cujo giro esta chegando ao fim. Na lista cada cliente vem com o TICKET MEDIO dele (valor medio por pedido/reposicao, ex 'ticket medio R$ 44.000') e os dias sem comprar — explique que esse valor e o quanto ele COSTUMA colocar em cada pedido (a reposicao tipica), a referencia de quanto ele deveria repor agora, NAO e cobranca nem saldo." },
  recompra_giro_vencido: { assunto: "o TEMPO desde a ultima compra: o ciclo de recompra (giro) JA VENCEU", proibido: "citar valor em dinheiro ao cliente, falar de desconto, de divida ou de cobranca", valor: "[VALOR] e um tempo (ex '83 dias') sem comprar: o giro do cliente JA VENCEU (passou do ciclo de recompra). Escreva ex 'faz [VALOR] desde seu ultimo pedido — o giro ja venceu'. Deixe claro que e a HORA DE REPOR o estoque. NUNCA cobranca/saldo.", cliente: "Reative acolhedor: faz [VALOR] (giro vencido), convide a repor o giro antes de faltar na gondola. Deixe claro que e sobre repor a compra, NAO e cobranca.", rep: "A lista traz clientes DELE que passaram do giro (giro VENCIDO). IMPORTANTE: cada cliente na lista vem com o TICKET MEDIO dele (valor medio por pedido/reposicao, ex 'ticket medio R$ 44.000') e os dias sem comprar — explique ao rep que esse valor e o quanto o cliente COSTUMA colocar em CADA pedido (a reposicao tipica dele), a referencia de quanto ele deveria estar repondo agora, e NAO e cobranca nem saldo." },
  rep_sem_comprar: { assunto: "o TEMPO que o cliente esta sem nenhum pedido", proibido: "falar de divida, cobranca, desconto ou valor devido", valor: "[VALOR] e um tempo (ex '120 dias') sem pedido. Escreva ex 'faz [VALOR] sem um pedido'. NUNCA saldo/cobranca.", cliente: "Cliente parado: pergunte gentil se ha algo a melhorar e convide a retomar as compras.", rep: "A lista traz clientes DELE que estao sem pedido ha um tempo. Em vez de cobrar contato, PERGUNTE se ele sabe o que aconteceu com esses clientes e ofereca ajuda para retomar. Na lista cada cliente vem com o TICKET MEDIO historico (valor medio por pedido, ex 'ticket medio R$ 44.000') e os dias sem comprar — explique que esse valor e o quanto ele COSTUMAVA colocar em cada pedido, a referencia do que se perde parado, NAO e cobranca nem saldo." },
  recompra_cross_sell: { assunto: "LINHAS de produto que o cliente ainda NAO compra e que vendem bem no canal dele", proibido: "citar valor em dinheiro, desconto, prazo ou dias sem comprar", valor: "[VALOR] sao LINHAS de produto que o cliente ainda NAO compra mas que vendem bem no canal dele (ex 'Frasqueiras, Lixeiras'). Se aparecer '(lancamento)', e uma linha NOVA. Escreva ex 'que tal incluir as linhas [VALOR] no proximo pedido'. NUNCA saldo/tempo.", cliente: "Sugira incluir essas linhas para ampliar o sortimento e o ticket.", rep: "A lista traz clientes DELE e as linhas que fazem sentido oferecer a cada um. Apresente como sugestao de mix e ofereca material ou informacao para ele levar." },
  rep_sugestao_produto: { assunto: "as LINHAS DA CURVA A DO CANAL do cliente que ele ainda NAO compra — o que mais fatura no canal dele e nao esta no sortimento dele. NAO sao lancamentos: sao linhas consolidadas, com giro provado no canal", proibido: "chamar essas linhas de lancamento, novidade, estreia ou algo recem-chegado (elas NAO sao); citar valor em dinheiro, desconto, prazo ou dias sem comprar; falar de concorrente", valor: "[VALOR] sao LINHAS da curva A do canal do cliente que ele ainda nao compra (ex 'Potes, Cozinha'). Sao linhas que ja vendem bem em lojas como a dele. Escreva ex 'sugiro incluir [VALOR] na proxima compra'.", cliente: "Sugira incluir essas linhas, explicando que sao das que mais giram em lojas do mesmo perfil que a dele.", rep: "A lista traz, por cliente, as linhas da CURVA A DO CANAL daquele cliente que ele ainda nao compra — ou seja, o que mais fatura em lojas do mesmo canal e esta faltando no sortimento dele. Explique isso ao rep: nao e chute nem novidade, e o buraco de sortimento medido contra o que o canal dele compra. Ofereca ajuda com material de ponto de venda ou argumento de venda." },
  recompra_novo_produto: { assunto: "LINHAS RECEM-LANCADAS que o cliente ainda NAO compra. Cada linha da lista vem marcada '(Lançamento)' — o marcador e proposital e a mensagem deve tratar o assunto como lancamento, nao como sugestao de mix qualquer", proibido: "citar valor em dinheiro, desconto, prazo ou dias sem comprar; falar de CONCORRENTE em qualquer forma — nem 'chegar antes da concorrencia', nem 'sair na frente', nem 'antes que outro leve'", valor: "[VALOR] sao LINHAS recem-lancadas que o cliente ainda NAO compra, ja com o marcador (ex 'Teca (Lançamento), Decor Util (Lançamento)'). Apresente como lancamento: linha nova, giro novo na gondola. NUNCA trate como saldo/tempo.", cliente: "Apresente os lancamentos e convide a conhecer/experimentar. Tom de novidade, sem pressao e sem falar de concorrente.", rep: "A lista traz clientes DELE que ainda nao compram os lancamentos, cada linha marcada '(Lançamento)'. ESCREVA NESTE FORMATO, que e o que o gestor aprovou: (1) diga que fizemos um levantamento rapido de lancamentos que podem fazer sentido ele apresentar na proxima visita; (2) traga o beneficio pelo lado do lojista — giro novo na gondola e ticket, sem complicar; (3) deixe explicito que nada e obrigatorio e que ele decide o que faz sentido levar, porque ele conhece o momento de cada cliente; (4) diga de onde saiu a sugestao: sao linhas novas que aquele cliente ainda nao tem no sortimento; (5) ofereca coisas CONCRETAS — material de ponto de venda, amostra, um argumento de venda mais forte para algum cliente especifico, ou levantar informacao antes do contato; (6) feche com uma pergunta aberta do tipo 'o que podemos fazer para te facilitar?'." },
  clube_a_vencer: { assunto: "o TEMPO QUE FALTA para a vigencia do Clube Nitron do cliente TERMINAR. E um prazo em dias, e so isso. O Clube Nitron e um DIREITO DE COMPRA com vigencia: o que esta acabando e o PRAZO para usar, nao um valor", proibido: "citar QUALQUER valor em dinheiro (R$), saldo, faturamento, ticket ou percentual; chamar o Clube de desconto, de credito, de saldo, de bonus ou de premio; inventar qualquer numero que nao seja o prazo que veio em [VALOR]", valor: "[VALOR] e um tempo ate a condicao do Clube VENCER (ex '30 dias'). Escreva ex 'sua condicao do Clube vence em [VALOR]'. Convide a usar antes de vencer.", cliente: "Avise que a condicao do Clube esta a vencer e convide a aproveitar antes do prazo.", rep: "A lista traz clientes DELE com a condicao do Clube perto de vencer. Avise do prazo e ofereca ajuda para ele aproveitar com esses clientes." },
  rep_roteiro_visitas: { assunto: "a PRIORIDADE de visita de cada cliente da carteira", proibido: "prometer prazo, citar desconto ou valor de cobranca", valor: "[VALOR] e o motivo/prioridade da visita (ex 'Giro vencido').", cliente: "Convide para uma conversa/visita.", rep: "A lista traz clientes DELE que podem fazer sentido na rota, do mais relevante ao menos. Apresente como sugestao de roteiro pensada para facilitar o caminho, e ofereca levantar informacao de qualquer um deles antes da visita." },
};
/* Antes caia em CTX.recompra_giro_vencido: uma campanha nova, sem contexto cadastrado, saia com o
   texto de "giro vencido" — plausivel, bem escrito e falando de outra coisa. Silencio assim nao se
   descobre lendo a mensagem. Agora nao ha disparo sem contexto proprio. */
function ctxDe(codigo: string) { return CTX[codigo] || null; }

/* A IA nunca sabia DE QUE CAMPANHA se tratava: recebia a regra do [VALOR] e o objetivo, nunca o
   nome nem o assunto. Dava texto plausivel e errado. Todo prompt agora comeca por aqui. */
function cabeca(codigo: string, nomeCamp: string, ctx: any) {
  return `CAMPANHA: "${nomeCamp || codigo}" (codigo interno ${codigo}).\n`
    + `ASSUNTO DESTA CAMPANHA — a mensagem tem de ser sobre isto, e sobre nada mais: ${ctx.assunto}\n`
    + `PROIBIDO NESTA CAMPANHA: ${ctx.proibido}.\n`
    + `Se algum dado nao estiver no prompt, NAO invente: escreva a mensagem sem ele.`;
}

async function claude(sys: string, user: string, max = 700): Promise<any> {
  const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null;
  try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, max_tokens: max, temperature: 1, system: sys, messages: [{ role: "user", content: user }] }) }); if (!r.ok) return null; return parseJSON((await r.json())?.content?.[0]?.text || ""); } catch { return null; }
}
async function modeloRep(promptIa: string, ctx: any, cab: string) {
  const fb = {
    whatsapp: "Oi [REP], tudo bem?\n\nSeparamos alguns clientes seus que podem fazer sentido para um contato agora:\n\n[LISTA]\n\nE uma sugestao, fique a vontade para ajustar. O que podemos fazer para te ajudar? Se quiser apoio em algum desses clientes, ou alguma informacao que a gente possa levantar antes, me fala.",
    email_assunto: "[REP], separamos alguns clientes para te ajudar",
    email_corpo: "Oi [REP], tudo bem?\n\nSeparamos alguns clientes seus que podem fazer sentido para um contato agora:\n\n[LISTA]\n\nE uma sugestao, fique a vontade para ajustar como preferir.\n\nO que podemos fazer para te ajudar? Se quiser apoio em algum desses clientes, ou alguma informacao que a gente possa levantar antes do contato, me fala que eu preparo."
  };
  const sys = `${BASE}\n\n${cab}\n\n${TOM_REP}\n\nTAREFA: escreva um MODELO AO REPRESENTANTE. OBRIGATORIO: inclua o token [LISTA] no WhatsApp E no e-mail - e onde entra a lista real dos clientes dele (nome, condicao, prazo); SEM [LISTA] a mensagem NAO serve. Use tambem [REP]. Fale COM o rep, como parceiro. CONTEXTO DA LISTA (explique isso a ele, sem virar ordem): ${ctx.rep} ANGULO DE APOIO: ${pick(ANG_REP)} Responda APENAS JSON {whatsapp, email_assunto, email_corpo}. pt-BR, direto - mas com o cumprimento no inicio e a oferta de ajuda no fim, sempre.`;
  const p0 = await claude(sys, (promptIa ? promptIa + "\n" : "") + "Use [REP] e SEMPRE [LISTA] no corpo.", 650);
  const p = (p0 && p0.whatsapp) ? { ...fb, ...p0 } : fb; return garantirLista(p);
}
async function modeloCliente(promptIa: string, ctx: any, cab: string) {
  const fb = { whatsapp: "Ola [CLIENTE]! Aqui e da Nitron. Que tal montarmos um novo pedido? Estamos a disposicao.", email_assunto: "Nitron — vamos conversar?", email_corpo: "Ola [CLIENTE],\n\nQue tal montar um novo pedido com a gente?\n\nEstamos a disposicao." };
  const sys = `${BASE}\n\n${cab}\n\nTAREFA: escreva um MODELO AO CLIENTE (lojista). Use [CLIENTE] e [VALOR]${ctx === CTX.voucher_empurrar ? " e [VALIDADE]" : ""}. CRITICO sobre [VALOR]: ${ctx.valor} A mensagem precisa fazer sentido quando substituido. OBJETIVO: ${ctx.cliente} ANGULO: ${pick(ANG_CLI)} 1 argumento concreto + 1 CTA. Responda APENAS JSON {whatsapp, email_assunto, email_corpo}. Curto, pt-BR.`;
  const p = await claude(sys, (promptIa ? promptIa + "\n" : "") + "Escreva o modelo.", 550); return (p && p.whatsapp) ? { ...fb, ...p } : fb;
}
/* Dias que faltam para a vigencia do Clube acabar. O painel manda clube_vig_dias quando tem, mas o
   caminho de rascunho manda so o texto pronto ("Clube vence em 39d") — e nesse caso o [VALOR] virava
   "em breve" e a mensagem perdia justamente o numero de que ela trata. */
function vigDias(c: any): number | null {
  for (const v of [c.clube_vig_dias, c.vig_dias]) if (v != null && v !== "") return Number(v);
  const m = String(c.valtxt || "").match(/(\d+)\s*d/);
  return m ? Number(m[1]) : null;
}
function valorCliente(codigo: string, c: any) {
  if (codigo === "clube_saldo") return `${brl(Number(c.saldo))}`;
  if (codigo === "voucher_empurrar") return `${Number(c.pct)}%`;
  if (codigo === "recompra_cross_sell") return String(c.crosssell || "novas linhas");
  if (codigo === "rep_sugestao_produto") return String(c.curva_a || "novas linhas");
  if (codigo === "recompra_novo_produto") return c.novidades ? tagLanc(c.novidades) : "nossos lancamentos";
  if (codigo === "clube_a_vencer") { const d = vigDias(c); return d != null ? `${d} dias` : "poucos dias"; }
  if (codigo === "rep_roteiro_visitas") return String(c.valtxt || c.situacao || "");
  return `${Number(c.dias)} dias`;
}
function motorBullet(codigo: string, c: any, doc = "") {
  const nome = (c.razao || ("Cod " + c.codparc)) + lj(c.lojas);
  let motivo: string;
  if (codigo === "clube_a_vencer") { const d = vigDias(c); motivo = `Clube vence em ${d != null ? d + "d" : "breve"}`; }
  else if (codigo === "rep_roteiro_visitas") motivo = `${c.situacao || ""}${Number(c.saldo_entregar) > 0 ? (" · saldo " + brl(Number(c.saldo_entregar))) : ""}${Number(c.dias) ? (" · " + c.dias + "d") : ""}`;
  else if (codigo === "recompra_novo_produto") motivo = `apresentar ${tagLanc(c.novidades)}`;
  else if (codigo === "rep_sugestao_produto") motivo = `sugerir ${c.curva_a || ""}`;
  else motivo = `sugerir ${c.crosssell || ""}`;
  return linhaCli(nome, doc, sufDoc(c.lojas), motivo);
}
async function motorFetch(sb: any, codigo: string, vencDias: number) {
  let q = sb.from("ghl_cliente").select("codparc,razao,rep,situacao,ticket,dias,curva_a,crosssell,novidades,saldo_entregar,clube_vig_dias,clube_saldo_pedir").eq("nitron", true);
  /* Cada uma na sua fonte. crosssell = curva A + lancamentos misturados (campanha de ticket);
     curva_a = so a curva A do canal que o cliente nao compra (sugestao para a visita); novidades =
     so lancamento. Enquanto a sugestao lia crosssell, ela saia com os mesmos lancamentos da campanha
     de lancamentos: 528 dos 529 clientes da audiencia nao tinham NENHUMA curva A em falta. */
  if (codigo === "recompra_cross_sell") q = q.not("crosssell", "is", null).eq("situacao", "Em dia");
  else if (codigo === "rep_sugestao_produto") q = q.not("curva_a", "is", null).eq("situacao", "Em dia");
  else if (codigo === "recompra_novo_produto") q = q.not("novidades", "is", null).eq("situacao", "Em dia");
  else if (codigo === "clube_a_vencer") q = q.not("clube_vig_dias", "is", null).gte("clube_vig_dias", 0).lte("clube_vig_dias", vencDias);
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
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const { data: camp } = await sb.from("campanhas").select("*").eq("codigo", codigo).maybeSingle();
    if (!camp) return j({ erro: `campanha '${codigo}' nao encontrada` }, 404);
    const isClube = codigo === "clube_saldo"; const isVoucher = codigo === "voucher_empurrar"; const isGiro = !!GIRO[codigo]; const isMotor = !!MOTOR[codigo];
    if (!isClube && !isVoucher && !isGiro && !isMotor) return j({ campanha: camp.nome, aviso: "gatilho ainda nao mapeado" });
    const promptIa = camp.prompt_ia || ""; const ctx = ctxDe(codigo);
    if (!ctx) return j({ erro: `campanha '${codigo}' sem contexto de IA cadastrado (CTX). Sem ele a IA escreveria o texto de outra campanha.` }, 500);
    const cab = cabeca(codigo, camp.nome, ctx);

    if (body.modelo) { const [mr, mc] = await Promise.all([modeloRep(promptIa, ctx, cab), modeloCliente(promptIa, ctx, cab)]); return j({ campanha: camp.nome, codigo, modeloRep: mr, modeloCliente: mc }); }
    const mr = garantirLista(body.modeloRep || await modeloRep(promptIa, ctx, cab));
    const mc = body.modeloCliente || await modeloCliente(promptIa, ctx, cab);
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
    /* Quantas lojas tem cada rede. parc_matriz guarda so as FILIAIS (a matriz nao aponta para si
       mesma), entao o total e 1 + filiais. Serve para o Clube: 50 dos 68 grupos sao LOJA UNICA, e
       dizer "matriz do contrato" neles faria o rep procurar uma rede que nao existe. */
    const filiais = new Map<number, number>();
    mtz.forEach((m: number) => filiais.set(Number(m), (filiais.get(Number(m)) || 0) + 1));
    let repList: { codvend: number; rep: string }[] = [];
    let giroByRep: Record<string, any[]> = {}; let motorByRep: Record<string, any[]> = {};
    if (isMotor) {
      const rowsM = (await motorFetch(sb, codigo, clubeVencDias(camp))).filter((c: any) => !inad.has(Number(c.codparc)));
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
      /* O codparc que fica na linha e o da SEDE DA LISTA, nao o da matriz do grupo: em 5 dos 13
         grupos consolidados do giro vencido a matriz nao esta na lista e o nome exibido e de uma
         filial — buscar o CNPJ pela matriz daria nome de uma loja com o documento de outra. */
      Object.keys(tmp).forEach((cv) => { giroByRep[cv] = Object.keys(tmp[cv]).map((g) => { const ms = tmp[cv][g]; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms.slice().sort((a, b) => Number(b.fat12m) - Number(a.fat12m))[0]; const fat = ms.reduce((a, b) => a + (Number(b.fat12m) || 0), 0); const nc = ms.reduce((a, b) => a + ((teBy[b.codparc] || {}).nc || 0), 0); const ticket = nc > 0 ? Math.round(fat / nc) : ((teBy[sede.codparc] || {}).tk || 0); return { codparc: Number(sede.codparc), nomeparc: sede.nomeparc, rep: sede.rep, fat12m: fat, dias: Math.min(...ms.map((x) => Number(x.dias) || 9999)), lojas: ms.length, ticket }; }); });
      repList = Object.keys(giroByRep).map((k) => ({ codvend: Number(k), rep: String((giroByRep[k][0] || {}).rep || "") }));
    } else {
      const { data: rl } = await sb.from(isClube ? "clube_rep" : "voucher_rep").select("*");
      repList = (rl || []).map((r: any) => ({ codvend: Number(r.codvend), rep: String(r.rep) }));
    }
    if (reps.length) repList = repList.filter((r) => reps.includes(Number(r.codvend)));
    /* O CNPJ de todo cliente que pode aparecer em alguma lista, carregado UMA vez.
       Buscar por rep dentro do bulletsDe faria uma ida ao banco por representante — com 84 reps a
       funcao estouraria o tempo de execucao. */
    const codpsDoc: number[] = [];
    Object.keys(motorByRep).forEach((k) => motorByRep[k].forEach((c: any) => codpsDoc.push(Number(c.codparc))));
    Object.keys(giroByRep).forEach((k) => giroByRep[k].forEach((c: any) => codpsDoc.push(Number(c.codparc))));
    if (isClube) { const { data } = await sb.from("clube_grupo").select("matriz"); (data || []).forEach((g: any) => codpsDoc.push(Number(g.matriz))); }
    if (isVoucher) { const { data } = await sb.from("voucher_cli").select("codparc"); (data || []).forEach((c: any) => codpsDoc.push(Number(c.codparc))); }
    const DOC = await docMap(sb, codpsDoc);
    const doc = (cp: any) => DOC[String(cp)] || "";

    async function bulletsDe(codvend: number): Promise<{ bl: string[]; metric: number }> {
      if (isMotor) { const its = (motorByRep[String(codvend)] || []).sort((a: any, b: any) => (Number(b.ticket) || 0) - (Number(a.ticket) || 0)); return { bl: its.map((c: any) => motorBullet(codigo, c, doc(c.codparc))), metric: its.reduce((a: number, b: any) => a + (Number(b.ticket) || 0), 0) }; }
      if (isClube) { const { data: gs } = await sb.from("clube_grupo").select("matriz,grupo,saldo").eq("codvend", codvend).order("saldo", { ascending: false }); const ok = (gs || []).filter((g: any) => !inad.has(Number(g.matriz))); return { bl: ok.map((g: any) => { const nl = 1 + (filiais.get(Number(g.matriz)) || 0); return linhaCli(String(g.grupo) + lj(nl), doc(g.matriz), nl > 1 ? " (matriz do contrato)" : "", `${brl(Number(g.saldo))} de direito de compra`); }), metric: ok.reduce((a: number, b: any) => a + Number(b.saldo), 0) }; }
      if (isVoucher) { const { data: cs } = await sb.from("voucher_cli").select("codparc,nome,pct,dtvalidade").eq("codvend", codvend); const cons = consVoucher((cs || []).filter((c: any) => !inad.has(Number(c.codparc))), mtz).sort((a: any, b: any) => String(a.dtvalidade).localeCompare(String(b.dtvalidade))); return { bl: cons.map((c: any) => linhaCli(String(c.nome) + lj(c.lojas), doc(c.codparc), sufDoc(c.lojas), `${Number(c.pct)}% de desconto, vence ${fmtDate(c.dtvalidade)}`)), metric: 0 }; }
      const its = (giroByRep[String(codvend)] || []).sort((a: any, b: any) => Number(b.dias) - Number(a.dias));
      return { bl: its.map((c: any) => linhaCli(String(c.nomeparc) + lj(c.lojas), doc(c.codparc), sufDoc(c.lojas), `${Number(c.ticket) > 0 ? ("ticket medio " + brl(Number(c.ticket))) : ("media " + brl(Math.round(Number(c.fat12m) / 12)) + "/mes")} · ${c.dias}d sem comprar`)), metric: its.reduce((a: number, b: any) => a + Number(b.fat12m), 0) };
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
