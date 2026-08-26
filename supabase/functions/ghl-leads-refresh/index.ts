// ghl-leads-refresh (v1) — espelha os contatos do CRM em snap_lead. ?empresa=<painel_id>
//
// POR QUE ESTA FUNCAO EXISTE: na Nitron o publico das campanhas sempre veio do ERP (contrato,
// saldo do Clube, voucher, giro). Na Teak esse caminho entrega 13 clientes. O volume real dela
// esta no CRM — 2931 contatos, quase todos leads de feira (Formobile 2024/2026) e de WhatsApp de
// entrada, sem CODPARC porque nunca compraram. Destes, 220 estao com a tag
// "aguardando-nossa-resposta": divida da empresa, nao lista de prospeccao. Nenhuma view da
// maquina conseguia enxergar isso, porque nao havia de onde ler.
//
// Segue o mesmo padrao dos snap_*: a campanha NUNCA fala com o GHL na hora de montar publico.
// Le o snapshot. Aqui tambem: troca por empresa (delete .eq(empresa) + insert), e aborta ANTES
// de apagar se a API nao devolver nada — sem isso um 401 do GHL zeraria o publico da empresa e a
// tela mostraria "0 leads" como se fosse verdade.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };

const API = "https://services.leadconnectorhq.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
// O token do GHL e escopado POR LOCATION. Conferido em 26/08: o token da Nitron responde
// 403 "The token does not have access to this location" na location da Teak. Por isso o token
// vem do secret que o cadastro nomeia (empresa.ghl_token_env), com GHL_TOKEN como reserva.
function ghl(tok: string, method: string, path: string, body?: any, version = "2021-07-28") {
  return fetch(API + path, {
    method,
    headers: { "Authorization": "Bearer " + tok, "Version": version, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const txt = (v: any) => { const s = v === null || v === undefined ? "" : String(v).trim(); return s || null; };
const iso = (v: any) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d.toISOString(); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const empId = url.searchParams.get("empresa") || "teak";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());

    const { data: erow, error: eEmp } = await sb.from("empresa")
      .select("painel_id, nome, ghl_location, campos, ghl_token_env").eq("painel_id", empId).maybeSingle();
    if (eEmp) throw eEmp;
    if (!erow) throw new Error(`empresa "${empId}" nao esta no cadastro`);
    const loc = String(erow.ghl_location || "");
    if (!loc) throw new Error(`empresa "${empId}" sem ghl_location no cadastro`);
    const tokEnv = String(erow.ghl_token_env || "GHL_TOKEN");
    const tok = Deno.env.get(tokEnv) || Deno.env.get("GHL_TOKEN") || "";
    if (!tok) throw new Error(`sem token do GHL para ${empId}: o secret ${tokEnv} nao existe nas Edge Functions`);
    const campos: Record<string, string> = (erow.campos && typeof erow.campos === "object") ? erow.campos : {};
    // de-para invertido: id do campo -> chave semantica, para ler o customFields de cada contato
    const porId: Record<string, string> = {};
    for (const [k, v] of Object.entries(campos)) if (v) porId[String(v)] = k;

    // ---- pipelines e estagios: para as views falarem "Qualificado" e nao um uuid ----
    let pipes = 0;
    {
      const r = await ghl(tok, "GET", `/opportunities/pipelines?locationId=${encodeURIComponent(loc)}`);
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        const linhas: any[] = [];
        for (const p of (d?.pipelines || [])) {
          for (const s of (p?.stages || [])) {
            linhas.push({ empresa: empId, pipeline_id: String(p.id), pipeline: String(p.name || ""), stage_id: String(s.id), stage: String(s.name || ""), posicao: Number(s.position || 0) });
          }
        }
        if (linhas.length) {
          const { error } = await sb.from("snap_pipeline").delete().eq("empresa", empId); if (error) throw error;
          const { error: e2 } = await sb.from("snap_pipeline").insert(linhas); if (e2) throw e2;
          pipes = linhas.length;
        }
      }
    }

    // ---- contatos ----
    // A busca v2 pagina por searchAfter (o cursor vem em cada contato). pageLimit maximo 100.
    const vistos = new Set<string>();
    const linhas: any[] = [];
    let searchAfter: any = null;
    let paginas = 0;
    let total = -1;
    const MAX_PAG = 120;   // 120 x 100 = 12 mil contatos; teto para nao girar sem fim num cursor preso
    while (paginas < MAX_PAG) {
      const body: any = { locationId: loc, pageLimit: 100, sort: [{ field: "dateAdded", direction: "desc" }] };
      if (searchAfter) body.searchAfter = searchAfter;
      const r = await ghl(tok, "POST", "/contacts/search", body);
      if (!r.ok) {
        // Nao apaga nada: erro de API nao pode virar "a empresa nao tem lead".
        const corpo = (await r.text()).slice(0, 300);
        const dica = r.status === 403
          ? ` — o token do secret ${tokEnv} nao tem acesso a location ${loc}. Token do GHL e por location: gere um para esta subconta e grave no secret ${tokEnv}.`
          : "";
        throw new Error(`GHL /contacts/search HTTP ${r.status}: ${corpo}${dica}`);
      }
      const d = await r.json().catch(() => ({}));
      const lote: any[] = d?.contacts || [];
      if (total < 0) total = Number(d?.total ?? -1);
      if (!lote.length) break;
      paginas++;
      for (const c of lote) {
        const id = String(c?.id || ""); if (!id || vistos.has(id)) continue;
        vistos.add(id);
        const cf: Record<string, any> = {};
        for (const f of (c?.customFields || [])) { const k = porId[String(f?.id)]; if (k) cf[k] = f?.value; }
        const opp = (c?.opportunities || [])[0] || null;
        const cp = Number(String(cf.codparc ?? "").replace(/\D/g, ""));
        linhas.push({
          empresa: empId,
          ghl_id: id,
          nome: txt(c?.contactName) || txt([c?.firstName, c?.lastName].filter(Boolean).join(" ")) || txt(c?.companyName),
          fone: txt(c?.phone),
          email: txt(c?.email),
          dono_ghl_id: txt(c?.assignedTo),
          tags: Array.isArray(c?.tags) ? c.tags.map((t: any) => String(t)) : [],
          fonte: txt(c?.source),
          pipeline_id: opp ? txt(opp.pipelineId) : null,
          stage_id: opp ? txt(opp.pipelineStageId) : null,
          opp_id: opp ? txt(opp.id) : null,
          opp_status: opp ? txt(opp.status) : null,
          opp_valor: opp && Number.isFinite(Number(opp.monetaryValue)) ? Number(opp.monetaryValue) : null,
          codparc: Number.isFinite(cp) && cp > 0 ? cp : null,
          razao_social: txt(cf.razao_social) || txt(c?.companyName),
          ramo: txt(cf.ramo),
          canal: txt(cf.canal),
          resumo_ia: txt(cf.resumo_ia),
          dnd: c?.dnd === true,
          criado_em: iso(c?.dateAdded),
          mexido_em: iso(c?.dateUpdated) || iso(c?.dateAdded),
        });
      }
      const ultimo = lote[lote.length - 1];
      searchAfter = ultimo?.searchAfter || null;
      if (!searchAfter) break;
      if (lote.length < 100) break;
    }

    if (!linhas.length) throw new Error(`GHL nao devolveu contato nenhum para ${empId} — abortado ANTES de apagar o snapshot de lead`);

    const { error: eDel } = await sb.from("snap_lead").delete().eq("empresa", empId); if (eDel) throw eDel;
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await sb.from("snap_lead").insert(linhas.slice(i, i + 500));
      if (error) throw new Error("snap_lead: " + error.message);
    }

    const res = {
      empresa: empId, location: loc, token_env: tokEnv, leads: linhas.length, paginas,
      total_informado_pelo_ghl: total < 0 ? null : total,
      // Se o GHL diz um total e a gente gravou menos, a paginacao parou no meio. Melhor a tela
      // saber disso do que mostrar um numero menor como se fosse a base inteira — foi o defeito
      // "contar e listar sao perguntas diferentes" da secao 5.7 do doc.
      paginacao_incompleta: total > 0 && linhas.length < total,
      estagios: pipes,
      com_codparc: linhas.filter((x) => x.codparc).length,
      sem_fone: linhas.filter((x) => !x.fone).length,
      donos: [...new Set(linhas.map((x) => x.dono_ghl_id).filter(Boolean))].length,
    };
    const { error: eMeta } = await sb.from("cache_meta").upsert({ chave: `leads:${empId}`, atualizado: new Date().toISOString(), detalhe: JSON.stringify(res) }); if (eMeta) throw eMeta;
    return j({ ok: true, ...res });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
