// campanhas-listar (v15) — devolve o catalogo de campanhas DE UMA EMPRESA (para a tela montar tudo).
// v15: filtra por empresa. Sem isso, no minuto em que a Teak ganhou catalogo proprio (9 campanhas
//      de lead/teca), o painel da Nitron passaria a listar campanha de madeira junto com Clube e
//      voucher. Default 'nitron' porque o painel antigo chama sem parametro.
// v14: a chave de servico vem de srvKey(). Desde 23/08 a plataforma injeta em
// SUPABASE_SERVICE_ROLE_KEY uma chave sb_secret_ que o Data API recusa (PGRST303
// "JWT issued at future"). SRV_JWT guarda o JWT legado de service_role, que segue
// valido. Com o fallback, no dia em que a plataforma consertar nada quebra de novo.
// v13: erro legivel. Antes fazia String(e), que num erro do PostgREST vira "[object Object]"
// e o painel mostrava so "erro", sem dizer o que aconteceu. Foi assim que a queda do dia
// 23/08 (chave de servico rejeitada, PGRST303) ficou muda por um dia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

// chave de servico: SRV_JWT (JWT legado) e, se nao existir, a injetada pela plataforma
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const empresa = new URL(req.url).searchParams.get("empresa") || "nitron";
    const { data, error } = await sb.from("campanhas")
      .select("codigo,nome,pipe,objetivo,publico,canais,cadencia,status_dados,ativa,prioridade,observacao,empresa")
      .eq("empresa", empresa)
      .order("prioridade", { ascending: true });
    if (error) throw error;
    return new Response(JSON.stringify({ empresa, campanhas: data || [] }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("campanhas-listar falhou:", detalhar(e));
    return new Response(JSON.stringify({ erro: detalhar(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
