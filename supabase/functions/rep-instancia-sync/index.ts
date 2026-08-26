// rep-instancia-sync (v3) — grava em rep_carteira quem e o proprietario do contato de cada
// representante no CRM, para TODAS as campanhas lerem a mesma verdade pela view rep_instancia.
//
// Por que isso existe: o numero de WhatsApp que o cliente ve e o do usuario remetente, e numa
// mensagem de API o remetente e o assignedTo do contato no GHL. As campanhas antigas pegavam a
// instancia de snap_rep.assistente — o nome da assistente vindo do organograma do Sankhya, casado
// por nome. Isso e "quem deveria atender", nao "por qual numero sai", e por isso a mensagem chegava
// pela assistente errada. Aqui a gente le o CRM de fato e guarda o resultado.
//
// GET/POST -> { ok, reps, com_dono, sem_contato_no_crm, dono_fora_do_cadastro, divergentes, por_instancia:{...} }
// POST { seco:true } -> so calcula e devolve, sem gravar.
//
// v3: quando varios contatos dividem o mesmo telefone (ha rep com 2 e 3 contatos repetidos no CRM),
// guardamos TODOS os donos daquele numero e escolhemos o que e assistente do cadastro. Antes o
// ultimo da lista vencia, e se ele fosse um dono qualquer o rep aparecia como "sem instancia"
// mesmo tendo um contato certo — foi o que aconteceu com ROBERTO e WALDEMAR.
//
// A instancia_crm_em e gravada em TODAS as linhas lidas, inclusive nas que ficaram sem dono: sem
// isso a view nao saberia diferenciar "nunca li o CRM" de "li e este rep nao tem proprietaria".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const nf = (s: any) => digits(s).replace(/^0+/, "").replace(/^55/, "");
function e164(fone: any): string { const d = digits(fone); if (!d) return ""; if (d.length <= 11) return "+55" + d; return "+" + d; }
// celular brasileiro tem 11 digitos (DDD + 9 + 8), mas o Sankhya guarda muito numero antigo com 10 e
// o CRM guarda com 9. Sem procurar as duas formas, o rep aparece como "sem dono" tendo dono.
function variantes(fone: any): string[] {
  const d = nf(fone); if (d.length < 10) return [];
  const out = new Set<string>([d]);
  if (d.length === 10) out.add(d.slice(0, 2) + "9" + d.slice(2));
  if (d.length === 11 && d[2] === "9") out.add(d.slice(0, 2) + d.slice(3));
  return [...out];
}

const API = "https://services.leadconnectorhq.com";
// v: locationId E TOKEN saem do fonte e vem do cadastro `empresa`. Cada empresa do grupo e uma
// SUBCONTA (location) diferente do mesmo GHL, e o token do GHL e escopado por location:
// conferido em 26/08, o token da Nitron responde 403 "The token does not have access to this
// location" na location da Teak. Mandar para a subconta errada cria contato no CRM errado.
// Os dois sao passados como ARGUMENTO, nunca guardados em variavel de modulo: estado de modulo e
// compartilhado pelo isolate, e duas requisicoes de empresas diferentes ao mesmo tempo poderiam
// trocar o valor no meio da operacao.
// O loader esta repetido nas funcoes que precisam dele de proposito: cada Edge Function e um
// deploy independente, e um import compartilhado significaria redeployar todas juntas.
type EmpGhl = { loc: string; tok: string };
const empGhlCache: Record<string, { at: number; v: EmpGhl }> = {};
async function empresaGhl(id: string): Promise<EmpGhl> {
  const hit = empGhlCache[id];
  if (hit && Date.now() - hit.at < 300000) return hit.v;
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""); const k = srvKey();
  if (!base || !k) throw new Error("sem SUPABASE_URL/chave de servico para ler o cadastro de empresa");
  const r = await fetch(`${base}/rest/v1/empresa?painel_id=eq.${encodeURIComponent(id)}&select=ghl_location,ghl_token_env`, { headers: { apikey: k, Authorization: "Bearer " + k } });
  if (!r.ok) throw new Error("cadastro de empresa: HTTP " + r.status);
  const rows = await r.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  const loc = row?.ghl_location ? String(row.ghl_location) : "";
  if (!loc) throw new Error(`empresa "${id}" sem ghl_location no cadastro — operacao recusada`);
  const tokEnv = String(row?.ghl_token_env || "GHL_TOKEN");
  const tok = Deno.env.get(tokEnv) || Deno.env.get("GHL_TOKEN") || "";
  if (!tok) throw new Error(`sem token do GHL para "${id}": o secret ${tokEnv} nao existe nas Edge Functions`);
  const v: EmpGhl = { loc, tok };
  empGhlCache[id] = { at: Date.now(), v };
  return v;
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
// Uma busca no GHL por lote de telefones; devolve fone normalizado -> TODOS os assignedTo achados.
async function donosPorFone(g: EmpGhl, fones: string[]): Promise<Record<string, string[]> | null> {
  const tok = g.tok; if (!tok || !fones.length) return null;
  const out: Record<string, string[]> = {};
  try {
    for (let i = 0; i < fones.length; i += 90) {
      const r = await fetch(API + "/contacts/search", {
        method: "POST",
        headers: { "Authorization": "Bearer " + tok, "Version": "2021-07-28", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA },
        body: JSON.stringify({ locationId: g.loc, pageLimit: 100, filters: [{ field: "phone", operator: "contains_set", value: fones.slice(i, i + 90) }] }),
      });
      if (!r.ok) return null;
      const d = await r.json().catch(() => ({}));
      (d?.contacts || []).forEach((c: any) => { const k = nf(c?.phone); if (k && c?.assignedTo) (out[k] = out[k] || []).push(String(c.assignedTo)); });
    }
    return out;
  } catch { return null; }
}
// Mesma ideia, por e-mail: ha rep cujo telefone no Sankhya nao casa com nenhum do CRM.
async function donosPorEmail(g: EmpGhl, mails: string[]): Promise<Record<string, string[]>> {
  const tok = g.tok; if (!tok || !mails.length) return {};
  const out: Record<string, string[]> = {};
  try {
    for (let i = 0; i < mails.length; i += 90) {
      const r = await fetch(API + "/contacts/search", {
        method: "POST",
        headers: { "Authorization": "Bearer " + tok, "Version": "2021-07-28", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA },
        body: JSON.stringify({ locationId: g.loc, pageLimit: 100, filters: [{ field: "email", operator: "contains_set", value: mails.slice(i, i + 90) }] }),
      });
      if (!r.ok) return out;
      const d = await r.json().catch(() => ({}));
      (d?.contacts || []).forEach((c: any) => { const k = String(c?.email || "").trim().toLowerCase(); if (k && c?.assignedTo) (out[k] = out[k] || []).push(String(c.assignedTo)); });
    }
  } catch { /* o que vier vale */ }
  return out;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    // empresa primeiro: sem location resolvida esta funcao nao fala com o GHL.
    const empId = String(b.empresa || "nitron");
    const g = await empresaGhl(empId);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());

    const { data: rcs, error: eR } = await sb.from("rep_carteira").select("codvend,apelido,codparc,celular,email,assist_idcrm"); if (eR) throw eR;
    // filtra por empresa (ver a mesma nota em rep-instancia-atribuir)
    const { data: instRows, error: eI } = await sb.from("instancia_ghl").select("instancia,usuario_ghl_id").eq("ativa", true).eq("empresa", empId); if (eI) throw eI;
    const porUsuario: Record<string, string> = {};
    (instRows || []).forEach((x: any) => { if (x.usuario_ghl_id) porUsuario[String(x.usuario_ghl_id)] = String(x.instancia); });

    const { data: extras, error: eE } = await sb.from("rep_contato_extra").select("codvend,tipo,valor").eq("ativo", true); if (eE) throw eE;
    const exMap: Record<string, string[]> = {}; const exMail: Record<string, string[]> = {};
    (extras || []).forEach((e: any) => { const m = e.tipo === "email" ? exMail : exMap; (m[e.codvend] = m[e.codvend] || []).push(e.valor); });

    // contatos da base do parceiro do proprio rep — mesmo conjunto que a tela do comunicado usa
    const cps = Array.from(new Set((rcs || []).map((r: any) => Number(r.codparc)).filter((x: number) => x > 0)));
    const baseCp: Record<string, string[]> = {};
    for (let i = 0; i < cps.length; i += 300) {
      const ch = cps.slice(i, i + 300);
      const { data: sc, error: e1 } = await sb.from("snap_contato").select("codparc,fone").in("codparc", ch); if (e1) throw e1;
      (sc || []).forEach((c: any) => { if (c.fone) (baseCp[c.codparc] = baseCp[c.codparc] || []).push(c.fone); });
      const { data: gc, error: e2 } = await sb.from("ghl_contato").select("codparc,fone").in("codparc", ch); if (e2) throw e2;
      (gc || []).forEach((c: any) => { if (c.fone) (baseCp[c.codparc] = baseCp[c.codparc] || []).push(c.fone); });
    }

    const reps = (rcs || []).map((r: any) => {
      const cv = String(r.codvend); const cp = String(r.codparc || 0);
      const tels: string[] = []; const vistos = new Set<string>();
      ([r.celular] as any[]).concat(exMap[cv] || []).concat(baseCp[cp] || []).forEach((v: any) => {
        const k = nf(v); if (k && k.length >= 10 && !vistos.has(k)) { vistos.add(k); tels.push(String(v)); }
      });
      const mails = ([r.email] as any[]).concat(exMail[cv] || []).map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean);
      return { codvend: Number(r.codvend), nome: String(r.apelido || ("Rep " + r.codvend)), tels, mails, instancia_erp: (r.assist_idcrm && porUsuario[String(r.assist_idcrm)]) || null };
    });

    const fones = Array.from(new Set(reps.flatMap((r) => r.tels.flatMap((t) => variantes(t)).map((t) => e164(t)).filter(Boolean))));
    const donos = await donosPorFone(g, fones);
    if (!donos) return j({ ok: false, erro: "nao consegui ler o CRM — nada foi gravado (melhor manter o valor antigo do que apagar)" }, 502);
    const donosMail = await donosPorEmail(g, Array.from(new Set(reps.flatMap((r) => r.mails))));

    let com = 0, sem = 0, fora = 0, div = 0;
    const porInst: Record<string, number> = {};
    const linhas = reps.map((r) => {
      let inst: string | null = null; let dono_fora = false;
      // um numero pode ter mais de um contato no CRM; vale o dono que e assistente do cadastro
      const avaliar = (donosDoAlvo?: string[]) => {
        for (const dono of (donosDoAlvo || [])) {
          if (porUsuario[dono]) { inst = porUsuario[dono]; return true; }
          dono_fora = true;   // achou o contato, mas o dono nao e assistente do cadastro
        }
        return false;
      };
      for (const t of r.tels.flatMap((x) => variantes(x))) { if (avaliar(donos[nf(t)])) break; }
      if (!inst) for (const m of r.mails) { if (avaliar(donosMail[m])) break; }
      if (inst) { com++; porInst[inst] = (porInst[inst] || 0) + 1; if (r.instancia_erp && r.instancia_erp !== inst) div++; }
      else if (dono_fora) fora++;
      else sem++;
      return { codvend: r.codvend, nome: r.nome, instancia_crm: inst, instancia_erp: r.instancia_erp };
    });

    const agora = new Date().toISOString();
    let snap = 0;
    if (b.seco !== true) {
      for (const l of linhas) {
        const { error } = await sb.from("rep_carteira").update({ instancia_crm: l.instancia_crm, instancia_crm_em: agora }).eq("codvend", l.codvend);
        if (error) throw error;
      }
      // as campanhas antigas leem snap_rep.assistente; o gatilho ja corrige o que for gravado dali
      // pra frente, e aqui a gente reaplica no que ja estava na tabela.
      const { data: n, error: eN } = await sb.rpc("snap_rep_reaplica_instancia");
      if (eN) throw eN;
      snap = Number(n) || 0;
    }
    return j({
      ok: true, seco: b.seco === true, reps: linhas.length, telefones_consultados: fones.length,
      com_dono: com, sem_contato_no_crm: sem, dono_fora_do_cadastro: fora, divergentes: div,
      por_instancia: porInst, snap_rep_ajustados: snap, lido_em: agora,
      detalhe: b.detalhe === true ? linhas : undefined,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
