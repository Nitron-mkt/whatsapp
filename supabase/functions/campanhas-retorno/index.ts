// campanhas-retorno (v4) — entregas que voltaram CONSOLIDADAS POR MATRIZ (parc_matriz): 1 card por rede com todas as NFs das lojas. ?grupo=<matriz>&publico=cliente|rep manda p/ UM contato central listando todas as entregas. ?msg=nunota (single) mantido.
// v4: a instancia vem da view rep_instancia (proprietario do contato no CRM, com o organograma do
// Sankhya por ID como fallback), nao de snap_rep.assistente casado por nome.
// v3: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa) + tom de parceria com o representante.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const brl = (v: any) => "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR");
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const MODELO = "claude-haiku-4-5-20251001";
const lj = (n: any) => (Number(n) > 1 ? ` (${n} lojas)` : "");
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };
async function matrizMap(sb: any): Promise<Map<number, number>> { const m = new Map(); let f = 0; while (true) { const { data } = await sb.from("parc_matriz").select("codparc,matriz").range(f, f + 999); (data || []).forEach((r: any) => m.set(Number(r.codparc), Number(r.matriz))); if (!data || data.length < 1000) break; f += 1000; } return m; }
const gk = (mtz: Map<number, number>, cp: any) => mtz.get(Number(cp)) || Number(cp);
async function claude(sys: string, user: string): Promise<string | null> { const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null; try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODELO, max_tokens: 600, temperature: 0.7, system: sys, messages: [{ role: "user", content: user }] }) }); if (!r.ok) return null; return (await r.json())?.content?.[0]?.text || null; } catch { return null; } }
function pushCanal(out: any[], seen: any, canal: string, valor: any, funcao: string, origem: string) { const v = String(valor || "").trim(); if (!v) return; const k = canal + "|" + (canal === "email" ? v.toLowerCase() : digits(v).replace(/^0+/, "").replace(/^55/, "")); if (seen[k]) return; seen[k] = 1; out.push({ canal, valor: v, funcao, origem }); }
// .eq(empresa): esta funcao e da Nitron e snap_contato passou a ter mais de uma empresa. CODPARC e
// GLOBAL no Sankhya — o 1 e o 78701, por exemplo, existem na Nitron E na Teak.
async function contatosRede(sb: any, memArr: number[], out: any[], seen: any) { const { data: sc } = await sb.from("snap_contato").select("*").eq("empresa", "nitron").in("codparc", memArr); const { data: gc } = await sb.from("ghl_contato").select("nome,fone,email").in("codparc", memArr); (sc || []).forEach((ct: any) => { pushCanal(out, seen, "whatsapp", ct.fone, ct.funcao || "Contato", "Sankhya"); pushCanal(out, seen, "email", ct.email, ct.funcao || "Contato", "Sankhya"); }); (gc || []).forEach((g: any) => { pushCanal(out, seen, "whatsapp", g.fone, "CRM", "CRM"); pushCanal(out, seen, "email", g.email, "CRM", "CRM"); }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const p = new URL(req.url).searchParams; const msgNota = p.get("msg"); const grupoCod = p.get("grupo");
    const mtz = await matrizMap(sb);

    if (grupoCod || msgNota) {
      const publico = p.get("publico") || "cliente";
      const { data: all, error: eAll } = await sb.from("retorno_pedido").select("*").limit(50000);
      if (eAll) throw eAll;
      let g: number; let membros: any[];
      if (grupoCod) { g = Number(grupoCod); membros = (all || []).filter((c: any) => gk(mtz, c.codparc) === g); }
      else { const one = (all || []).find((c: any) => Number(c.nunota) === Number(msgNota)); if (!one) return j({ erro: "retorno nao encontrado" }, 404); g = gk(mtz, one.codparc); membros = (all || []).filter((c: any) => gk(mtz, c.codparc) === g); }
      if (!membros.length) return j({ erro: "grupo sem retorno" }, 404);
      const sede = membros.find((x: any) => Number(x.codparc) === g) || membros.slice().sort((a: any, b: any) => Number(b.valor) - Number(a.valor))[0];
      const lojasN = new Set(membros.map((m: any) => Number(m.codparc))).size;
      const memArr = Array.from(new Set(membros.map((m: any) => Number(m.codparc))));
      const valTot = membros.reduce((a: number, b: any) => a + (Number(b.valor) || 0), 0);
      const notas = membros.slice().sort((a: any, b: any) => Number(b.valor) - Number(a.valor)).map((c: any) => ({ nunota: c.nunota, loja: c.cliente, valor: Math.round(c.valor), valor_fmt: brl(c.valor), motivo: c.motivo, data: c.data_retorno }));
      const bd = notas.map((n: any) => `• ${n.loja} — NF ${n.nunota} (${n.data || ""}) ${n.valor_fmt}${n.motivo ? " · " + n.motivo : ""}`);
      let repRow: any = null; if (sede.codvend != null) { const { data: rr } = await sb.from("snap_rep").select("*").eq("empresa", "nitron").eq("codvend", sede.codvend).maybeSingle(); repRow = rr; }
      // A instancia vem da view rep_instancia (proprietario no CRM, com o organograma do Sankhya por
      // ID como fallback). snap_rep.assistente e nome casado por nome do organograma: dizia quem
      // DEVERIA atender, nao por qual numero a mensagem sai.
      let riRow: any = null; if (sede.codvend != null) { const { data: ri } = await sb.from("rep_instancia").select("instancia,instancia_erp,divergente").eq("codvend", sede.codvend).maybeSingle(); riRow = ri; }
      const instancia = riRow?.instancia || null;
      const out: any[] = []; const seen: any = {}; let aviso: string | null = null;
      if (publico === "cliente") { await contatosRede(sb, memArr, out, seen); if (!out.length) aviso = "rede sem contato cadastrado"; }
      else { if (!repRow) aviso = "rep sem contato no snapshot"; else { pushCanal(out, seen, "whatsapp", repRow.celular, "Rep", "Sankhya"); pushCanal(out, seen, "whatsapp", repRow.fone_parc, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email, "Rep", "Sankhya"); pushCanal(out, seen, "email", repRow.email_crm, "Rep", "CRM"); } }
      const rede = lojasN > 1;
      const nomeGrupo = String(sede.cliente) + lj(lojasN);
      const ctx = `${rede ? "Rede" : "Cliente"} ${nomeGrupo} (matriz cod ${g}). ${membros.length} entrega(s) que VOLTARAM (nao entregues), total ${brl(valTot)}${rede ? (", em " + lojasN + " lojas") : ""}. Detalhe:\n${bd.join("\n")}. Representante ${sede.rep}.`;
      let sys = "";
      if (publico === "cliente") sys = `Voce e o comercial/logistica da Nitronplast. ${rede ? membros.length + " entregas da REDE " + sede.cliente + " voltaram" : "Uma entrega voltou"} sem ser entregue. Escreva UMA mensagem CORDIAL ao contato central ${rede ? "da rede" : "do cliente"}: avise com transparencia, peca desculpas breves e combine a REPROGRAMACAO de ${rede ? "todas as entregas (pode listar as NFs)" : "a entrega"} — pergunte o melhor dia/janela. NAO culpe o cliente. Curta, pt-BR. So a mensagem.`;
      else sys = `Voce fala em nome da Nitronplast COM o representante, que e PARCEIRO nosso. TOM (obrigatorio): comece cumprimentando pelo primeiro nome dele e perguntando como ele esta ("Oi ${sede.rep}, tudo bem?"). Avise que ${rede ? membros.length + " entregas da rede " + sede.cliente + " voltaram" : "uma entrega de um cliente dele voltou"} (detalhe no contexto) — isso e um aviso para ele NAO ser pego de surpresa pelo cliente, e nao uma tarefa nem uma pendencia dele. Diga que a logistica ja esta olhando e que podemos falar com o contato do cliente junto com ele ou no lugar dele, como ele preferir. TERMINE oferecendo ajuda concreta e com uma pergunta aberta, no espirito de "o que podemos fazer para te ajudar a destravar isso?". PROIBIDO cobrar, exigir, impor prazo ao rep, escrever "peca que", "voce precisa", "e importante que voce", falar de meta ou insinuar que ele esta atrasado. Curta, pt-BR. So a mensagem.`;
      const fallbackRep = `Oi ${String(sede.rep || "").split(" ")[0] || "tudo bem"}, tudo bem?\n\nSo passando um aviso para voce nao ser pego de surpresa: ${membros.length} entrega(s) de ${nomeGrupo} voltaram sem ser entregues (${brl(valTot)}).\n\n${bd.join("\n")}\n\nA logistica ja esta olhando. Se voce preferir, a gente fala direto com o contato do cliente para reprogramar — ou vamos junto com voce, do jeito que funcionar melhor. O que podemos fazer para te ajudar a destravar isso?`;
      const fallback = publico === "rep" ? fallbackRep : "(nao foi possivel gerar)";
      const mensagem = (await claude(sys, "Contexto: " + ctx)) || fallback;
      return j({ codparc: g, nunota: sede.nunota, nome: nomeGrupo, lojas: lojasN, publico, instancia, instancia_erp: riRow?.instancia_erp || null, divergente: !!riRow?.divergente, contatos: out, aviso, mensagem, valor: brl(valTot), notas });
    }

    const { data, error } = await sb.from("retorno_pedido").select("*").limit(50000);
    if (error) throw error;
    const by: Record<string, any[]> = {}; (data || []).forEach((c: any) => { const g = gk(mtz, c.codparc); (by[g] = by[g] || []).push(c); });
    const grupos = Object.keys(by).map((g) => { const ms = by[g]; const lojasN = new Set(ms.map((x) => Number(x.codparc))).size; const sede = ms.find((x) => Number(x.codparc) === Number(g)) || ms.slice().sort((a, b) => Number(b.valor) - Number(a.valor))[0]; const valor = ms.reduce((a, b) => a + (Number(b.valor) || 0), 0); return { codparc: Number(g), nome: String(sede.cliente) + lj(lojasN), lojas: lojasN, rep: sede.rep, valor: Math.round(valor), valor_fmt: brl(valor), n: ms.length, notas: ms.slice().sort((a, b) => Number(b.valor) - Number(a.valor)).map((c) => ({ nunota: c.nunota, loja: c.cliente, valor_fmt: brl(c.valor), motivo: c.motivo, data: c.data_retorno })) }; }).sort((a, b) => b.valor - a.valor);
    return j({ total: grupos.length, total_notas: (data || []).length, total_valor: Math.round(grupos.reduce((a: number, b: any) => a + b.valor, 0)), grupos, itens: grupos });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
