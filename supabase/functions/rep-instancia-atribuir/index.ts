// rep-instancia-atribuir (v1) — poe a assistente do organograma como PROPRIETARIA, no CRM, do
// contato de todo representante que hoje nao tem instancia nenhuma.
//
// Por que: o WhatsApp sai pelo numero do usuario remetente, e numa mensagem de API o remetente e o
// assignedTo do contato. Rep sem proprietaria no cadastro ativo = rep que nao recebe (a trava do
// campanhas-enviar recusa, para nao sair pelo numero errado). Quem "deveria" atender esta no ERP
// (rep_carteira.assist_idcrm = ID do usuario da assistente no GHL), entao aqui a gente leva essa
// informacao para o CRM UMA vez, por rep, em vez de trocar o dono a cada mensagem.
//
// NAO e o workflow antigo do CRM: aquele reescrevia o proprietario a cada envio, conforme a
// instancia, e por isso o contato sumia da vista da outra assistente. Aqui o dono e definido uma vez
// e so para quem esta SEM dono utilizavel — quem ja tem instancia ativa nao e tocado, inclusive os
// divergentes (ali o certo e a gestao decidir, nao o codigo sobrescrever).
//
// POST {}                  -> so relata (modo seco por padrao)
// POST { aplicar:true }    -> reatribui os contatos que existem
// POST { aplicar:true, criar:true } -> tambem cria no CRM o contato do rep que nao existe la
//
// Antes de criar, procura de todas as formas que a gente conhece (telefone em variantes, com e sem o
// 9o digito, e por e-mail): o JOSE ALVES esta no Sankhya sem o 9 e no CRM com o 9, e um `contains_set`
// por telefone nao acha. Criar sem essa busca geraria contato duplicado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const nf = (s: any) => digits(s).replace(/^0+/, "").replace(/^55/, "");
function e164(fone: any): string { const d = digits(fone); if (!d) return ""; if (d.length <= 11) return "+55" + d; return "+" + d; }
// celular brasileiro tem 11 digitos (DDD + 9 + 8). O Sankhya guarda muito numero antigo com 10.
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
function ghl(tok: string, method: string, path: string, body?: any) {
  return fetch(API + path, { method, headers: { "Authorization": "Bearer " + Deno.env.get("GHL_TOKEN"), "Version": "2021-07-28", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA }, body: body ? JSON.stringify(body) : undefined });
}
async function buscarUm(g: EmpGhl, q: string): Promise<any> {
  try { const r = await ghl(g.tok, "GET", `/contacts/?locationId=${g.loc}&query=${encodeURIComponent(q)}&limit=1`); if (!r.ok) return null; const d = await r.json(); return (d?.contacts || [])[0] || null; } catch { return null; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const aplicar = b.aplicar === true;
    const criar = b.criar === true;
    // empresa primeiro: sem location resolvida esta funcao nao fala com o GHL.
    const empId = String(b.empresa || "nitron");
    const g = await empresaGhl(empId);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());

    // filtra por empresa: instancia_ghl passou a ter dono, e sem isso uma instancia da Teak
    // seria aceita como instancia valida para um representante da Nitron.
    const { data: instRows, error: eI } = await sb.from("instancia_ghl").select("instancia,usuario_ghl_id").eq("ativa", true).eq("empresa", empId); if (eI) throw eI;
    const porUsuario: Record<string, string> = {}; const idDe: Record<string, string> = {};
    (instRows || []).forEach((x: any) => { if (x.usuario_ghl_id) { porUsuario[String(x.usuario_ghl_id)] = String(x.instancia); idDe[String(x.instancia)] = String(x.usuario_ghl_id); } });

    // quem esta sem instancia hoje, e para quem o organograma aponta
    const { data: alvo, error: eA } = await sb.from("rep_instancia").select("codvend,rep,instancia_erp,instancia_crm").is("instancia_crm", null).not("instancia_erp", "is", null); if (eA) throw eA;
    const cvs = (alvo || []).map((r: any) => Number(r.codvend));
    if (!cvs.length) return j({ ok: true, nada_a_fazer: true, reps: 0 });

    const { data: rcs, error: eR } = await sb.from("rep_carteira").select("codvend,apelido,codparc,celular,email").in("codvend", cvs); if (eR) throw eR;
    const rcBy: Record<string, any> = {}; (rcs || []).forEach((r: any) => rcBy[String(r.codvend)] = r);
    const { data: extras } = await sb.from("rep_contato_extra").select("codvend,tipo,valor").eq("ativo", true).in("codvend", cvs);
    const exTel: Record<string, string[]> = {}; const exMail: Record<string, string[]> = {};
    (extras || []).forEach((e: any) => { const m = e.tipo === "email" ? exMail : exTel; (m[e.codvend] = m[e.codvend] || []).push(e.valor); });

    const out: any[] = [];
    for (const a of (alvo || [])) {
      const cv = String(a.codvend); const rc = rcBy[cv] || {};
      const inst = String(a.instancia_erp); const uid = idDe[inst];
      const linha: any = { codvend: Number(cv), rep: a.rep, instancia: inst };
      if (!uid) { out.push({ ...linha, acao: "erro", motivo: "instancia sem usuario_ghl_id no cadastro" }); continue; }

      const fones = [rc.celular].concat(exTel[cv] || []).flatMap((f: any) => variantes(f));
      const mails = [rc.email].concat(exMail[cv] || []).map((x: any) => String(x || "").trim()).filter(Boolean);

      // 1) achar o contato: telefone em variantes, depois e-mail
      let c: any = null; let achadoPor = "";
      for (const f of Array.from(new Set(fones))) { c = await buscarUm(g, e164(f)); if (c?.id) { achadoPor = "telefone " + e164(f); break; } c = await buscarUm(g, f); if (c?.id) { achadoPor = "telefone " + f; break; } }
      if (!c?.id) { for (const m of Array.from(new Set(mails))) { c = await buscarUm(g, m); if (c?.id) { achadoPor = "email " + m; break; } } }

      if (c?.id) {
        const donoAtual = String(c.assignedTo || "");
        const instAtual = donoAtual ? (porUsuario[donoAtual] || "") : "";
        if (instAtual) { out.push({ ...linha, acao: "ja_tem_dono", contato: c.id, dono_atual: instAtual, achado_por: achadoPor }); continue; }
        if (!aplicar) { out.push({ ...linha, acao: "reatribuiria", contato: c.id, dono_antes: donoAtual || null, achado_por: achadoPor }); continue; }
        const r = await ghl(g.tok, "PUT", `/contacts/${c.id}`, { assignedTo: uid });
        const okp = r.ok; const corpo = okp ? "" : (await r.text()).slice(0, 200);
        out.push({ ...linha, acao: okp ? "reatribuido" : "erro", contato: c.id, dono_antes: donoAtual || null, achado_por: achadoPor, motivo: okp ? undefined : ("PUT " + r.status + ": " + corpo) });
        continue;
      }

      // 2) nao existe no CRM
      const fone1 = (rc.celular && variantes(rc.celular)[0]) || null;
      if (!fone1 && !mails.length) { out.push({ ...linha, acao: "sem_contato_no_sankhya" }); continue; }
      if (!criar) { out.push({ ...linha, acao: "criaria", fone: fone1 ? e164(fone1) : null, email: mails[0] || null }); continue; }
      const campos: any = { locationId: g.loc, firstName: String(rc.apelido || ("Rep " + cv)), assignedTo: uid };
      if (fone1) campos.phone = e164(fone1);
      if (mails[0]) campos.email = mails[0];
      const r = await ghl(g.tok, "POST", "/contacts/upsert", campos);
      const d = await r.json().catch(() => ({}));
      const id = d?.contact?.id || null;
      out.push({ ...linha, acao: id ? "criado" : "erro", contato: id, fone: campos.phone || null, email: campos.email || null, motivo: id ? undefined : ("upsert " + r.status) });
    }

    const contagem: Record<string, number> = {};
    out.forEach((o) => { contagem[o.acao] = (contagem[o.acao] || 0) + 1; });
    return j({ ok: true, aplicar, criar, reps: out.length, contagem, itens: out });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
