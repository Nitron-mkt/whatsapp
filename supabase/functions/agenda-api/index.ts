// agenda-api (v1) — API do painel Agenda de Campanhas. Somente leitura sobre o que ja existe
// (campanhas, fila_envio, disparos); escreve apenas em agenda_campanha, que e tabela nova.
//
// GET  ?semana=YYYY-MM-DD  -> semana (seg..dom) com realizado, planejado e sugestoes por dia
// GET  ?historico=1&de=&ate= -> series por campanha/dia, para metrificar
// POST {acao:"salvar"|"status"|"remover", ...}
//
// REALIZADO nunca e gravado: e sempre lido de fila_envio, para nao haver duas verdades.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = "America/Sao_Paulo";
const FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const diaLocal = (x: Date | string) => FMT.format(typeof x === "string" ? new Date(x) : x);
const dt = (iso: string) => new Date(iso + "T12:00:00Z");
const asIso = (x: Date) => x.toISOString().slice(0, 10);
const maisDias = (iso: string, n: number) => { const x = dt(iso); x.setUTCDate(x.getUTCDate() + n); return asIso(x); };
const isoDow = (iso: string) => { const w = dt(iso).getUTCDay(); return w === 0 ? 7 : w; };
const DOW = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
const DOW_LONGO = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const rotulo = (iso: string) => DOW[isoDow(iso) - 1];

async function paginar(q: (de: number, ate: number) => any) {
  const out: any[] = []; let f = 0;
  while (true) { const { data } = await q(f, f + 999); (data || []).forEach((r: any) => out.push(r)); if (!data || data.length < 1000) break; f += 1000; }
  return out;
}

// agrega fila_envio por (dia local, campanha)
function agregar(fila: any[]) {
  const m: Record<string, any> = {};
  for (const r of fila) {
    const dia = diaLocal(r.criado_em);
    const cod = r.campanha || "(sem campanha)";
    const k = dia + "|" + cod;
    const a = m[k] || (m[k] = { dia, campanha: cod, total: 0, enviado: 0, erro: 0, pendente: 0, whatsapp: 0, email: 0, _dest: new Set<string>() });
    a.total++;
    if (r.status === "enviado") a.enviado++; else if (r.status === "erro") a.erro++; else a.pendente++;
    if (r.canal === "email") a.email++; else a.whatsapp++;
    const d = (r.fone || r.email || "").trim(); if (d) a._dest.add(d.toLowerCase());
  }
  return Object.values(m).map((a: any) => { a.destinatarios = a._dest.size; delete a._dest; return a; });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const url = new URL(req.url); const p = url.searchParams;
    const hoje = diaLocal(new Date());

    // ---------------- POST: agenda ----------------
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const acao = b.acao || "salvar";
      if (acao === "salvar") {
        if (!b.data || !b.campanha_codigo) return j({ erro: "informe data e campanha_codigo" }, 400);
        const row = {
          data: b.data, campanha_codigo: b.campanha_codigo, publico: b.publico || "",
          canais: Array.isArray(b.canais) ? b.canais : [], origem: b.origem === "sugestao" ? "sugestao" : "humano",
          status: b.status || "planejado", objetivo: b.objetivo || null,
          alvo_estimado: b.alvo_estimado == null || b.alvo_estimado === "" ? null : Number(b.alvo_estimado),
          observacao: b.observacao || null,
        };
        const { data, error } = await sb.from("agenda_campanha")
          .upsert(row, { onConflict: "data,campanha_codigo,publico" }).select().maybeSingle();
        if (error) return j({ erro: error.message }, 500);
        return j({ ok: true, item: data });
      }
      if (acao === "status") {
        if (!b.id || !b.status) return j({ erro: "informe id e status" }, 400);
        const patch: any = { status: b.status };
        if (b.resultado_nota !== undefined) patch.resultado_nota = b.resultado_nota || null;
        const { data, error } = await sb.from("agenda_campanha").update(patch).eq("id", b.id).select().maybeSingle();
        if (error) return j({ erro: error.message }, 500);
        return j({ ok: true, item: data });
      }
      if (acao === "remover") {
        if (!b.id) return j({ erro: "informe id" }, 400);
        const { error } = await sb.from("agenda_campanha").delete().eq("id", b.id);
        if (error) return j({ erro: error.message }, 500);
        return j({ ok: true });
      }
      return j({ erro: "acao desconhecida: " + acao }, 400);
    }

    const { data: camps } = await sb.from("campanhas")
      .select("codigo,nome,pipe,ativa,prioridade,status_dados,publico,canais,cadencia,objetivo");
    const cat = (camps || []).sort((a: any, b: any) => a.prioridade - b.prioridade || a.codigo.localeCompare(b.codigo));
    const porCod: Record<string, any> = {}; cat.forEach((c: any) => porCod[c.codigo] = c);

    // ---------------- GET historico: serie por campanha/dia ----------------
    if (p.get("historico")) {
      const ate = p.get("ate") || hoje;
      const de = p.get("de") || maisDias(ate, -89);
      const fila = await paginar((a, b) => sb.from("fila_envio")
        .select("campanha,canal,status,fone,email,criado_em")
        .gte("criado_em", de + "T00:00:00-03:00").lt("criado_em", maisDias(ate, 1) + "T00:00:00-03:00")
        .order("id", { ascending: true }).range(a, b));
      const linhas = agregar(fila).map((a: any) => ({ ...a, nome: porCod[a.campanha]?.nome || a.campanha, pipe: porCod[a.campanha]?.pipe || null }))
        .sort((x: any, y: any) => x.dia.localeCompare(y.dia) || y.total - x.total);
      return j({ de, ate, linhas });
    }

    // ---------------- GET semana ----------------
    const ref = p.get("semana") || hoje;
    const inicio = maisDias(ref, 1 - isoDow(ref));
    const fim = maisDias(inicio, 6);
    const dias = Array.from({ length: 7 }, (_, i) => maisDias(inicio, i));

    const fila = await paginar((a, b) => sb.from("fila_envio")
      .select("campanha,canal,status,fone,email,criado_em")
      .gte("criado_em", inicio + "T00:00:00-03:00").lt("criado_em", maisDias(fim, 1) + "T00:00:00-03:00")
      .order("id", { ascending: true }).range(a, b));
    const real = agregar(fila);
    const realPorDia: Record<string, any[]> = {};
    real.forEach((r: any) => (realPorDia[r.dia] = realPorDia[r.dia] || []).push({ ...r, nome: porCod[r.campanha]?.nome || r.campanha, pipe: porCod[r.campanha]?.pipe || null }));

    const { data: ag } = await sb.from("agenda_campanha").select("*").gte("data", inicio).lte("data", fim);
    const planPorDia: Record<string, any[]> = {};
    (ag || []).forEach((a: any) => (planPorDia[a.data] = planPorDia[a.data] || []).push({ ...a, nome: porCod[a.campanha_codigo]?.nome || a.campanha_codigo, pipe: porCod[a.campanha_codigo]?.pipe || null }));

    // campanhas que JA dispararam alguma vez (para saber o que nunca foi testado)
    const todaFila = await paginar((a, b) => sb.from("fila_envio").select("campanha").order("id", { ascending: true }).range(a, b));
    const jaRodou = new Set(todaFila.map((r: any) => r.campanha).filter(Boolean));

    // fadiga: quantas vezes cada publico e tocado na semana (realizado + planejado)
    const fadiga: Record<string, number> = {};
    real.forEach((r: any) => (porCod[r.campanha]?.publico || []).forEach((pb: string) => fadiga[pb] = (fadiga[pb] || 0) + 1));
    (ag || []).forEach((a: any) => { const ps = a.publico ? [a.publico] : (porCod[a.campanha_codigo]?.publico || []); ps.forEach((pb: string) => fadiga[pb] = (fadiga[pb] || 0) + 1); });

    // ---- sugestoes: regras explicitas, cada uma com o motivo que a gerou ----
    const nomeDia = (iso: string) => DOW_LONGO[isoDow(iso) - 1];
    const sugPorDia: Record<string, any[]> = {};
    const push = (dia: string, s: any) => (sugPorDia[dia] = sugPorDia[dia] || []).push(s);

    for (const dia of dias) {
      const dowc = rotulo(dia);
      const feitas = new Set((realPorDia[dia] || []).map((r: any) => r.campanha));
      const agendadas = new Set((planPorDia[dia] || []).map((a: any) => a.campanha_codigo));
      for (const c of cat) {
        if (!c.ativa || !(c.cadencia || []).includes(dowc)) continue;
        if (feitas.has(c.codigo) || agendadas.has(c.codigo)) continue;
        const forca = dia < hoje ? "perdida" : dia === hoje ? "hoje" : "prevista";
        push(dia, { campanha: c.codigo, nome: c.nome, pipe: c.pipe, publico: c.publico, canais: c.canais, forca,
          motivo: forca === "perdida" ? `Cadência de ${nomeDia(dia).toLowerCase()} não rodou`
                : forca === "hoje" ? "Cadência de hoje ainda não rodou"
                : `Cadência prevista para ${nomeDia(dia).toLowerCase()}`,
          alerta: (c.publico || []).some((pb: string) => (fadiga[pb] || 0) >= 4) ? "Este público já recebeu 4+ campanhas nesta semana" : null });
      }
    }
    // uma vez na semana, no primeiro dia util futuro (ou hoje)
    const alvo = dias.find((d) => d >= hoje && isoDow(d) <= 5) || hoje;
    for (const c of cat) {
      if (c.status_dados === "pronto" && !c.ativa && !jaRodou.has(c.codigo) && !["ia_propoe", "templates_whatsapp"].includes(c.codigo)) {
        push(alvo, { campanha: c.codigo, nome: c.nome, pipe: c.pipe, publico: c.publico, canais: c.canais, forca: "nunca_testada",
          motivo: "Pronta no catálogo e nunca disparada — vale um teste pequeno", alerta: null });
      }
      if (c.status_dados === "proposta") {
        push(alvo, { campanha: c.codigo, nome: c.nome, pipe: c.pipe, publico: c.publico, canais: c.canais, forca: "decisao",
          motivo: "Proposta da IA aguardando sua decisão", alerta: null });
      }
    }

    const soma = (f: (r: any) => number) => real.reduce((a: number, r: any) => a + f(r), 0);
    return j({
      hoje, semana: { inicio, fim },
      dias: dias.map((d) => ({
        data: d, dow: rotulo(d), dow_longo: DOW_LONGO[isoDow(d) - 1], hoje: d === hoje, passado: d < hoje,
        realizado: realPorDia[d] || [], planejado: planPorDia[d] || [], sugestoes: sugPorDia[d] || [],
      })),
      resumo: {
        ativas: cat.filter((c: any) => c.ativa).length, total_catalogo: cat.length,
        na_fila: soma((r) => r.total), enviados: soma((r) => r.enviado), erros: soma((r) => r.erro),
        pendentes: soma((r) => r.pendente), campanhas_na_semana: new Set(real.map((r: any) => r.campanha)).size,
        planejados: (ag || []).length, fadiga,
      },
      catalogo: cat,
    });
  } catch (e) { return j({ erro: String(e) }, 500); }
});
