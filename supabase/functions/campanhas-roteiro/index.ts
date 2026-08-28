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
  for (const k in by) { const membros = by[k]; let sede = membros.find((m) => Number(m.codparc) === Number(k)); if (!sede) sede = membros.slice().sort((a, b) => Number(b.fat12m) - Number(a.fat12m))[0]; const fat = membros.reduce((a, b) => a + (Number(b.fat12m) || 0), 0); const clube = membros.reduce((a, b) => a + (Number(b.clube_saldo) || 0), 0); const dias = Math.min(...membros.map((m) => Number(m.dias) || 9999)); const giro = Math.min(...membros.map((m) => Number(m.giro) || 9999)); nodes.push({ codparc: sede.codparc, gkey: Number(k), nome: sede.nome, cep: sede.cep, cidade: sede.cidade, uf: sede.uf, codvend: sede.codvend, rep: sede.rep, fat12m: fat, dias, giro: (giro === 9999 ? null : giro), clube_saldo: clube, lojas: membros.length }); }
  return nodes;
}
function pushCanal(out: any[], seen: any, canal: string, valor: any, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao: "Rep", origem }); }
// ordena um grupo por vizinho-mais-proximo (NN) a partir do 1o
function rota(grupo: any[]) { if (grupo.length <= 2) return grupo; const out = [grupo[0]]; const rest = grupo.slice(1); while (rest.length) { const last = out[out.length - 1]; let bi = 0, bd = Infinity; rest.forEach((n: any, i: number) => { const d = dist(last, n); if (d < bd) { bd = d; bi = i; } }); out.push(rest.splice(bi, 1)[0]); } return out; }
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Uma semana util. Antes 22 dias: virava "rota" de quase um mes, que ninguem executa.
const VIS_DIA = 6; const DIAS_SEMANA = 5; const CEP3_JANELA = 20; const MAX_KM = 150; const LOTE_MAX = 15;
// A semana inteira fica dentro deste raio da ancora, e na mesma UF. E o que impede segunda em SP,
// terca no RJ e quarta em SP de novo.
const RAIO_SEMANA_KM = 300;
/* roteiro_cliente.uf e o CODUF NUMERICO do Sankhya (TSIUFS), nao a sigla — sem este mapa a mensagem
   ao representante diria "concentradas em 2" em vez de "em MG". Estatico de proposito: e tabela de
   dominio do ERP, muda a cada década. */
const UF_SIGLA: Record<string, string> = { "1": "SP", "2": "MG", "3": "DF", "4": "GO", "5": "MT", "6": "BA", "7": "RJ", "8": "PR", "9": "PA", "10": "PE", "11": "RO", "12": "MS", "13": "SC", "14": "TO", "15": "RS", "16": "ES", "17": "PB", "18": "AM", "19": "AL", "20": "AC", "21": "CE", "22": "SE", "23": "PI", "24": "RR", "26": "RN", "28": "AP", "31": "MA" };
const sig = (u: any) => UF_SIGLA[String(u)] || "";

// monta o roteiro de 1 rep. Sem I/O: geo e snap_rep vem de fora, pro modo lote carregar uma vez so.
// `ri` e a linha da view rep_instancia: a instancia que VALE e a do proprietario do contato no CRM,
// porque o WhatsApp sai pelo numero do usuario remetente. snap_rep.assistente e so o organograma do
// Sankhya casado por nome — era ele que fazia a mensagem chegar pela assistente errada.
function montar(rep: number, rows: any[], sr: any, geo: Map<string, any>, ri?: any) {
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
  const CAP_SEMANA = DIAS_SEMANA * VIS_DIA;
  const alcance = (c: any) => nodes.filter((n: any) => n.uf === c.uf && dist(c, n) <= RAIO_SEMANA_KM);
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

  let de = ancoraSemana;   // de onde o proximo dia parte
  while (dias.length < DIAS_SEMANA && de) {
    const rest = naRegiao.filter((n: any) => !visitados.has(n.gkey));
    if (!rest.length) break;
    // o dia comeca pelo mais proximo do ponto onde paramos; nao pela prioridade solta no mapa
    const perto = rest.slice().sort((a: any, b: any) => dist(de, a) - dist(de, b));
    const primeiro = perto[0];
    const cand = perto.slice(1).filter((n: any) => dist(primeiro, n) <= MAX_KM).slice(0, VIS_DIA - 1);
    const grupo = rota([primeiro, ...cand]);
    grupo.forEach((n: any) => visitados.add(n.gkey));
    const maisRelevante = grupo.slice().sort((a: any, b: any) => b.prio - a.prio)[0];
    dias.push({
      dia: dias.length + 1,
      ancora: maisRelevante.codparc, ancora_nome: maisRelevante.nome, ancora_porque: porque(maisRelevante),
      cidade_base: primeiro.cidade, uf: primeiro.uf,
      clientes: grupo.map((n: any, k: number) => ({
        ordem: k + 1, codparc: n.codparc, nome: n.nome, cidade: n.cidade, cep: fmtCep(n.cep), uf: n.uf,
        km: (n.lat != null && primeiro.lat != null) ? Math.round(dist(primeiro, n)) : null,
        fat: Math.round(n.fat12m), fat_fmt: brl(n.fat12m), dias: n.dias, giro: n.giro,
        clube_saldo: Number(n.clube_saldo) || 0, lojas: n.lojas,
        posicionamento: posic(n), motivo: porque(n), ancora: n.gkey === maisRelevante.gkey,
      })),
    });
    de = grupo[grupo.length - 1];   // o dia seguinte parte daqui
  }

  const contatos: any[] = []; const seen: any = {};
  if (sr) { pushCanal(contatos, seen, "whatsapp", sr.celular, "Sankhya"); pushCanal(contatos, seen, "whatsapp", sr.fone_parc, "Sankhya"); pushCanal(contatos, seen, "email", sr.email, "Sankhya"); pushCanal(contatos, seen, "email", sr.email_crm, "CRM"); }
  /* TOM: muitos desses clientes o rep JA esta atendendo, e ele conhece a praca melhor que a gente.
     Entao o texto se apresenta como apoio, diz de saida que e sugestao e que ele pode ignorar, e
     nunca cobra visita, prazo ou resultado. Sem isso a mensagem soa como roteiro imposto por quem
     nao esta na rua. */
  const uf1 = dias.length ? sig(dias[0].uf) : "";
  let msg = "Oi " + nome + ", tudo bem?\n\n"
    + "Levantamos aqui uma sugestao de sequencia de visitas para a proxima semana, olhando quem esta "
    + "com o ciclo de compra vencido e agrupando por proximidade para economizar seu deslocamento.\n\n"
    + "Antes de tudo: e so uma sugestao, montada de fora. Voce conhece a praca e o momento de cada "
    + "cliente muito melhor que a gente — se alguns desses voce ja esta atendendo, ou se a ordem nao "
    + "faz sentido para a sua semana, ignore sem problema. A ideia e te poupar trabalho de "
    + "planejamento, nao te dar rota.\n\n"
    + "São " + visitados.size + " contas em " + dias.length + " dia(s)"
    + (uf1 ? (", concentradas em " + uf1) : "") + ", ate " + MAX_KM + "km entre os pontos de cada dia.\n";
  dias.forEach((d: any) => {
    msg += "\n━━━ DIA " + d.dia + " · " + (d.cidade_base || "") + " e regiao (" + d.clientes.length + " visitas) ━━━\n";
    d.clientes.forEach((c: any) => {
      msg += "\n" + c.ordem + ") " + (c.ancora ? "⭐ " : "") + c.nome + "\n   "
        + (c.cidade || "") + (sig(c.uf) ? ("/" + sig(c.uf)) : "") + " · CEP " + c.cep
        + (c.km != null ? (" · ~" + c.km + "km do primeiro") : "") + "\n   " + c.motivo + "\n";
    });
  });
  if (foraDaRegiao > 0) {
    msg += "\nTem outras " + foraDaRegiao + " conta(s) suas fora dessa regiao. Deixamos de fora de proposito "
      + "para a semana nao virar ida e volta entre estados — elas entram numa proxima sugestao, ou "
      + "antes, se voce preferir comecar por elas.\n";
  }
  msg += "\nO que podemos fazer para te ajudar? Se quiser que a gente levante algo antes de alguma "
    + "visita — historico de compra, mix que ele nao leva, condicao comercial, saldo do Clube — me "
    + "fala que eu preparo. E se preferir a sugestao de outra forma (outra regiao, mais ou menos "
    + "visitas por dia), e so dizer.";
  return { rep: nome, codvend: rep, instancia: ri?.instancia || null, instancia_erp: ri?.instancia_erp || null, divergente: !!ri?.divergente, contatos, total: nodes.length, cobertos: visitados.size, fora_da_regiao: foraDaRegiao, uf_semana: dias.length ? (sig(dias[0].uf) || null) : null, dias, mensagem: msg };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams; const repParam = p.get("rep"); const loteParam = p.get("lote");
    const intra = await intraSet(sb);

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
      const lote = cvs.map((cv) => { const r = montar(cv, byRep[String(cv)] || [], srBy[String(cv)], geo, riBy[String(cv)]); return { codvend: r.codvend, rep: r.rep, instancia: r.instancia, instancia_erp: r.instancia_erp, divergente: r.divergente, contatos: r.contatos, total: r.total, cobertos: r.cobertos, dias_n: r.dias.length, mensagem: r.mensagem }; });
      return j({ lote });
    }

    if (!repParam) {
      const byRep: Record<string, any[]> = {}; let from = 0;
      while (true) { const { data } = await sb.from("roteiro_cliente_apto").select("codparc,codparcmatriz,codvend,rep,fat12m,dias,giro,clube_saldo").range(from, from + 999); (data || []).forEach((c: any) => { if (c.codvend == null || intra.has(Number(c.codparc))) return; (byRep[c.codvend] = byRep[c.codvend] || []).push(c); }); if (!data || data.length < 1000) break; from += 1000; }
      const reps = Object.keys(byRep).map((cv) => { const nodes = agrupar(byRep[cv]); const rep = (byRep[cv][0] || {}).rep; return { codvend: Number(cv), rep, clientes: nodes.length, prioritarios: nodes.filter((n) => gatilho(n).any).length, fat: Math.round(nodes.reduce((a, b) => a + (Number(b.fat12m) || 0), 0)) }; }).sort((a, b) => b.prioritarios - a.prioritarios || b.fat - a.fat);
      return j({ reps });
    }

    const rep = parseInt(repParam);
    const geo = await loadGeo(sb);
    const todas: any[] = []; { let f = 0; while (true) { const { data } = await sb.from("roteiro_cliente_apto").select("*").eq("codvend", rep).range(f, f + 999); (data || []).forEach((r: any) => todas.push(r)); if (!data || data.length < 1000) break; f += 1000; } }
    const rows = todas.filter((c: any) => !intra.has(Number(c.codparc)));
    const { data: sr } = await sb.from("snap_rep").select("*").eq("codvend", rep).maybeSingle();
    const { data: ri } = await sb.from("rep_instancia").select("codvend,instancia,instancia_erp,divergente").eq("codvend", rep).maybeSingle();
    return j(montar(rep, rows, sr, geo, ri));
  } catch (e) { return j({ erro: String(e) }, 500); }
});
