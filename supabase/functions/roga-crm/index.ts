// roga-crm (v1) — o funil da Roga Village lido AO VIVO do GHL.
//
// Por que esta funcao existe, e por que ela e diferente de tudo que ja havia aqui:
// a Maquina de Vendas da Nitron nasce no Sankhya (snap_* -> views -> fila). A Roga Village NAO
// tem venda no ERP: as 976 notas dela em 12 meses sao todas de COMPRA (Compra Servicos, Compra
// Consumo, Compra Energia) e os 298 "parceiros" com movimento sao FORNECEDORES do hotel. Rodar
// cache-refresh com CODEMP 12 devolve zero linha. O publico da Roga esta no CRM, nao no ERP —
// o caminho inverso da Nitron. Entao aqui nao ha snapshot: le-se o GHL na hora.
//
// Duas decisoes de projeto que valem para quem for copiar isto para outra empresa:
//
// 1. A location NAO e chumbada. Vem da tabela public.empresa (coluna ghl_location) pelo ?empresa=.
//    As outras 5 funcoes tem `const LOC = "rZ8y7lzqV7fzxsartaX2"` no fonte (pendencia 5); o
//    cadastro que resolveria isso ja existe, so nao era lido. Esta le.
// 2. As oportunidades sao PAGINADAS e agregadas em memoria, em vez de uma chamada por estagio.
//    Com 5 pipelines x ~7 estagios seriam ~35 chamadas para montar a mesma tabela. Agregar da o
//    numero exato e custa 1-2 chamadas.
//
// Contar e listar sao perguntas diferentes (secao 5.7 do doc): todo total daqui vem de contagem
// no destino — meta.total do GHL ou o length do agregado —, nunca do tamanho de uma pagina.
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

async function contarContatos(tok: string, loc: string, filtros: unknown[]): Promise<number | null> {
  const r = await fetch(API + "/contacts/search", {
    method: "POST", headers: H(tok),
    body: JSON.stringify({ locationId: loc, pageLimit: 1, filters: filtros }),
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return typeof d?.total === "number" ? d.total : null;
}

// Total EXATO de oportunidades de um pipeline, direto do meta.total do GHL.
// Existe porque agregar pagina pode subcontar: a Nitron tem +4000 oportunidades e estoura
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
    const empresa = (url.searchParams.get("empresa") || "ROGA").toUpperCase();
    // Token POR EMPRESA, com fallback para o global. Descoberto na marra em 26/08: o GHL_TOKEN
    // que existe hoje e da location da NITRON, nao da agencia — chamar a Roga com ele devolve
    // 403 "The token does not have access to this location". Cada subconta precisa do seu.
    const tok = Deno.env.get("GHL_TOKEN_" + empresa) || Deno.env.get("GHL_TOKEN");
    if (!tok) return j({ ok: false, erro: `sem token: configure GHL_TOKEN_${empresa} nos segredos da funcao` }, 500);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const { data: emp, error: eEmp } = await sb.from("empresa").select("codigo, nome, codemp, ghl_location, linha_negocio").eq("codigo", empresa).maybeSingle();
    if (eEmp) throw eEmp;
    if (!emp) return j({ ok: false, erro: `empresa ${empresa} nao esta em public.empresa` }, 404);
    const loc = emp.ghl_location;
    if (!loc) return j({ ok: false, erro: `empresa ${empresa} nao tem ghl_location cadastrada` }, 400);

    // ---- pipelines (estrutura) ----
    const rp = await fetch(API + `/opportunities/pipelines?locationId=${encodeURIComponent(loc)}`, { headers: H(tok) });
    if (!rp.ok) {
      const corpo = (await rp.text()).slice(0, 200);
      // 403 aqui quase sempre e token da location errada, nao permissao faltando no escopo.
      // A mensagem diz o que fazer porque quem abre a tela nao tem como adivinhar.
      const dica = rp.status === 403
        ? ` — o token em uso nao alcanca a location ${loc}. Gere um Private Integration token NA SUBCONTA ${empresa} (escopos: opportunities.readonly, contacts.readonly, locations/customFields.readonly) e grave como segredo GHL_TOKEN_${empresa}.`
        : "";
      return j({ ok: false, erro: `GHL pipelines ${rp.status}: ${corpo}${dica}`, precisa_token: rp.status === 403, segredo: `GHL_TOKEN_${empresa}` }, 502);
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
        return {
          id: s.id, nome: s.name, posicao: s.position,
          total: nele.length,
          aberto: nele.filter((o) => o?.status === "open").length,
          ganho: nele.filter((o) => o?.status === "won").length,
          perdido: nele.filter((o) => o?.status === "lost").length,
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
        // Quantos estagios do meio estao zerados. E o numero que denuncia funil que nao e
        // trabalhado: na Roga as oportunidades ficam na entrada ou sao despejadas no ultimo,
        // e os estagios do meio nunca recebem ninguem.
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

    const publicos: any[] = [];
    for (const t of TAGS) {
      const n = await contarContatos(tok, loc, [{ field: "tags", operator: "eq", value: t }]);
      publicos.push({ tag: t, contatos: n });
    }

    return j({
      ok: true,
      empresa: { codigo: emp.codigo, nome: emp.nome, codemp: emp.codemp, linha_negocio: emp.linha_negocio, ghl_location: loc },
      atualizado: new Date().toISOString(),
      base: { total, com_fone: comFone, com_email: comEmail, com_dono: comDono, com_tag: comTag, em_dnd: emDnd },
      funil,
      publicos,
      oportunidades_lidas: opps.length,
      truncado,
    });
  } catch (e) {
    return j({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
