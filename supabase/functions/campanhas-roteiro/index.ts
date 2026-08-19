// campanhas-roteiro (v8) — DISTANCIA REAL (haversine via cep_geo) com teto MAX_KM/dia; fallback regiao de CEP p/ sem coord. Agrupa por matriz. Ordem NN. Msg detalhada+numerada+espacada (com km). Exclui inad+intra.
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
function gatilho(n: any) { const giro = n.dias >= 50 && n.dias <= 180; const clube = Number(n.clube_saldo) > 0; return { giro, clube, any: giro || clube }; }
function prioridade(n: any) { const g = gatilho(n); return (Number(n.fat12m) || 0) * (g.any ? 1.6 : 1); }
function posic(n: any) { const d = Number(n.dias) || 0; if (d > 180) return "giro VENCIDO (" + d + "d sem comprar)"; if (d >= 50) return "giro vencendo (" + d + "d sem comprar)"; return "em dia (" + d + "d)"; }
function porque(n: any) { const p: string[] = [posic(n)]; if (Number(n.clube_saldo) > 0) p.push("Clube " + brl(n.clube_saldo) + " disponivel"); p.push(brl(n.fat12m) + "/ano na carteira"); if (n.lojas > 1) p.push("rede " + n.lojas + " lojas"); return p.join(" · "); }
function gkeyOf(c: any) { const m = Number(c.codparcmatriz) || 0; return (m > 0 && m !== Number(c.codparc)) ? m : Number(c.codparc); }
function agrupar(rows: any[]) {
  const by: Record<string, any[]> = {}; rows.forEach((c) => { const k = String(gkeyOf(c)); (by[k] = by[k] || []).push(c); });
  const nodes: any[] = [];
  for (const k in by) { const membros = by[k]; let sede = membros.find((m) => Number(m.codparc) === Number(k)); if (!sede) sede = membros.slice().sort((a, b) => Number(b.fat12m) - Number(a.fat12m))[0]; const fat = membros.reduce((a, b) => a + (Number(b.fat12m) || 0), 0); const clube = membros.reduce((a, b) => a + (Number(b.clube_saldo) || 0), 0); const dias = Math.min(...membros.map((m) => Number(m.dias) || 9999)); nodes.push({ codparc: sede.codparc, gkey: Number(k), nome: sede.nome, cep: sede.cep, cidade: sede.cidade, uf: sede.uf, codvend: sede.codvend, rep: sede.rep, fat12m: fat, dias, clube_saldo: clube, lojas: membros.length }); }
  return nodes;
}
function pushCanal(out: any[], seen: any, canal: string, valor: any, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao: "Rep", origem }); }
// ordena um grupo por vizinho-mais-proximo (NN) a partir do 1o
function rota(grupo: any[]) { if (grupo.length <= 2) return grupo; const out = [grupo[0]]; const rest = grupo.slice(1); while (rest.length) { const last = out[out.length - 1]; let bi = 0, bd = Infinity; rest.forEach((n: any, i: number) => { const d = dist(last, n); if (d < bd) { bd = d; bi = i; } }); out.push(rest.splice(bi, 1)[0]); } return out; }
const VIS_DIA = 6; const MAX_DIAS = 22; const CEP3_JANELA = 20; const MAX_KM = 150;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const p = new URL(req.url).searchParams; const repParam = p.get("rep");
    const intra = await intraSet(sb);
    if (!repParam) {
      const byRep: Record<string, any[]> = {}; let from = 0;
      while (true) { const { data } = await sb.from("roteiro_cliente").select("codparc,codparcmatriz,codvend,rep,fat12m,dias,clube_saldo").eq("inad", false).range(from, from + 999); (data || []).forEach((c: any) => { if (c.codvend == null || intra.has(Number(c.codparc))) return; (byRep[c.codvend] = byRep[c.codvend] || []).push(c); }); if (!data || data.length < 1000) break; from += 1000; }
      const reps = Object.keys(byRep).map((cv) => { const nodes = agrupar(byRep[cv]); const rep = (byRep[cv][0] || {}).rep; return { codvend: Number(cv), rep, clientes: nodes.length, prioritarios: nodes.filter((n) => gatilho(n).any).length, fat: Math.round(nodes.reduce((a, b) => a + (Number(b.fat12m) || 0), 0)) }; }).sort((a, b) => b.prioritarios - a.prioritarios || b.fat - a.fat);
      return j({ reps });
    }
    const rep = parseInt(repParam);
    const geo = await loadGeo(sb);
    const { data: cli } = await sb.from("roteiro_cliente").select("*").eq("codvend", rep).eq("inad", false);
    const rows = (cli || []).filter((c: any) => !intra.has(Number(c.codparc)));
    const nodes = agrupar(rows).filter((n: any) => digits(n.cep).length >= 7).map((n: any) => { const g = geo.get(cep8(n.cep)); return { ...n, cepn: parseInt(cep8(n.cep)) || 0, lat: g ? g.lat : null, lng: g ? g.lng : null, prio: prioridade(n) }; });
    const nome = rows[0]?.rep || ("Rep " + rep);
    const visitados = new Set<number>(); const dias: any[] = [];
    const restantes = () => nodes.filter((n: any) => !visitados.has(n.gkey));
    while (dias.length < MAX_DIAS) {
      const rest = restantes(); if (!rest.length) break;
      const anchor = rest.slice().sort((a: any, b: any) => b.prio - a.prio)[0];
      const cand = rest.filter((n: any) => n.gkey !== anchor.gkey && dist(anchor, n) <= MAX_KM).sort((a: any, b: any) => dist(anchor, a) - dist(anchor, b)).slice(0, VIS_DIA - 1);
      const grupo = rota([anchor, ...cand]);
      grupo.forEach((n: any) => visitados.add(n.gkey));
      dias.push({ dia: dias.length + 1, ancora: anchor.codparc, ancora_nome: anchor.nome, ancora_porque: porque(anchor), cidade_base: anchor.cidade, clientes: grupo.map((n: any, i: number) => ({ ordem: i + 1, codparc: n.codparc, nome: n.nome, cidade: n.cidade, cep: fmtCep(n.cep), uf: n.uf, km: (n.lat != null && anchor.lat != null) ? Math.round(dist(anchor, n)) : null, fat: Math.round(n.fat12m), fat_fmt: brl(n.fat12m), dias: n.dias, clube_saldo: Number(n.clube_saldo) || 0, lojas: n.lojas, posicionamento: posic(n), motivo: porque(n), ancora: n.gkey === anchor.gkey }) ) });
    }
    const { data: sr } = await sb.from("snap_rep").select("*").eq("codvend", rep).maybeSingle();
    const contatos: any[] = []; const seen: any = {};
    if (sr) { pushCanal(contatos, seen, "whatsapp", sr.celular, "Sankhya"); pushCanal(contatos, seen, "whatsapp", sr.fone_parc, "Sankhya"); pushCanal(contatos, seen, "email", sr.email, "Sankhya"); pushCanal(contatos, seen, "email", sr.email_crm, "CRM"); }
    let msg = "Oi " + nome + "! Segue seu ROTEIRO DE VISITAS priorizado — " + visitados.size + " contas em " + dias.length + " dias, agrupadas por PROXIMIDADE (ate " + MAX_KM + "km/dia). Comece pela ANCORA de cada dia:\n";
    dias.forEach((d: any) => { msg += "\n━━━ DIA " + d.dia + " · " + (d.cidade_base || "") + " e regiao (" + d.clientes.length + " visitas) ━━━\n🎯 Ancora: " + d.ancora_nome + " — " + d.ancora_porque + "\n\nSequencia de visita:\n"; d.clientes.forEach((c: any) => { msg += "\n" + c.ordem + ") " + (c.ancora ? "⭐ " : "") + c.nome + "\n   " + (c.cidade || "") + " · CEP " + c.cep + (c.km != null ? (" · ~" + c.km + "km da ancora") : "") + " · " + c.motivo + "\n"; }); });
    msg += "\nFoco: fechar as ancoras (giro vencendo / conta relevante / Clube). Qualquer duvida, chama!";
    return j({ rep: nome, codvend: rep, instancia: sr?.assistente || null, contatos, total: nodes.length, cobertos: visitados.size, dias, mensagem: msg });
  } catch (e) { return j({ erro: String(e) }, 500); }
});
