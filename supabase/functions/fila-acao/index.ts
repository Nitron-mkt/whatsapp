// fila-acao (v1) — o freio de mao e o "resolver a pendencia" da fila, num lugar so.
//
// Ate agora, ver que um disparo estava errado nao dava para fazer nada: a fila seguia. A unica
// forma de parar era eu mexer no banco. Agora a tela consegue:
//   parar      — desliga as chaves da fila (nao cancela nada; so para de puxar linha)
//   retomar    — liga de volta
//   cancelar   — marca as linhas como 'cancelado'. NUNCA toca em 'enviado': mensagem entregue nao
//                se desfaz, e finge-lo no banco seria pior que o problema
//   reenviar   — devolve linhas de 'erro'/'cancelado' para 'pendente', limpando enviado_em
//
// O alvo vem por ids explicitos OU por filtro (campanha/publico/canal/trava). O filtro por `trava`
// le a view fila_trava, entao a tela pode dizer "reenviar os 3 com falha passageira do GHL" sem
// precisar conhecer o texto cru do erro.
//
// Por que funcao e nao PostgREST direto: escrever em fila_envio pela tela exigiria dar UPDATE ao
// anon, e o anon esta embutido no HTML do painel. Aqui a chave de servico fica no servidor e as
// unicas transicoes possiveis sao as quatro acima.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const TETO = 5000;   // teto de linhas por chamada: um clique nao derruba a fila inteira sem querer

function rest(path: string, init?: RequestInit) {
  const k = srvKey();
  return fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: k,
      Authorization: "Bearer " + k,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers || {}),
    },
  });
}

// so estes status podem virar outra coisa. 'enviado' nao esta aqui de proposito.
const CANCELAVEL = ["pendente", "agendado", "enviando"];
const REENVIAVEL = ["erro", "cancelado"];

function filtroQS(f: any): string {
  const q: string[] = [];
  if (f?.campanha) q.push("campanha=eq." + encodeURIComponent(String(f.campanha)));
  if (f?.publico) q.push("publico=eq." + encodeURIComponent(String(f.publico)));
  if (f?.canal) q.push("canal=eq." + encodeURIComponent(String(f.canal)));
  if (f?.dia) q.push("criado_em=gte." + encodeURIComponent(String(f.dia)));
  return q.join("&");
}

// Resolve o alvo em uma lista de ids. Sempre passa por aqui, mesmo quando vem id: assim o teto e a
// checagem de status valem para os dois caminhos, e a resposta consegue dizer o que ficou de fora.
async function alvo(b: any, statusOk: string[]): Promise<{ ids: number[]; fora: number; erro?: string }> {
  const ids = Array.isArray(b.ids) ? b.ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x)) : null;
  let q = "fila_envio?select=id,status&limit=" + (TETO + 1);
  if (ids && ids.length) {
    if (ids.length > TETO) return { ids: [], fora: 0, erro: "mais de " + TETO + " linhas numa chamada" };
    q += "&id=in.(" + ids.join(",") + ")";
  } else if (b.trava) {
    // o alvo vem da classificacao: pega os ids na view e filtra depois
    const rt = await rest("fila_trava?select=id&trava=eq." + encodeURIComponent(String(b.trava)) +
      (filtroQS(b.filtro) ? "&" + filtroQS(b.filtro) : "") + "&limit=" + (TETO + 1));
    if (!rt.ok) return { ids: [], fora: 0, erro: "nao consegui ler fila_trava: " + (await rt.text()).slice(0, 200) };
    const rows = await rt.json();
    if (!Array.isArray(rows) || !rows.length) return { ids: [], fora: 0 };
    if (rows.length > TETO) return { ids: [], fora: 0, erro: "mais de " + TETO + " linhas nesta trava" };
    q += "&id=in.(" + rows.map((x: any) => x.id).join(",") + ")";
  } else {
    const f = filtroQS(b.filtro);
    if (!f) return { ids: [], fora: 0, erro: "sem alvo: informe ids, trava, ou filtro (campanha/publico/canal)" };
    q += "&" + f;
    if (Array.isArray(b.status) && b.status.length) {
      q += "&status=in.(" + b.status.map((x: string) => String(x)).join(",") + ")";
    }
  }
  const r = await rest(q);
  if (!r.ok) return { ids: [], fora: 0, erro: "nao consegui ler a fila: " + (await r.text()).slice(0, 200) };
  const rows = await r.json();
  if (!Array.isArray(rows)) return { ids: [], fora: 0, erro: "resposta inesperada da fila" };
  if (rows.length > TETO) return { ids: [], fora: 0, erro: "mais de " + TETO + " linhas no alvo — estreite o filtro" };
  const bons = rows.filter((x: any) => statusOk.indexOf(String(x.status)) >= 0).map((x: any) => Number(x.id));
  return { ids: bons, fora: rows.length - bons.length };
}

async function mudar(ids: number[], patch: any) {
  if (!ids.length) return { ok: true, mexidas: 0 };
  const r = await rest("fila_envio?select=id&id=in.(" + ids.join(",") + ")", { method: "PATCH", body: JSON.stringify(patch) });
  if (!r.ok) return { ok: false, mexidas: 0, erro: (await r.text()).slice(0, 300) };
  const rows = await r.json().catch(() => []);
  return { ok: true, mexidas: Array.isArray(rows) ? rows.length : 0 };
}

async function chaves(patch: any) {
  const r = await rest("fila_config?select=wpp_ativo,email_ativo&id=eq.1", { method: "PATCH", body: JSON.stringify({ ...patch, atualizado: new Date().toISOString() }) });
  if (!r.ok) return { ok: false, erro: (await r.text()).slice(0, 300) };
  const rows = await r.json().catch(() => []);
  return { ok: true, config: Array.isArray(rows) ? rows[0] : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!BASE || !srvKey()) return j({ ok: false, erro: "sem SUPABASE_URL/SRV_JWT no ambiente" }, 500);
    const b = await req.json().catch(() => ({}));
    const acao = String(b.acao || "");
    const quem = String(b.quem || "painel").slice(0, 60);

    // ---------- freio de mao: nao cancela nada, so para de puxar linha ----------
    if (acao === "parar") {
      const patch: any = {};
      const canal = String(b.canal || "ambos");
      if (canal === "ambos" || canal === "whatsapp") patch.wpp_ativo = false;
      if (canal === "ambos" || canal === "email") patch.email_ativo = false;
      const r = await chaves(patch);
      return j({ ok: r.ok, acao, canal, config: r.config, erro: r.erro, aviso: "a fila parou de puxar linha; o que ja estava em voo pode concluir" });
    }
    if (acao === "retomar") {
      const patch: any = {};
      const canal = String(b.canal || "ambos");
      if (canal === "ambos" || canal === "whatsapp") patch.wpp_ativo = true;
      if (canal === "ambos" || canal === "email") patch.email_ativo = true;
      const r = await chaves(patch);
      return j({ ok: r.ok, acao, canal, config: r.config, erro: r.erro });
    }

    // ---------- cancelar / reenviar ----------
    if (acao === "cancelar" || acao === "reenviar") {
      const statusOk = acao === "cancelar" ? CANCELAVEL : REENVIAVEL;
      const al = await alvo(b, statusOk);
      if (al.erro) return j({ ok: false, acao, erro: al.erro }, 400);
      if (!al.ids.length) {
        return j({
          ok: true, acao, mexidas: 0, fora: al.fora,
          motivo: al.fora
            ? ("nenhuma linha no estado certo: " + al.fora + " ficaram fora (para " + acao + " o status precisa ser " + statusOk.join("/") + "; 'enviado' nunca e mexido)")
            : "nenhuma linha no alvo",
        });
      }
      const nota = String(b.motivo || "").slice(0, 200);
      const patch = acao === "cancelar"
        ? { status: "cancelado", resultado: ("cancelado no painel por " + quem + (nota ? (": " + nota) : "")) }
        : { status: "pendente", enviado_em: null, resultado: ("reenfileirado no painel por " + quem + (nota ? (": " + nota) : "")) };
      const r = await mudar(al.ids, patch);
      return j({ ok: r.ok, acao, mexidas: r.mexidas, fora: al.fora, erro: r.erro });
    }

    return j({ ok: false, erro: "acao invalida: use parar, retomar, cancelar ou reenviar" }, 400);
  } catch (e) {
    return j({ ok: false, erro: String(e) }, 500);
  }
});
