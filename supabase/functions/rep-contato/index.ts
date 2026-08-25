// rep-contato (v3) — add/list/remove contatos manuais do representante (rep_contato_extra). DELETE por id OU (codvend,tipo,valor).
// v3: TIRADA a chave de servico que estava CHUMBADA no fonte como fallback do srvKey(). Era um JWT
// de service_role valido ate 2101: quem lesse o codigo da funcao tinha acesso total ao banco, e
// rotacionar exigiria redeploy. Agora so SRV_JWT (secret do projeto). Sem chave a funcao falha
// alto, em vez de seguir com credencial embutida.
// v2: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou sb_secret_ e o PostgREST recusa com PGRST303)
//     + escritas que nao mentem mais um "ok" quando falham.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = srvKey();
    if (!key) return j({ erro: "sem chave de servico (secret SRV_JWT ausente)" }, 500);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
    const url = new URL(req.url);
    if (req.method === "GET") {
      const codvend = Number(url.searchParams.get("codvend"));
      const { data, error } = await sb.from("rep_contato_extra").select("*").eq("codvend", codvend).eq("ativo", true).order("id"); if (error) throw error;
      return j({ contatos: data || [] });
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      const codvend = url.searchParams.get("codvend"); const tipo = url.searchParams.get("tipo"); const valor = url.searchParams.get("valor");
      if (id) { const { error } = await sb.from("rep_contato_extra").update({ ativo: false }).eq("id", Number(id)); if (error) throw error; return j({ ok: true }); }
      if (codvend && tipo && valor) { const { error } = await sb.from("rep_contato_extra").update({ ativo: false }).eq("codvend", Number(codvend)).eq("tipo", tipo).eq("valor", valor); if (error) throw error; return j({ ok: true }); }
      return j({ erro: "id ou (codvend,tipo,valor)" }, 400);
    }
    const b = await req.json().catch(() => ({}));
    const codvend = Number(b.codvend); const tipo = String(b.tipo || ""); const valor = String(b.valor || "").trim();
    if (!codvend || (tipo !== "telefone" && tipo !== "email") || !valor) return j({ erro: "codvend, tipo(telefone|email) e valor obrigatorios" }, 400);
    // evita duplicar: se ja existe ativo igual, nao insere de novo
    const { data: ex, error: eEx } = await sb.from("rep_contato_extra").select("id").eq("codvend", codvend).eq("tipo", tipo).eq("valor", valor).eq("ativo", true).maybeSingle(); if (eEx) throw eEx;
    if (ex) return j({ ok: true, id: ex.id, jaexistia: true });
    const { data, error } = await sb.from("rep_contato_extra").insert({ codvend, tipo, valor, rotulo: b.rotulo ? String(b.rotulo) : null, ativo: true }).select("id").maybeSingle(); if (error) throw error;
    return j({ ok: true, id: data?.id });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
