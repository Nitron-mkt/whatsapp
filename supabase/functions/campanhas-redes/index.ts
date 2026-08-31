// campanhas-redes (v7) — CNPJ EM TODA LOJA DO ROTEIRO. Pedido do gestor: por nome fantasia ou razao
// social o rep nao acha o cliente no sistema dele; pelo CNPJ acha. Numa rede isso e o caso extremo —
// as lojas tem nome quase igual ("TUBARAO 61", "TUBARAO 63"), e sem o documento o rep nao sabe qual
// loja e qual. Cada linha traz o CNPJ DAQUELA loja; nao ha sufixo de rede porque aqui cada linha JA
// e uma loja, nunca um grupo consolidado.
// campanhas-redes (v6) — PROMOCAO DE REDES. GET lista redes. ?rede=<gkey>: store-check por DISTANCIA REAL (haversine via cep_geo, teto MAX_KM/dia), ordem NN, msg detalhada+numerada+espacada + contatos. Fallback regiao de CEP p/ sem coord.
// v5: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa),
//     passa a ler roteiro_cliente_apto (fora quem tem pendencia ou esta com giro em dia — mesma regra do roteiro por prioridade)
//     e a mensagem ao representante ganhou o tom de parceria (sugestao e apoio, nunca tarefa).
// v6: o rotulo de quem tem menos de 50 dias deixa de dizer "em dia" — contradizia a regra de nao incluir cliente com giro
//     em dia (o corte oficial e situacao<>'Em dia' na roteiro_cliente_apto, que usa o giro do cliente, nao 50 dias fixos).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };
const brl = (v: any) => "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR");
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const cep8 = (c: any) => digits(c).slice(0, 8);
/* CNPJ crus de 14 digitos do Sankhya. Ha cadastro com CPF (11) e um cliente do Uruguai com RUT de
   12: o rotulo muda, porque chamar CPF de CNPJ e erro visivel para quem le. */
function fmtDoc(d: any) {
  const x = digits(d);
  if (x.length === 14) return "CNPJ " + x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (x.length === 11) return "CPF " + x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return x ? ("doc " + x) : "";
}
function fmtCep(c: any) { const d = digits(c); return d.length === 8 ? d.slice(0, 5) + "-" + d.slice(5) : (c || ""); }
function haversine(a: any, b: any) { const R = 6371, tr = (x: number) => x * Math.PI / 180; const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng); const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
const cep3 = (cepn: number) => Math.floor((cepn || 0) / 100000);
function dist(a: any, b: any) { if (a.lat != null && b.lat != null) return haversine(a, b); return Math.abs(cep3(a.cepn) - cep3(b.cepn)) <= CEP3_JANELA ? 70 : 9999; }
function gat(c: any) { return (c.dias >= 50 && c.dias <= 180) || Number(c.clube_saldo) > 0; }
function posic(c: any) { const d = Number(c.dias) || 0; if (d > 180) return "giro VENCIDO (" + d + "d)"; if (d >= 50) return "giro vencendo (" + d + "d)"; return "compra recente (" + d + "d)"; }
function motivoLoja(c: any) { const p: string[] = [posic(c)]; if (Number(c.clube_saldo) > 0) p.push("Clube " + brl(c.clube_saldo) + " disponivel"); p.push(brl(c.fat12m) + "/ano"); return p.join(" · "); }
function pushCanal(out: any[], seen: any, canal: string, valor: any, funcao: string, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao, origem }); }
// roteiro_cliente_apto ja exclui inadimplente, titulo vencido e quem esta com giro em dia
async function allRoteiro(sb: any) { const rows: any[] = []; let from = 0; while (true) { const { data, error } = await sb.from("roteiro_cliente_apto").select("codparc,codparcmatriz,codvend,rep,nome,cnpj,cep,cidade,uf,fat12m,dias,clube_saldo").range(from, from + 999); if (error) throw error; (data || []).forEach((r: any) => rows.push(r)); if (!data || data.length < 1000) break; from += 1000; } return rows; }
async function loadGeo(sb: any): Promise<Map<string, any>> { const m = new Map(); let f = 0; while (true) { const { data, error } = await sb.from("cep_geo").select("cep,lat,lng").not("lat", "is", null).range(f, f + 999); if (error) throw error; (data || []).forEach((r: any) => m.set(String(r.cep), { lat: r.lat, lng: r.lng })); if (!data || data.length < 1000) break; f += 1000; } return m; }
function rota(grupo: any[]) { if (grupo.length <= 2) return grupo; const out = [grupo[0]]; const rest = grupo.slice(1); while (rest.length) { const last = out[out.length - 1]; let bi = 0, bd = Infinity; rest.forEach((n: any, i: number) => { const d = dist(last, n); if (d < bd) { bd = d; bi = i; } }); out.push(rest.splice(bi, 1)[0]); } return out; }
const VIS_DIA = 6; const MAX_DIAS = 25; const CEP3_JANELA = 20; const MAX_KM = 150;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams; const redeParam = p.get("rede");
    const { data: ig, error: eIg } = await sb.from("parc_intragrupo").select("codparc"); if (eIg) throw eIg;
    const intra = new Set((ig || []).map((x: any) => Number(x.codparc)));
    const rows = (await allRoteiro(sb)).filter((r: any) => !intra.has(Number(r.codparc)));
    const by: Record<string, any[]> = {}; rows.forEach((c: any) => { const m = Number(c.codparcmatriz) || 0; if (!(m > 0 && m !== Number(c.codparc))) return; const k = String(m); (by[k] = by[k] || []).push(c); });

    if (!redeParam) {
      const redes = Object.keys(by).map((k) => { const lojas = by[k]; const sede = lojas.find((x: any) => Number(x.codparc) === Number(k)) || lojas.slice().sort((a: any, b: any) => Number(b.fat12m) - Number(a.fat12m))[0]; const cidades = new Set(lojas.map((x: any) => x.cidade).filter(Boolean)); const reps = new Set(lojas.map((x: any) => x.rep).filter(Boolean)); return { gkey: Number(k), nome: sede.nome, lojas: lojas.length, cidades: cidades.size, fat: Math.round(lojas.reduce((a: number, b: any) => a + (Number(b.fat12m) || 0), 0)), reps: Array.from(reps).slice(0, 3).join(", "), n_reps: reps.size, prioritarias: lojas.filter(gat).length }; }).filter((r: any) => r.lojas >= 2).sort((a: any, b: any) => b.fat - a.fat);
      return j({ total: redes.length, redes });
    }

    const geo = await loadGeo(sb);
    let lojas = (by[String(Number(redeParam))] || []).map((c: any) => { const g = geo.get(cep8(c.cep)); return { ...c, cepn: parseInt(cep8(c.cep)) || 0, lat: g ? g.lat : null, lng: g ? g.lng : null }; });
    if (!lojas.length) return j({ erro: "rede sem lojas" }, 404);
    const sede = lojas.find((x: any) => Number(x.codparc) === Number(redeParam)) || lojas.slice().sort((a: any, b: any) => Number(b.fat12m) - Number(a.fat12m))[0];
    let rest = lojas.slice();
    const dias: any[] = [];
    while (rest.length && dias.length < MAX_DIAS) {
      const seed = rest.slice().sort((a: any, b: any) => Number(b.fat12m) - Number(a.fat12m))[0];
      const cand = rest.filter((l: any) => l.codparc !== seed.codparc && dist(seed, l) <= MAX_KM).sort((a: any, b: any) => dist(seed, a) - dist(seed, b)).slice(0, VIS_DIA - 1);
      const grupo = rota([seed, ...cand]);
      const ids = new Set(grupo.map((x: any) => x.codparc)); rest = rest.filter((x: any) => !ids.has(x.codparc));
      dias.push({ dia: dias.length + 1, cidade_base: seed.cidade, lojas: grupo.map((c: any, i: number) => ({ ordem: i + 1, codparc: c.codparc, nome: c.nome, cnpj: c.cnpj || null, doc: fmtDoc(c.cnpj), cidade: c.cidade, uf: c.uf, cep: fmtCep(c.cep), km: (c.lat != null && seed.lat != null) ? Math.round(dist(seed, c)) : null, fat: Math.round(c.fat12m), fat_fmt: brl(c.fat12m), dias: c.dias, posicionamento: posic(c), motivo: motivoLoja(c), prioritaria: gat(c) })) });
    }
    const { data: sr, error: eSr } = await sb.from("snap_rep").select("*").eq("codvend", sede.codvend).maybeSingle(); if (eSr) throw eSr;
    const contatos: any[] = []; const seen: any = {};
    if (sr) { pushCanal(contatos, seen, "whatsapp", sr.celular, "Rep", "Sankhya"); pushCanal(contatos, seen, "whatsapp", sr.fone_parc, "Rep", "Sankhya"); pushCanal(contatos, seen, "email", sr.email, "Rep", "Sankhya"); pushCanal(contatos, seen, "email", sr.email_crm, "Rep", "CRM"); }
    const { data: sc, error: eSc } = await sb.from("snap_contato").select("*").eq("codparc", sede.codparc); if (eSc) throw eSc;
    (sc || []).forEach((ct: any) => { pushCanal(contatos, seen, "whatsapp", ct.fone, ct.funcao || "Central", "Sankhya"); pushCanal(contatos, seen, "email", ct.email, ct.funcao || "Central", "Sankhya"); });
    const fatTot = lojas.reduce((a: number, b: any) => a + (Number(b.fat12m) || 0), 0);
    const primeiro = String(sede.rep || "").split(" ")[0];
    let msg = "Oi " + (primeiro || "tudo bem") + ", tudo bem?\n\nSeparamos as lojas da rede " + sede.nome + " que podem fazer sentido para um store-check, agrupadas pela proximidade entre elas (" + lojas.length + " lojas · " + brl(fatTot) + "/ano, ate " + MAX_KM + "km por dia). E uma sugestao para facilitar o caminho; sinta-se livre para ajustar do jeito que funciona melhor pra voce.\n";
    /* CNPJ em linha propria, logo abaixo do nome: numa rede os nomes se repetem quase iguais, e e o
       documento que diz ao rep qual loja e qual. */
    dias.forEach((d: any) => { msg += "\n━━━ DIA " + d.dia + " · regiao de " + (d.cidade_base || "") + " (" + d.lojas.length + " lojas) ━━━\n"; d.lojas.forEach((l: any) => { msg += "\n" + l.ordem + ") " + (l.prioritaria ? "⭐ " : "") + l.nome + "\n" + (l.doc ? ("   " + l.doc + "\n") : "") + "   " + (l.cidade || "") + " · CEP " + l.cep + (l.km != null ? (" · ~" + l.km + "km") : "") + " · " + l.motivo + "\n"; }); });
    msg += "\nO que podemos fazer para te ajudar nesse roteiro? Se tiver alguma loja em que voce queira um apoio antes da visita, ou alguma informacao que a gente possa levantar (historico de compra, mix, condicao comercial), me fala que eu preparo.";
    return j({ gkey: Number(redeParam), nome: sede.nome, total_lojas: lojas.length, fat: Math.round(fatTot), codvend: sede.codvend, rep: sede.rep, instancia: sr?.assistente || null, contatos, dias, mensagem: msg });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
