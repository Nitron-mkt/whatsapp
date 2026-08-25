// campanhas-comunicado (v4) — apoio a campanha rep_comunicado: recado livre da gestao para a rede
// de representantes. NAO tem gatilho de dado e NAO usa IA: o texto e escrito na tela e muda a cada
// envio, entao aqui so devolvemos a rede com os contatos de cada rep e guardamos os comunicados
// anteriores para reuso.
//
// GET  -> { reps:[...], salvos:[...], cfg:{...}, crm_lido, atualizado }
// POST { titulo, texto_wpp, assunto, texto_email, id? } -> grava/atualiza um comunicado
// POST { apagar:<id> }                                  -> remove um comunicado
//
// v4: a rede vem de rep_carteira, nao de snap_rep. O snap_rep e montado a partir de quem tem
// carteira e cobria 67 reps; rep_carteira tem TODOS os 98 ativos do ERP (TIPVEND='R', ATIVO='S'),
// entao o comunicado passa a alcancar tambem o representante novo que ainda nao tem cliente.
// E melhor ainda: rep_carteira traz `assist_idcrm` = AD_IDCRM do gerente no Sankhya, que e o ID DO
// USUARIO DA ASSISTENTE NO GHL. Ou seja, "quem atende" vem do ERP por ID, sem casar nome de pessoa
// (era isso que fazia "Monica" sem acento nao amarrar, e o que quebrou quando a Beatriz saiu).
//
// Duas instancias por rep, de proposito:
//   instancia_erp -> quem DEVERIA atender, pelo organograma do Sankhya (assist_idcrm)
//   instancia_crm -> quem de fato manda, porque o ZaptosWPP roteia pelo usuario remetente, e numa
//                    mensagem de API o remetente e o assignedTo do contato no GHL
// A tela envia pela do CRM e avisa quando as duas discordam — divergir significa que o CRM precisa
// ser ajustado, nao que o codigo deva ignorar a realidade.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const nf = (s: any) => digits(s).replace(/^0+/, "").replace(/^55/, "");
function e164(fone: any): string { const d = digits(fone); if (!d) return ""; if (d.length <= 11) return "+55" + d; return "+" + d; }

const API = "https://services.leadconnectorhq.com";
const LOC = "rZ8y7lzqV7fzxsartaX2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
// Uma unica busca no GHL com todos os telefones dos reps; devolve fone normalizado -> assignedTo.
async function donosNoCRM(fones: string[]): Promise<Record<string, string> | null> {
  const tok = Deno.env.get("GHL_TOKEN"); if (!tok || !fones.length) return null;
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < fones.length; i += 90) {
      const r = await fetch(API + "/contacts/search", {
        method: "POST",
        headers: { Authorization: "Bearer " + tok, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
        body: JSON.stringify({ locationId: LOC, pageLimit: 100, filters: [{ field: "phone", operator: "contains_set", value: fones.slice(i, i + 90) }] }),
      });
      if (!r.ok) return null;
      const d = await r.json().catch(() => ({}));
      (d?.contacts || []).forEach((c: any) => { const k = nf(c?.phone); if (k && c?.assignedTo) out[k] = String(c.assignedTo); });
    }
    return out;
  } catch { return null; }
}

type Ct = { valor: string; rotulo: string | null };
function juntar(lista: (Ct | null)[], chave: (v: string) => string): Ct[] {
  const seen = new Set<string>(), out: Ct[] = [];
  for (const c of lista) { if (!c) continue; const v = String(c.valor || "").trim(); const k = chave(v); if (!k || seen.has(k)) continue; seen.add(k); out.push({ valor: v, rotulo: c.rotulo }); }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = srvKey();
    if (!key) return j({ erro: "sem chave de servico (secret SRV_JWT ausente)" }, 500);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);

    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (b.apagar) {
        const { error } = await sb.from("comunicado").delete().eq("id", Number(b.apagar)); if (error) throw error;
        return j({ ok: true, apagado: Number(b.apagar) });
      }
      const titulo = String(b.titulo || "").trim();
      if (!titulo) return j({ erro: "sem titulo" }, 400);
      const linha = { titulo, texto_wpp: String(b.texto_wpp || ""), assunto: String(b.assunto || ""), texto_email: String(b.texto_email || ""), atualizado: new Date().toISOString() };
      if (b.id) {
        const { data, error } = await sb.from("comunicado").update(linha).eq("id", Number(b.id)).select().maybeSingle(); if (error) throw error;
        return j({ ok: true, salvo: data });
      }
      const { data, error } = await sb.from("comunicado").insert(linha).select().maybeSingle(); if (error) throw error;
      return j({ ok: true, salvo: data });
    }

    // ---- a rede inteira, do ERP ----
    const { data: rcs, error: eRc } = await sb.from("rep_carteira").select("codvend,apelido,codparc,assist_idcrm,celular,email,clientes,carteira"); if (eRc) throw eRc;
    if (!rcs || !rcs.length) return j({ erro: "rep_carteira vazia — rode o rep-refresh antes" }, 500);

    const { data: instRows, error: eI } = await sb.from("instancia_ghl").select("instancia,usuario_ghl_id").eq("ativa", true); if (eI) throw eI;
    const porUsuario: Record<string, string> = {};
    (instRows || []).forEach((x: any) => { if (x.usuario_ghl_id) porUsuario[String(x.usuario_ghl_id)] = String(x.instancia); });

    const { data: extras, error: eE } = await sb.from("rep_contato_extra").select("codvend,tipo,valor,rotulo").eq("ativo", true); if (eE) throw eE;
    const exMap: Record<string, any[]> = {}; (extras || []).forEach((e: any) => { (exMap[e.codvend] = exMap[e.codvend] || []).push(e); });

    // contatos da base do parceiro do proprio rep (o codparc dele)
    const cps = Array.from(new Set((rcs || []).map((r: any) => Number(r.codparc)).filter((x: number) => x > 0)));
    const baseCp: Record<string, Ct[]> = {}; const baseCpMail: Record<string, Ct[]> = {};
    for (let i = 0; i < cps.length; i += 300) {
      const ch = cps.slice(i, i + 300);
      const { data: sc, error: e1 } = await sb.from("snap_contato").select("codparc,fone,email").in("codparc", ch); if (e1) throw e1;
      (sc || []).forEach((c: any) => {
        if (c.fone) (baseCp[c.codparc] = baseCp[c.codparc] || []).push({ valor: c.fone, rotulo: "Sankhya" });
        if (c.email) (baseCpMail[c.codparc] = baseCpMail[c.codparc] || []).push({ valor: c.email, rotulo: "Sankhya" });
      });
      const { data: gc, error: e2 } = await sb.from("ghl_contato").select("codparc,ghl_id,fone,email").in("codparc", ch); if (e2) throw e2;
      (gc || []).forEach((c: any) => {
        const gid = String(c.ghl_id || ""); const rot = gid.includes("#biz") ? "CRM·empresa" : (gid.includes("#r") ? "CRM·casado" : "CRM");
        if (c.fone) (baseCp[c.codparc] = baseCp[c.codparc] || []).push({ valor: c.fone, rotulo: rot });
        if (c.email) (baseCpMail[c.codparc] = baseCpMail[c.codparc] || []).push({ valor: c.email, rotulo: rot });
      });
    }

    let reps = (rcs || []).map((r: any) => {
      const cv = String(r.codvend); const cp = String(r.codparc || 0);
      const ex = exMap[cv] || [];
      const telefones = juntar(
        ([{ valor: r.celular, rotulo: "Sankhya" }] as any[])
          .concat(ex.filter((e: any) => e.tipo === "telefone").map((e: any) => ({ valor: e.valor, rotulo: e.rotulo || "manual" })))
          .concat(baseCp[cp] || []),
        nf);
      const emails = juntar(
        ([{ valor: r.email, rotulo: "Sankhya" }] as any[])
          .concat(ex.filter((e: any) => e.tipo === "email").map((e: any) => ({ valor: e.valor, rotulo: e.rotulo || "manual" })))
          .concat(baseCpMail[cp] || []),
        (v) => v.toLowerCase());
      return {
        codvend: Number(r.codvend), nome: String(r.apelido || ("Rep " + r.codvend)),
        instancia_erp: (r.assist_idcrm && porUsuario[String(r.assist_idcrm)]) || null,
        instancia_crm: null as string | null,
        clientes: Number(r.clientes) || 0, carteira: Number(r.carteira) || 0,
        telefones, emails,
      };
    }).sort((a: any, b: any) => a.nome.localeCompare(b.nome, "pt-BR"));

    // instancia de verdade: a assistente proprietaria do contato no CRM
    const fones: string[] = [];
    reps.forEach((r: any) => (r.telefones || []).forEach((t: any) => { const v = e164(t.valor); if (v) fones.push(v); }));
    const donos = await donosNoCRM(Array.from(new Set(fones)));
    if (donos) {
      reps = reps.map((r: any) => {
        let inst: string | null = null;
        for (const t of (r.telefones || [])) { const dono = donos[nf(t.valor)]; if (dono && porUsuario[dono]) { inst = porUsuario[dono]; break; } }
        return { ...r, instancia_crm: inst };
      });
    }

    const { data: salvos, error: eS } = await sb.from("comunicado").select("*").order("atualizado", { ascending: false }).limit(50); if (eS) throw eS;
    const { data: cfg } = await sb.from("fila_config").select("wpp_intervalo_seg,email_lote,wpp_ativo,email_ativo").eq("id", 1).maybeSingle();
    const { data: meta } = await sb.from("cache_meta").select("atualizado").eq("chave", "snapshot").maybeSingle();
    return j({ reps, salvos: salvos || [], cfg: cfg || null, crm_lido: !!donos, atualizado: meta?.atualizado || null });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
