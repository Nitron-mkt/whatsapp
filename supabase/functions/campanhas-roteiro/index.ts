// campanhas-roteiro (v22) — OS CONTATOS DO REP VOLTAM NO MESMO FORMATO DAS OUTRAS CAMPANHAS.
// O painel tem um bloco de contatos so (telefones e e-mails agrupados por canal, rotulo da origem,
// excluir manual, "+ telefone / + email"), montado a partir de {telefones:[{valor,rotulo}], emails}.
// Esse formato so vinha do campanhas-preview, e por isso o roteiro tinha uma listinha pobre,
// diferente de todo o resto da tela. Agora devolve telefones/emails tambem — mesma fonte, mesmos
// rotulos. O campo `contatos` continua, para o envio em massa que ja o usava.
// campanhas-roteiro (v21) — CNPJ EM TODA MENCAO A CLIENTE. O representante acha o cliente pelo CNPJ
// no sistema dele, nao pelo nome fantasia: a razao social do Sankhya nem sempre e o nome da placa, e
// nome parecido entre lojas da mesma rede leva a visita errada. Em linha de rede consolidada o nome
// e o CNPJ sao SEMPRE da mesma loja, e o texto marca "(desta loja)" — senao o rep leria o CNPJ como
// se cobrisse o grupo todo e procuraria a loja errada.
// campanhas-roteiro (v20) — OS PARAMETROS DA ROTA VIERAM PARA O BANCO:
// campanhas.filtros_padrao de rep_roteiro_visitas manda em roteiro_max_km (raio do dia, agora 100 —
// era 150 e o gestor cortou), roteiro_min_dia (4), roteiro_vis_dia (6), roteiro_dias_semana (5) e
// roteiro_raio_semana_km (300). O raio ja mudou uma vez e o piso tambem: sao decisoes de operacao,
// nao de programa. As constantes abaixo ficam como padrao de quem nao tiver o campo preenchido.
// Impacto medido do corte 150->100km: pontos que fecham um dia de 4 caem de 1.236 para 1.127, e reps
// com pelo menos um dia viavel de 52 para 50. Barato, e o dia fica bem mais apertado de rodar.
// campanhas-roteiro (v19) — DIA SO EXISTE COM 4 VISITAS OU MAIS, e o dia se enche pelos clientes
// MAIS PROXIMOS, nao pelos mais valiosos. Pedido do gestor em 28/08: mandar o rep viajar para 1 ou 2
// visitas, ou para 6 visitas espalhadas em 150km, queima a viagem e a relacao com o cliente.
// A analise de proximidade feita antes de codar (1.672 pontos, 84 reps, raio de 150km na mesma UF):
//   1.242 (74%) tem 3+ vizinhos — fecham um dia de 4
//     217 tem so 1 ou 2 vizinhos — no maximo um dia de 2 ou 3
//     213 ISOLADOS, nenhum vizinho em 150km
// Consequencia assumida: 32 dos 84 reps nao tem NENHUM ponto que feche um dia de 4, e passam a nao
// receber rota. Isso e a resposta correta — para eles visita nao e o instrumento, contato e. A funcao
// devolve rota_possivel=false e mensagem vazia, para a tela avisar em vez de mandar roteiro vazio.
// campanhas-roteiro (v17) — A ROTA CABE NUMA SEMANA, NAO PULA DE ESTADO, COMECA NA MELHOR REGIAO
// e fala do ciclo DE CADA CLIENTE (v17: posic/gatilho/prioridade usavam 50 e 180 dias fixos e
// brigavam com o filtro por giro — a mensagem chegava a rotular "em dia (31d)" um cliente que
// entrou na rota justamente por ter fechado o ciclo de 30 dias dele).
// Tres problemas que o gestor apontou em 28/08, todos reais:
//   1) MAX_DIAS era 22: para os reps grandes saia "rota" de 20 dias, que ninguem executa. Agora
//      DIAS_SEMANA = 5 — uma semana util. O que nao cabe fica dito na mensagem, nao escondido.
//   2) A rota pulava de estado. Cada dia escolhia a ancora de MAIOR PRIORIDADE do que sobrou, no
//      Brasil inteiro: dia 1 em SP, dia 2 no RJ, dia 3 em SP de novo. Agora a semana toda mora numa
//      REGIAO SO (mesma UF e dentro de RAIO_SEMANA_KM da ancora), e cada dia comeca de onde o dia
//      anterior terminou — a sequencia e continua, nao um sorteio de prioridade.
//   3) Quem nao precisa comprar saia na rota. Movido para a view roteiro_cliente_apto: fora quem tem
//      PEDIDO EM ABERTO, quem esta DENTRO DO PROPRIO CICLO de recompra (dias < ce.giro, e nao um
//      numero fixo) e quem esta BLOQUEADO no Sankhya (parc_bloqueado / TGFPAR.BLOQUEAR).
// v16: a ancora deixa de ser o maior cliente e passa a ser o centro da melhor semana (ver comentario
//      no montar()). Com o maior cliente, quem tem carteira espalhada recebia semana de 9 visitas.
// E a mensagem passou a ser CONSULTIVA: muitos desses clientes o rep ja esta atendendo, entao o
// texto se apresenta como apoio nosso e sugestao dele, nunca como roteiro a cumprir.
// campanhas-roteiro (v14) — chave de servico via srvKey() (SRV_JWT, JWT legado) por causa
// da chave sb_secret_ que o Data API recusa desde 23/08.
// v14: a instancia vem da view rep_instancia (proprietario no CRM), nao de snap_rep.assistente.
// (v12) — le de roteiro_cliente_apto: fora quem tem pendencia financeira
// (inadimplente ou titulo vencido) e quem esta com giro em dia. Mensagem em tom de apoio.
// (v9) — DISTANCIA REAL (haversine via cep_geo) com teto MAX_KM/dia; fallback regiao de CEP p/ sem coord. Agrupa por matriz. Ordem NN. Msg detalhada+numerada+espacada (com km). Exclui inad+intra.
// v9: modo ?lote=<csv de codvend> monta o roteiro de vários reps numa chamada (geo/intra carregados uma vez), p/ o envio em massa do painel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const brl = (v: any) => "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR");
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const cep8 = (c: any) => digits(c).slice(0, 8);
/* CNPJ chega do Sankhya como 14 digitos crus. Formatado para o rep poder ler e copiar direto no
   sistema dele. Alguns cadastros sao CPF (7 casos): 11 digitos, mascara e rotulo diferentes — chamar
   CPF de CNPJ na mensagem seria um erro visivel para quem recebe. */
function fmtDoc(d: any) {
  const x = String(d || "").replace(/\D/g, "");
  if (x.length === 14) return "CNPJ " + x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (x.length === 11) return "CPF " + x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return x ? ("doc " + x) : "";
}
function fmtCep(c: any) { const d = digits(c); return d.length === 8 ? d.slice(0, 5) + "-" + d.slice(5) : (c || ""); }
function haversine(a: any, b: any) { const R = 6371, tr = (x: number) => x * Math.PI / 180; const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng); const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
const cep3 = (cepn: number) => Math.floor((cepn || 0) / 100000);
function dist(a: any, b: any) { if (a.lat != null && b.lat != null) return haversine(a, b); return Math.abs(cep3(a.cepn) - cep3(b.cepn)) <= CEP3_JANELA ? 70 : 9999; }
async function intraSet(sb: any): Promise<Set<number>> { const { data } = await sb.from("parc_intragrupo").select("codparc"); return new Set((data || []).map((r: any) => Number(r.codparc))); }
async function loadGeo(sb: any): Promise<Map<string, any>> { const m = new Map(); let f = 0; while (true) { const { data } = await sb.from("cep_geo").select("cep,lat,lng").not("lat", "is", null).range(f, f + 999); (data || []).forEach((r: any) => m.set(String(r.cep), { lat: r.lat, lng: r.lng })); if (!data || data.length < 1000) break; f += 1000; } return m; }
/* O CICLO E DO CLIENTE, NAO UMA CONSTANTE.
   Estas tres funcoes usavam 50 e 180 dias fixos, e isso brigava com o filtro da view (que usa o giro
   de cada um, de 30 a 90 dias aqui). O sintoma aparecia na mensagem: cliente com giro de 30 dias e
   31 sem comprar entrava na rota — corretamente, fechou o ciclo — e o texto o rotulava "em dia
   (31d)", dentro de uma mensagem que abre dizendo que a lista e de quem esta com o ciclo vencido.
   Rep leria isso como desleixo, e com razao. Agora a referencia e sempre o giro do proprio cliente. */
const giroDe = (n: any) => { const g = Number(n.giro) || 0; return g > 0 ? g : 45; };
const atrasoDe = (n: any) => (Number(n.dias) || 0) / giroDe(n);   // 1 = fechou o ciclo agora; 2 = o dobro
function gatilho(n: any) { const clube = Number(n.clube_saldo) > 0; const vencido = atrasoDe(n) >= 1; return { giro: vencido, clube, any: vencido || clube }; }
/* Ordena por "quanto vale x quao atrasado esta no ritmo DELE". O 1,6 fixo antigo tratava igual quem
   passou 1 dia e quem passou um ano do ciclo. O fator de atraso vai de 1 a 2 e satura ai: dobrar o
   ciclo ja e sinal suficiente, e sem o teto um cliente de 3 anos parado dominava a carteira toda. */
function prioridade(n: any) {
  const atraso = 1 + Math.min(1, Math.max(0, atrasoDe(n) - 1));
  const clube = Number(n.clube_saldo) > 0 ? 1.2 : 1;
  return (Number(n.fat12m) || 0) * atraso * clube;
}
function posic(n: any) {
  const d = Number(n.dias) || 0, g = giroDe(n), a = atrasoDe(n);
  if (a >= 2) return d + "d sem comprar — mais que o dobro do ciclo dele (~" + g + "d)";
  if (a >= 1) return d + "d sem comprar — ciclo dele fechou (compra a cada ~" + g + "d)";
  return d + "d sem comprar (ciclo ~" + g + "d)";
}
function porque(n: any) { const p: string[] = [posic(n)]; if (Number(n.clube_saldo) > 0) p.push("Clube " + brl(n.clube_saldo) + " disponivel"); p.push(brl(n.fat12m) + "/ano na carteira"); if (n.lojas > 1) p.push("rede " + n.lojas + " lojas"); return p.join(" · "); }
function gkeyOf(c: any) { const m = Number(c.codparcmatriz) || 0; return (m > 0 && m !== Number(c.codparc)) ? m : Number(c.codparc); }
function agrupar(rows: any[]) {
  const by: Record<string, any[]> = {}; rows.forEach((c) => { const k = String(gkeyOf(c)); (by[k] = by[k] || []).push(c); });
  const nodes: any[] = [];
  for (const k in by) { const membros = by[k]; let sede = membros.find((m) => Number(m.codparc) === Number(k)); if (!sede) sede = membros.slice().sort((a, b) => Number(b.fat12m) - Number(a.fat12m))[0]; const fat = membros.reduce((a, b) => a + (Number(b.fat12m) || 0), 0); const clube = membros.reduce((a, b) => a + (Number(b.clube_saldo) || 0), 0); const dias = Math.min(...membros.map((m) => Number(m.dias) || 9999)); const giro = Math.min(...membros.map((m) => Number(m.giro) || 9999)); nodes.push({ codparc: sede.codparc, gkey: Number(k), nome: sede.nome, cnpj: sede.cnpj, cep: sede.cep, cidade: sede.cidade, uf: sede.uf, codvend: sede.codvend, rep: sede.rep, fat12m: fat, dias, giro: (giro === 9999 ? null : giro), clube_saldo: clube, lojas: membros.length }); }
  return nodes;
}
function pushCanal(out: any[], seen: any, canal: string, valor: any, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao: "Rep", origem }); }
// ordena um grupo por vizinho-mais-proximo (NN) a partir do 1o
function rota(grupo: any[]) { if (grupo.length <= 2) return grupo; const out = [grupo[0]]; const rest = grupo.slice(1); while (rest.length) { const last = out[out.length - 1]; let bi = 0, bd = Infinity; rest.forEach((n: any, i: number) => { const d = dist(last, n); if (d < bd) { bd = d; bi = i; } }); out.push(rest.splice(bi, 1)[0]); } return out; }
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const nf = (v: any) => digits(v).replace(/^0+/, "").replace(/^55/, "");
/* CONTATOS DO REP NO MESMO FORMATO DAS OUTRAS CAMPANHAS.
   O painel tem um bloco de contatos so — telefones e e-mails agrupados por canal, com o rotulo da
   origem (Sankhya, CRM, CRM-casado, manual), botao de excluir o manual e "+ telefone / + email".
   Ele monta esse bloco a partir de {telefones:[{valor,rotulo}], emails:[...]}, que era o formato que
   so o campanhas-preview devolvia — por isso o roteiro tinha uma listinha pobre e diferente de todo
   o resto. Estas tres funcoes sao as mesmas do campanhas-preview, de proposito: mesma fonte, mesmos
   rotulos, mesmo comportamento na tela. */
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
async function extrasMap(sb: any): Promise<Record<string, any[]>> {
  const { data } = await sb.from("rep_contato_extra").select("*").eq("ativo", true);
  const by: Record<string, any[]> = {}; (data || []).forEach((e: any) => { (by[e.codvend] = by[e.codvend] || []).push(e); });
  return by;
}
// A semana inteira fica dentro deste raio da ancora, e na mesma UF. E o que impede segunda em SP,
// terca no RJ e quarta em SP de novo.
const RAIO_SEMANA_KM = 300;
/* PADROES. O que vale em producao vem de campanhas.filtros_padrao (ver cfgRota); isto aqui e a rede
   para o caso de a linha da campanha nao ter os campos.
     DIAS_SEMANA  uma semana util. Antes eram 22 dias: virava rota de quase um mes, que ninguem faz.
     VIS_DIA      teto de visitas no dia.
     MIN_VIS_DIA  piso: dia com menos que isso nao vira dia. O rep nao pega a estrada por 2 clientes.
     MAX_KM       raio do dia — o que conta como "perto". Era 150; o gestor cortou para 100. */
const VIS_DIA = 6; const MIN_VIS_DIA = 4; const DIAS_SEMANA = 5; const CEP3_JANELA = 20; const MAX_KM = 100; const LOTE_MAX = 15;
type CfgRota = { maxKm: number; minDia: number; visDia: number; diasSemana: number; raioSemana: number };
const num = (v: any, padrao: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : padrao; };
async function cfgRota(sb: any): Promise<CfgRota> {
  const { data } = await sb.from("campanhas").select("filtros_padrao").eq("codigo", "rep_roteiro_visitas").maybeSingle();
  const f = (data?.filtros_padrao || {}) as any;
  return {
    maxKm: num(f.roteiro_max_km, MAX_KM),
    minDia: num(f.roteiro_min_dia, MIN_VIS_DIA),
    visDia: num(f.roteiro_vis_dia, VIS_DIA),
    diasSemana: num(f.roteiro_dias_semana, DIAS_SEMANA),
    raioSemana: num(f.roteiro_raio_semana_km, RAIO_SEMANA_KM),
  };
}
/* roteiro_cliente.uf e o CODUF NUMERICO do Sankhya (TSIUFS), nao a sigla — sem este mapa a mensagem
   ao representante diria "concentradas em 2" em vez de "em MG". Estatico de proposito: e tabela de
   dominio do ERP, muda a cada década. */
const UF_SIGLA: Record<string, string> = { "1": "SP", "2": "MG", "3": "DF", "4": "GO", "5": "MT", "6": "BA", "7": "RJ", "8": "PR", "9": "PA", "10": "PE", "11": "RO", "12": "MS", "13": "SC", "14": "TO", "15": "RS", "16": "ES", "17": "PB", "18": "AM", "19": "AL", "20": "AC", "21": "CE", "22": "SE", "23": "PI", "24": "RR", "26": "RN", "28": "AP", "31": "MA" };
const sig = (u: any) => UF_SIGLA[String(u)] || "";

// monta o roteiro de 1 rep. Sem I/O: geo e snap_rep vem de fora, pro modo lote carregar uma vez so.
// `ri` e a linha da view rep_instancia: a instancia que VALE e a do proprietario do contato no CRM,
// porque o WhatsApp sai pelo numero do usuario remetente. snap_rep.assistente e so o organograma do
// Sankhya casado por nome — era ele que fazia a mensagem chegar pela assistente errada.
function montar(rep: number, rows: any[], sr: any, geo: Map<string, any>, ri: any, cfg: CfgRota) {
  const nodes = agrupar(rows).filter((n: any) => digits(n.cep).length >= 7).map((n: any) => { const g = geo.get(cep8(n.cep)); return { ...n, cepn: parseInt(cep8(n.cep)) || 0, lat: g ? g.lat : null, lng: g ? g.lng : null, prio: prioridade(n) }; });
  const nome = rows[0]?.rep || ("Rep " + rep);
  const visitados = new Set<number>(); const dias: any[] = [];

  /* A SEMANA MORA NUMA REGIAO SO.
     Antes cada dia pegava a ancora de maior prioridade entre as sobras, sem olhar onde ficava — e o
     resultado era uma rota que ia e voltava de estado. Agora a regiao e escolhida UMA vez, a semana
     nao sai dela (mesma UF, dentro de RAIO_SEMANA_KM) e cada dia comeca do ponto onde o anterior
     terminou. O que fica fora da regiao nao se perde: vai contado em `fora_da_regiao`, e a mensagem
     diz ao rep que entra numa proxima sugestao.

     A ancora e o centro da MELHOR SEMANA, nao o maior cliente da carteira.
     Escolher pelo maior faturamento parecia obvio e dava rota ruim: a DENIZE tem 181 contas aptas
     espalhadas por 19 UFs (44 no PA, 26 em MG...), e o cliente de maior faturamento dela fica em
     MG — a semana saia com 9 visitas e 172 contas de fora. Um planejador humano nao pergunta "onde
     esta meu maior cliente?", pergunta "onde consigo a melhor semana?". Entao cada candidato e
     avaliado como CENTRO: soma a prioridade do que ele alcanca (mesma UF, dentro do raio), limitada
     a CAP_SEMANA porque mais que isso nao cabe na semana de todo jeito. Ganha o melhor centro. */
  const CAP_SEMANA = cfg.diasSemana * cfg.visDia;
  const alcance = (c: any) => nodes.filter((n: any) => n.uf === c.uf && dist(c, n) <= cfg.raioSemana);
  let ancoraSemana: any = null, melhorNota = -1, melhorAlcance: any[] = [];
  for (const c of nodes) {
    const ac = alcance(c);
    const nota = ac.slice().sort((a: any, b: any) => b.prio - a.prio).slice(0, CAP_SEMANA)
                   .reduce((t: number, n: any) => t + (n.prio || 0), 0);
    if (nota > melhorNota) { melhorNota = nota; ancoraSemana = c; melhorAlcance = ac; }
  }
  let naRegiao = ancoraSemana ? melhorAlcance : [];
  /* 99% dos CEPs tem coordenada, mas dist() devolve 9999 quando falta — sem esta rede um rep com CEP
     nao geocodificado receberia uma "semana" de uma visita. Ai vale a UF sozinha, que e o corte que
     de fato impede pular de estado. */
  if (ancoraSemana && naRegiao.length < 2) naRegiao = nodes.filter((n: any) => n.uf === ancoraSemana.uf);
  const foraDaRegiao = nodes.length - naRegiao.length;

  /* O DIA E UM CLUSTER, NAO UMA SEQUENCIA.
     A versao anterior comecava o dia pelo ponto mais proximo de onde o dia anterior terminou e
     preenchia com quem estivesse a MAX_KM DELE. Em regiao rala isso dava dia de 1, 2 ou 3 visitas —
     o rep pegava a estrada para quase nada. Agora cada candidato e avaliado como SEMENTE de um dia:
     conta quantos vizinhos ele reune dentro de MAX_KM, e so vale se fechar MIN_VIS_DIA. Entre os que
     fecham, ganha o de maior soma de prioridade, com um desconto pelo deslocamento desde o fim do dia
     anterior — densidade manda, continuidade desempata. Quem nao entra em nenhum cluster fica em
     `sem_cluster` e a mensagem diz que esses ficam para contato, nao para visita. */
  let de = ancoraSemana;   // de onde o proximo dia parte
  while (dias.length < cfg.diasSemana) {
    const rest = naRegiao.filter((n: any) => !visitados.has(n.gkey));
    if (rest.length < cfg.minDia) break;   // nem sobra gente para um dia inteiro
    let semente: any = null, notaTop = -1, clusterTop: any[] = [];
    for (const seed of rest) {
      /* O dia se enche pelos MAIS PROXIMOS, nao pelos mais valiosos.
         Preencher por prioridade dentro do raio de 150km dava dias tecnicamente cheios e horriveis
         de rodar: 6 visitas espalhadas em 150km porque as mais valiosas estavam longe uma da outra.
         A prioridade decide PARA ONDE ir (a semente e a regiao); depois de chegar la, o rep visita
         quem esta ao lado. Ordenar por distancia torna o raio do dia minimo por construcao. */
      const vizinhos = rest.filter((n: any) => n.gkey !== seed.gkey && dist(seed, n) <= cfg.maxKm)
                           .sort((a: any, b: any) => dist(seed, a) - dist(seed, b));
      const cluster = [seed, ...vizinhos.slice(0, cfg.visDia - 1)];
      if (cluster.length < cfg.minDia) continue;   // este ponto nao fecha um dia: nao serve de semente
      const soma = cluster.reduce((t: number, n: any) => t + (n.prio || 0), 0);
      const raio = Math.max(...cluster.map((n: any) => dist(seed, n)).filter((d: number) => d < 9000), 0);
      const desloc = de ? Math.min(dist(de, seed), 500) : 0;   // 9999 (sem coord) nao pode dominar
      /* valor por esforco: quanto a semente reune, descontado o quao esparramado ficou o dia e o
         quanto se anda desde o fim do dia anterior. Assim um dia de 4 clientes colados ganha de um
         de 6 espalhados por 150km — que e o que o gestor pediu ao falar de "nao perder a viagem". */
      const nota = soma / (1 + raio / 60) / (1 + desloc / 200);
      if (nota > notaTop) { notaTop = nota; semente = seed; clusterTop = cluster; }
    }
    if (!semente) break;   // ninguem mais reune o minimo: a semana termina aqui, de proposito
    const grupo = rota(clusterTop);   // ordem por vizinho mais proximo, partindo da semente
    grupo.forEach((n: any) => visitados.add(n.gkey));
    const maisRelevante = grupo.slice().sort((a: any, b: any) => b.prio - a.prio)[0];
    const kmsDia = grupo.map((n: any) => (n.lat != null && semente.lat != null) ? Math.round(dist(semente, n)) : null);
    dias.push({
      dia: dias.length + 1,
      ancora: maisRelevante.codparc, ancora_nome: maisRelevante.nome, ancora_porque: porque(maisRelevante),
      cidade_base: semente.cidade, uf: semente.uf,
      raio_km: Math.max(...kmsDia.map((k: any) => k == null ? 0 : k)),
      clientes: grupo.map((n: any, k: number) => ({
        ordem: k + 1, codparc: n.codparc, nome: n.nome, cnpj: n.cnpj || null, doc: fmtDoc(n.cnpj), cidade: n.cidade, cep: fmtCep(n.cep), uf: n.uf,
        km: (n.lat != null && semente.lat != null) ? Math.round(dist(semente, n)) : null,
        fat: Math.round(n.fat12m), fat_fmt: brl(n.fat12m), dias: n.dias, giro: n.giro,
        clube_saldo: Number(n.clube_saldo) || 0, lojas: n.lojas,
        posicionamento: posic(n), motivo: porque(n), ancora: n.gkey === maisRelevante.gkey,
      })),
    });
    de = grupo[grupo.length - 1];   // o dia seguinte parte daqui
  }
  // sobrou na regiao quem nao reune 4 por perto: nao e rota, e contato
  const semCluster = naRegiao.filter((n: any) => !visitados.has(n.gkey)).length;

  const contatos: any[] = []; const seen: any = {};
  if (sr) { pushCanal(contatos, seen, "whatsapp", sr.celular, "Sankhya"); pushCanal(contatos, seen, "whatsapp", sr.fone_parc, "Sankhya"); pushCanal(contatos, seen, "email", sr.email, "Sankhya"); pushCanal(contatos, seen, "email", sr.email_crm, "CRM"); }
  /* TOM: muitos desses clientes o rep JA esta atendendo, e ele conhece a praca melhor que a gente.
     O texto se apresenta como apoio, diz de saida que e sugestao e que ele pode ignorar, e nunca
     cobra visita, prazo ou resultado. Sem isso a mensagem soa como roteiro imposto por quem nao
     esta na rua. */
  const uf1 = dias.length ? sig(dias[0].uf) : "";

  /* SEM ROTA VIAVEL NAO SE MANDA ROTEIRO. 32 dos 84 reps nao tem nenhum ponto que reuna 4 clientes
     dentro de 150km: a carteira apta existe, mas espalhada. Mandar um "roteiro" de 1 ou 2 visitas
     seria pedir uma viagem que nao se paga. Mensagem vazia + aviso: a tela mostra o motivo e nao
     enfileira nada. */
  if (!dias.length) {
    return {
      rep: nome, codvend: rep, instancia: ri?.instancia || null, instancia_erp: ri?.instancia_erp || null,
      divergente: !!ri?.divergente, contatos, total: nodes.length, cobertos: 0,
      fora_da_regiao: foraDaRegiao, sem_cluster: semCluster, uf_semana: null,
      rota_possivel: false, dias: [],
      aviso: nodes.length
        ? ("sem rota viavel: os " + nodes.length + " cliente(s) aptos deste representante estao espalhados e nenhum reune "
           + cfg.minDia + " outros num raio de " + cfg.maxKm + "km. Visita nao se paga aqui — vale contato por Zaptos ou e-mail.")
        : "nenhum cliente apto agora (todos com pedido em aberto, dentro do ciclo, inadimplentes ou bloqueados).",
      mensagem: "",
    };
  }

  let msg = "Oi " + nome + ", tudo bem?\n\n"
    + "Levantamos aqui uma sugestao de sequencia de visitas para a proxima semana. Olhamos quem esta "
    + "com o ciclo de compra vencido e montamos os dias por PROXIMIDADE — um dia so entrou na lista se "
    + "juntasse ao menos " + cfg.minDia + " clientes perto um do outro, para a viagem valer a pena.\n\n"
    + "Antes de tudo: e so uma sugestao, montada de fora. Voce conhece a praca e o momento de cada "
    + "cliente muito melhor que a gente — se alguns desses voce ja esta atendendo, ou se a ordem nao "
    + "faz sentido para a sua semana, ignore sem problema. A ideia e te poupar trabalho de "
    + "planejamento, nao te dar rota.\n\n"
    + "Sao " + visitados.size + " contas em " + dias.length + " dia(s)"
    + (uf1 ? (", concentradas em " + uf1) : "") + ".\n";
  dias.forEach((d: any) => {
    msg += "\n\u2501\u2501\u2501 DIA " + d.dia + " \u00b7 " + (d.cidade_base || "") + " e regiao ("
      + d.clientes.length + " visitas" + (d.raio_km ? (", num raio de ~" + d.raio_km + "km") : "") + ") \u2501\u2501\u2501\n";
    d.clientes.forEach((c: any) => {
      /* CNPJ em linha propria: e por ele que o rep busca no sistema, e enfiado no meio da linha de
         endereco ele se perde. Em rede, o CNPJ e o da loja nomeada — dito explicitamente, porque a
         linha resume varias lojas do grupo. */
      msg += "\n" + c.ordem + ") " + (c.ancora ? "\u2b50 " : "") + c.nome + "\n"
        + (c.doc ? ("   " + (c.lojas > 1 ? (c.doc + " (desta loja)") : c.doc) + "\n") : "")
        + "   " + (c.cidade || "") + (sig(c.uf) ? ("/" + sig(c.uf)) : "") + " \u00b7 CEP " + c.cep
        + (c.km != null ? (" \u00b7 ~" + c.km + "km do primeiro") : "") + "\n   " + c.motivo + "\n";
    });
  });
  const sobra = foraDaRegiao + semCluster;
  if (sobra > 0) {
    msg += "\nTem outras " + sobra + " conta(s) suas que ficaram fora desta semana";
    if (foraDaRegiao > 0 && semCluster > 0) msg += " — parte em outra regiao, parte distante das demais";
    else if (foraDaRegiao > 0) msg += ", em outra regiao";
    else msg += ", distantes demais das outras para caber num dia de visitas";
    msg += ". Nao esquecemos delas: em vez de te fazer atravessar o estado por uma visita, vale um "
      + "contato. Se quiser, preparo essa lista separada para voce falar por Zaptos ou e-mail.\n";
  }
  msg += "\nO que podemos fazer para te ajudar? Se quiser que a gente levante algo antes de alguma "
    + "visita — historico de compra, mix que ele nao leva, condicao comercial, saldo do Clube — me "
    + "fala que eu preparo. E se preferir a sugestao de outra forma (outra regiao, mais ou menos "
    + "visitas por dia), e so dizer.";
  return { rep: nome, codvend: rep, instancia: ri?.instancia || null, instancia_erp: ri?.instancia_erp || null, divergente: !!ri?.divergente, contatos, total: nodes.length, cobertos: visitados.size, fora_da_regiao: foraDaRegiao, sem_cluster: semCluster, rota_possivel: true, uf_semana: dias.length ? (sig(dias[0].uf) || null) : null, dias, mensagem: msg };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams; const repParam = p.get("rep"); const loteParam = p.get("lote");
    const intra = await intraSet(sb);
    const cfg = await cfgRota(sb);

    // LOTE: roteiro de varios reps numa chamada (p/ enfileirar em massa). Devolve mensagem+contatos, sem o detalhe dos dias.
    if (loteParam) {
      const cvs = Array.from(new Set(loteParam.split(",").map((x) => parseInt(x)).filter((x) => !isNaN(x)))).slice(0, LOTE_MAX);
      if (!cvs.length) return j({ erro: "lote vazio" }, 400);
      const geo = await loadGeo(sb);
      const cli: any[] = []; { let f = 0; while (true) { const { data } = await sb.from("roteiro_cliente_apto").select("*").in("codvend", cvs).range(f, f + 999); (data || []).forEach((r: any) => cli.push(r)); if (!data || data.length < 1000) break; f += 1000; } }
      const { data: srs } = await sb.from("snap_rep").select("*").in("codvend", cvs);
      const srBy: Record<string, any> = {}; (srs || []).forEach((s: any) => srBy[String(s.codvend)] = s);
      const { data: ris } = await sb.from("rep_instancia").select("codvend,instancia,instancia_erp,divergente").in("codvend", cvs);
      const riBy: Record<string, any> = {}; (ris || []).forEach((x: any) => riBy[String(x.codvend)] = x);
      const byRep: Record<string, any[]> = {};
      cli.forEach((c: any) => { if (intra.has(Number(c.codparc))) return; const k = String(c.codvend); (byRep[k] = byRep[k] || []).push(c); });
      const exL = await extrasMap(sb); const bvL = await repBasesMap(sb);
      const lote = cvs.map((cv) => { const r: any = montar(cv, byRep[String(cv)] || [], srBy[String(cv)], geo, riBy[String(cv)], cfg); const rcL = repContatos(srBy[String(cv)], (exL[String(cv)] || []).concat(bvL[String(cv)] || [])); return { codvend: r.codvend, rep: r.rep, telefones: rcL.telefones, emails: rcL.emails, instancia: r.instancia, instancia_erp: r.instancia_erp, divergente: r.divergente, contatos: r.contatos, total: r.total, cobertos: r.cobertos, fora_da_regiao: r.fora_da_regiao, sem_cluster: r.sem_cluster, rota_possivel: r.rota_possivel !== false, aviso: r.aviso, uf_semana: r.uf_semana, dias_n: r.dias.length, mensagem: r.mensagem }; });
      return j({ lote, cfg });
    }

    if (!repParam) {
      const byRep: Record<string, any[]> = {}; let from = 0;
      while (true) { const { data } = await sb.from("roteiro_cliente_apto").select("codparc,codparcmatriz,codvend,rep,fat12m,dias,giro,clube_saldo,cnpj").range(from, from + 999); (data || []).forEach((c: any) => { if (c.codvend == null || intra.has(Number(c.codparc))) return; (byRep[c.codvend] = byRep[c.codvend] || []).push(c); }); if (!data || data.length < 1000) break; from += 1000; }
      const reps = Object.keys(byRep).map((cv) => { const nodes = agrupar(byRep[cv]); const rep = (byRep[cv][0] || {}).rep; return { codvend: Number(cv), rep, clientes: nodes.length, prioritarios: nodes.filter((n) => gatilho(n).any).length, fat: Math.round(nodes.reduce((a, b) => a + (Number(b.fat12m) || 0), 0)) }; }).sort((a, b) => b.prioritarios - a.prioritarios || b.fat - a.fat);
      return j({ reps, cfg });
    }

    const rep = parseInt(repParam);
    const geo = await loadGeo(sb);
    const todas: any[] = []; { let f = 0; while (true) { const { data } = await sb.from("roteiro_cliente_apto").select("*").eq("codvend", rep).range(f, f + 999); (data || []).forEach((r: any) => todas.push(r)); if (!data || data.length < 1000) break; f += 1000; } }
    const rows = todas.filter((c: any) => !intra.has(Number(c.codparc)));
    const { data: sr } = await sb.from("snap_rep").select("*").eq("codvend", rep).maybeSingle();
    const { data: ri } = await sb.from("rep_instancia").select("codvend,instancia,instancia_erp,divergente").eq("codvend", rep).maybeSingle();
    const ex = await extrasMap(sb); const bv = await repBasesMap(sb);
    const rc = repContatos(sr, (ex[String(rep)] || []).concat(bv[String(rep)] || []));
    return j({ ...montar(rep, rows, sr, geo, ri, cfg), telefones: rc.telefones, emails: rc.emails, cfg });
  } catch (e) { return j({ erro: String(e) }, 500); }
});
