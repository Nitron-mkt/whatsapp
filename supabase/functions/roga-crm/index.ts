// roga-crm (v3) — o funil, os sinais e as campanhas possiveis da Roga Village, lidos AO VIVO do GHL.
//
// Por que esta funcao existe, e por que ela e diferente de tudo que ja havia aqui:
// a Maquina de Vendas da Nitron nasce no Sankhya (snap_* -> views -> fila). A Roga Village NAO
// tem venda no ERP: as 976 notas dela em 12 meses sao todas de COMPRA (Compra Servicos, Compra
// Consumo, Compra Energia) e os 298 "parceiros" com movimento sao FORNECEDORES do hotel. Rodar
// cache-refresh com CODEMP 12 devolve zero linha. O publico da Roga esta no CRM, nao no ERP —
// o caminho inverso da Nitron. Entao aqui nao ha snapshot: le-se o GHL na hora.
//
// v2: o ERP saiu de cena de vez. Conferido campo a campo em 27/08 — os sete campos criados em
// 19/08 para receber dado do Sankhya (CODPARC, Ultima Estadia, Estadias, Estado do Ciclo, Canal
// Preferido, Valor Vencido, Ficha Roga IA) estao TODOS com zero contato. Nao havia o que importar.
// A funcao passa a medir os campos que a operacao do CRM realmente alimenta (bloco `sinais`) e
// continua contando os do ERP (bloco `erp`) so para a tela poder AFIRMAR que estao vazios, em vez
// de o leitor ter de confiar. Numero na tela vale mais que promessa no documento.
//
// Duas decisoes de projeto que valem para quem for copiar isto para outra empresa:
//
// 1. A location NAO e chumbada. Vem da tabela public.empresa (coluna ghl_location) pelo ?empresa=.
//    As outras 5 funcoes tem `const LOC = "rZ8y7lzqV7fzxsartaX2"` no fonte (pendencia 5); o
//    cadastro que resolveria isso ja existe, so nao era lido. Esta le.
// 2. Total e distribuicao vem de fontes DIFERENTES, de proposito. O total de cada pipeline sai do
//    meta.total do GHL; a distribuicao por estagio sai da leitura paginada. Descoberto testando
//    contra a Nitron: ela tem +11 mil oportunidades e estoura a paginacao, e um total tirado do
//    agregado truncado saia 3x menor sem ninguem perceber — exatamente o erro da secao 5.7.
//
// v3: alinhada a fundacao multiempresa que veio da branch da Teak — a empresa e resolvida por
// `painel_id` (minusculo) e o nome do secret do token vem de `empresa.ghl_token_env`, em vez de
// uma convencao de nome montada aqui dentro. Duas convencoes para a mesma coisa divergem sempre.
//
// Contar e listar sao perguntas diferentes: todo total daqui vem de contagem no destino.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const API = "https://services.leadconnectorhq.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
const H = (tok: string) => ({ Authorization: "Bearer " + tok, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA });

// Publicos que a operacao da Roga realmente usa hoje. Tag vazia continua na lista de proposito:
// ver "0" na tela e a informacao de que a tag existe e ninguem alimenta — sumir com a linha
// esconderia isso.
const TAGS = ["contato-empresas", "agencias", "mailling_paulinho", "reserva-roga", "proposta-roga", "cubo", "business-clube", "treinamentos", "network", "listafrianitron"];

// Campos que o CRM alimenta de verdade. O `id` e do custom field na location da Roga.
// `objetivo` e o mais valioso da conta: intencao ja classificada pelo agente de IA que atende no
// Instagram e no WhatsApp ("Eventos Corporativos: empresa/equipe/reuniao", "Restaurante: almoco/
// day use"). E o que transforma 10 mil contatos num publico de verdade.
const SINAIS: Record<string, { id: string; rotulo: string }> = {
  objetivo: { id: "kLGCtBvTpMzqYlYA3Ppp", rotulo: "Objetivo do Lead" },
  resumo: { id: "0xXF4W9OMb4fts5kRTzu", rotulo: "Resumo do Lead" },
  observacao: { id: "2DTFY3SCJ4HZbTMQTVfF", rotulo: "Observacao do Lead" },
  o_que_precisa: { id: "fBQYUo8ao45l2Xe2rndf", rotulo: "O que precisa?" },
  segmento: { id: "X7xe5sbli9TaW1DDX0d9", rotulo: "Segmento" },
  info_gerais: { id: "C0Y6aHESDgZiVPRHqNIG", rotulo: "Informacoes Gerais do Lead" },
};

// Os sete campos criados em 19/08 para receber o Sankhya. Contados so para provar que estao
// vazios — enquanto somarem zero, a tela diz que nao ha nada do ERP no CRM.
const CAMPOS_ERP: Record<string, { id: string; rotulo: string }> = {
  codparc: { id: "2YDgTx29anFercto5VRu", rotulo: "CODPARC (Sankhya)" },
  ultima_estadia: { id: "YfH5514OxuVPeBOloOlV", rotulo: "Ultima Estadia" },
  estadias: { id: "n7HGqjaGRnjNdxR5FdC1", rotulo: "Estadias (total)" },
  estado_ciclo: { id: "RnRQa6dlqOLTJAx7wkE5", rotulo: "Estado do Ciclo" },
  canal_preferido: { id: "JcNu14is9AQR9UztegY9", rotulo: "Canal Preferido" },
  valor_vencido: { id: "jA3zKeCbo2GLOUcVRHs1", rotulo: "Valor Vencido" },
  ficha_ia: { id: "kZEoIWNYUvy1Tbd4vABr", rotulo: "Ficha Roga (IA)" },
};

async function contarContatos(tok: string, loc: string, filtros: unknown[]): Promise<number | null> {
  const r = await fetch(API + "/contacts/search", {
    method: "POST", headers: H(tok),
    body: JSON.stringify({ locationId: loc, pageLimit: 1, filters: filtros }),
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return typeof d?.total === "number" ? d.total : null;
}
const temCampo = (id: string) => ({ field: "customFields." + id, operator: "exists" });

// Total EXATO de oportunidades de um pipeline, direto do meta.total do GHL.
// Existe porque agregar pagina pode subcontar: a Nitron tem +11 mil oportunidades e estoura
// qualquer teto razoavel de paginacao. O total de capa nunca pode sair de um agregado
// possivelmente truncado (secao 5.7 do doc: se o numero e um total, conte no destino).
async function totalDoPipeline(tok: string, loc: string, pipelineId: string, status?: string): Promise<number | null> {
  const q = new URLSearchParams({ location_id: loc, pipelineId, limit: "1" });
  if (status) q.set("status", status);
  const r = await fetch(API + "/opportunities/search?" + q.toString(), { headers: H(tok) });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  const t = d?.meta?.total;
  return typeof t === "number" ? t : null;
}

// Puxa TODAS as oportunidades da location, paginando pelo cursor do proprio GHL.
// Serve para montar a DISTRIBUICAO por estagio; os totais de capa vem do totalDoPipeline acima.
// O teto de 120 paginas (12 mil) e freio contra laco infinito se o cursor parar de andar — se
// bater nele, `truncado` volta true e cada pipeline marca distribuicao_parcial.
async function todasOportunidades(tok: string, loc: string) {
  const out: any[] = [];
  let startAfter: number | null = null, startAfterId: string | null = null, truncado = false;
  for (let p = 0; p < 120; p++) {
    const q = new URLSearchParams({ location_id: loc, limit: "100" });
    if (startAfter != null) q.set("startAfter", String(startAfter));
    if (startAfterId) q.set("startAfterId", startAfterId);
    const r = await fetch(API + "/opportunities/search?" + q.toString(), { headers: H(tok) });
    if (!r.ok) throw new Error("GHL opportunities " + r.status + ": " + (await r.text()).slice(0, 200));
    const d = await r.json().catch(() => ({}));
    const lote = (d?.opportunities || []) as any[];
    out.push(...lote);
    const m = d?.meta || {};
    if (!lote.length || !m?.nextPageUrl) return { lista: out, truncado: false };
    startAfter = m.startAfter ?? null; startAfterId = m.startAfterId ?? null;
    if (startAfter == null && !startAfterId) return { lista: out, truncado: false };
    truncado = true; // so continua verdadeiro se o laco terminar pelo teto
  }
  return { lista: out, truncado };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const empresa = (url.searchParams.get("empresa") || "roga").toLowerCase();

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const { data: emp, error: eEmp } = await sb.from("empresa")
      .select("painel_id, codigo, nome, codemp, ghl_location, linha_negocio, universo, ghl_token_env")
      .eq("painel_id", empresa).maybeSingle();
    if (eEmp) throw eEmp;
    if (!emp) return j({ ok: false, erro: `empresa ${empresa} nao esta em public.empresa (painel_id)` }, 404);
    const loc = emp.ghl_location;
    if (!loc) return j({ ok: false, erro: `empresa ${empresa} nao tem ghl_location cadastrada` }, 400);

    // Quem diz o nome do secret e o CADASTRO, nao uma convencao de nome no codigo. Padrao trazido
    // da multiempresa da Teak (empresa.ghl_token_env) — vale seguir um jeito so, senao cada funcao
    // adivinha diferente. O token importa porque o GHL_TOKEN e escopado a UMA location: chamar a
    // Roga com o da Nitron devolve 403 "The token does not have access to this location".
    const tokEnv = String(emp.ghl_token_env || "GHL_TOKEN");
    const tok = Deno.env.get(tokEnv) || Deno.env.get("GHL_TOKEN");
    if (!tok) return j({ ok: false, erro: `sem token: o cadastro da ${empresa} aponta para o segredo ${tokEnv}, que nao existe nas Edge Functions`, segredo: tokEnv }, 500);

    // ---- pipelines (estrutura) ----
    const rp = await fetch(API + `/opportunities/pipelines?locationId=${encodeURIComponent(loc)}`, { headers: H(tok) });
    if (!rp.ok) {
      const corpo = (await rp.text()).slice(0, 200);
      // 403 aqui quase sempre e token da location errada, nao permissao faltando no escopo.
      // A mensagem diz o que fazer porque quem abre a tela nao tem como adivinhar.
      const dica = rp.status === 403
        ? ` — o token em uso nao alcanca a location ${loc}. Gere um Private Integration token NA SUBCONTA ${emp.nome} (escopos: opportunities.readonly, contacts.readonly, locations/customFields.readonly) e grave como segredo ${tokEnv} nas Edge Functions.`
        : "";
      return j({ ok: false, erro: `GHL pipelines ${rp.status}: ${corpo}${dica}`, precisa_token: rp.status === 403, segredo: tokEnv }, 502);
    }
    const pipes = ((await rp.json())?.pipelines || []) as any[];

    // ---- oportunidades (movimento) ----
    const { lista: opps, truncado } = await todasOportunidades(tok, loc);
    const porPipe: Record<string, any[]> = {};
    opps.forEach((o) => { const k = String(o?.pipelineId || ""); (porPipe[k] ||= []).push(o); });

    const funil = await Promise.all(pipes.map(async (p: any) => {
      const meus = porPipe[p.id] || [];
      // Os quatro numeros de capa vem do GHL, nao do agregado — assim continuam certos mesmo
      // quando a leitura pagina truncou. A distribuicao por estagio abaixo e que fica parcial,
      // e nesse caso `distribuicao_parcial` avisa em vez de deixar a tela mentir calada.
      const [tGhl, tAberto, tGanho, tPerdido] = await Promise.all([
        totalDoPipeline(tok, loc, p.id),
        totalDoPipeline(tok, loc, p.id, "open"),
        totalDoPipeline(tok, loc, p.id, "won"),
        totalDoPipeline(tok, loc, p.id, "lost"),
      ]);
      const estagios = (p.stages || []).map((s: any) => {
        const nele = meus.filter((o) => String(o?.pipelineStageId) === String(s.id));
        // Dias parados: quanto tempo faz que a oportunidade mais recente deste estagio mexeu.
        // E o que separa "fila viva" de "fila abandonada" — e o gatilho natural de campanha.
        const datas = nele.map((o) => Date.parse(o?.lastStageChangeAt || o?.updatedAt || o?.createdAt || "")).filter((x) => !isNaN(x));
        return {
          id: s.id, nome: s.name, posicao: s.position,
          total: nele.length,
          aberto: nele.filter((o) => o?.status === "open").length,
          ganho: nele.filter((o) => o?.status === "won").length,
          perdido: nele.filter((o) => o?.status === "lost").length,
          parado_dias: datas.length ? Math.floor((Date.now() - Math.max(...datas)) / 86400000) : null,
        };
      });
      const valorGanho = meus.filter((o) => o?.status === "won").reduce((a, o) => a + Number(o?.monetaryValue || 0), 0);
      const total = tGhl != null ? tGhl : meus.length;
      return {
        id: p.id, nome: p.name, criado: p.dateAdded,
        total,
        aberto: tAberto != null ? tAberto : meus.filter((o) => o?.status === "open").length,
        ganho: tGanho != null ? tGanho : meus.filter((o) => o?.status === "won").length,
        perdido: tPerdido != null ? tPerdido : meus.filter((o) => o?.status === "lost").length,
        valor_ganho: valorGanho,
        // true quando a soma dos estagios nao fecha com o total do GHL: a tabela por estagio
        // esta incompleta e o operador precisa saber disso antes de tirar conclusao dela.
        distribuicao_parcial: total !== meus.length,
        // Quantos estagios estao zerados. E o numero que denuncia funil que nao e trabalhado:
        // na Roga as oportunidades ficam na entrada ou sao despejadas no ultimo, e os estagios
        // do meio nunca recebem ninguem.
        estagios_vazios: estagios.filter((e: any) => e.total === 0).length,
        estagios,
      };
    }));

    // ---- base de contatos (os cortes que decidem canal e publico) ----
    const [total, comFone, comEmail, comDono, comTag, emDnd] = await Promise.all([
      contarContatos(tok, loc, []),
      contarContatos(tok, loc, [{ field: "phone", operator: "exists" }]),
      contarContatos(tok, loc, [{ field: "email", operator: "exists" }]),
      contarContatos(tok, loc, [{ field: "assignedTo", operator: "exists" }]),
      contarContatos(tok, loc, [{ field: "tags", operator: "exists" }]),
      contarContatos(tok, loc, [{ field: "dnd", operator: "eq", value: true }]),
    ]);

    // ---- sinais: os campos que o CRM alimenta, e o cruzamento que vira publico ----
    // objetivo_com_fone e o numero que mais importa da conta: intencao declarada E telefone para
    // falar. Sem o cruzamento, "255 com objetivo" superestima o publico acionavel.
    const chavesSinais = Object.keys(SINAIS);
    const contagensSinais = await Promise.all(chavesSinais.map((k) => contarContatos(tok, loc, [temCampo(SINAIS[k].id)])));
    const sinais: Record<string, { rotulo: string; contatos: number | null }> = {};
    chavesSinais.forEach((k, i) => { sinais[k] = { rotulo: SINAIS[k].rotulo, contatos: contagensSinais[i] }; });
    const [objetivoComFone, objetivoSemDono] = await Promise.all([
      contarContatos(tok, loc, [temCampo(SINAIS.objetivo.id), { field: "phone", operator: "exists" }]),
      contarContatos(tok, loc, [temCampo(SINAIS.objetivo.id), { field: "assignedTo", operator: "not_exists" }]),
    ]);

    // ---- erp: contado so para provar que esta vazio ----
    const chavesErp = Object.keys(CAMPOS_ERP);
    const contagensErp = await Promise.all(chavesErp.map((k) => contarContatos(tok, loc, [temCampo(CAMPOS_ERP[k].id)])));
    const erp: Record<string, { rotulo: string; contatos: number | null }> = {};
    chavesErp.forEach((k, i) => { erp[k] = { rotulo: CAMPOS_ERP[k].rotulo, contatos: contagensErp[i] }; });
    // "medido e vazio" e "nao medido" NAO podem virar o mesmo numero. Somar (n||0) daria 0 nos dois
    // casos, e a tela usa esse 0 para AFIRMAR que nao existe dado do ERP no CRM — afirmacao que
    // seria falsa se as consultas tivessem falhado. Entao vai tambem quantas foram medidas, e a
    // tela so afirma quando as sete responderam.
    const erpMedidos = contagensErp.filter((n) => typeof n === "number").length;
    const erpTotal = erpMedidos ? contagensErp.reduce((a, n) => a + (n || 0), 0) : null;

    const publicos: any[] = [];
    for (const t of TAGS) {
      const n = await contarContatos(tok, loc, [{ field: "tags", operator: "eq", value: t }]);
      publicos.push({ tag: t, contatos: n });
    }

    return j({
      ok: true,
      empresa: { painel_id: emp.painel_id, codigo: emp.codigo, nome: emp.nome, codemp: emp.codemp, linha_negocio: emp.linha_negocio, universo: emp.universo, ghl_location: loc, ghl_token_env: tokEnv },
      atualizado: new Date().toISOString(),
      base: { total, com_fone: comFone, com_email: comEmail, com_dono: comDono, com_tag: comTag, em_dnd: emDnd },
      sinais, objetivo_com_fone: objetivoComFone, objetivo_sem_dono: objetivoSemDono,
      erp, erp_total: erpTotal, erp_medidos: erpMedidos, erp_campos: chavesErp.length,
      funil,
      publicos,
      oportunidades_lidas: opps.length,
      truncado,
    });
  } catch (e) {
    return j({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
