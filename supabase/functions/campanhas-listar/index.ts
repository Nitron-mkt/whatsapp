// campanhas-listar (v13) — devolve o catalogo de campanhas (para a tela montar tudo).
// v13: erro legivel. Antes fazia String(e), que num erro do PostgREST vira "[object Object]"
// e o painel mostrava so "erro", sem dizer o que aconteceu. Foi assim que a queda do dia
// 23/08 (chave de servico rejeitada, PGRST303) ficou muda por um dia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

function detalhar(e: any) {
  if (!e) return "erro desconhecido";
  if (typeof e === "string") return e;
  const p = [e.message, e.details, e.hint, e.code].filter(Boolean).map(String);
  if (p.length) return p.join(" · ");
  try { return JSON.stringify(e); } catch { return String(e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await sb.from("campanhas")
      .select("codigo,nome,pipe,objetivo,publico,canais,cadencia,status_dados,ativa,prioridade")
      .order("prioridade", { ascending: true });
    if (error) throw error;
    return new Response(JSON.stringify({ campanhas: data || [] }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("campanhas-listar falhou:", detalhar(e));
    return new Response(JSON.stringify({ erro: detalhar(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
