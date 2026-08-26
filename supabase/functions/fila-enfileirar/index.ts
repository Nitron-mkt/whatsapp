// fila-enfileirar (v17) — POST grava itens na fila_envio. GET devolve contagem + lista recente (p/ o painel da tela).
// v16: aceita `campos` — campos personalizados do CRM a gravar no contato ANTES do envio. Tem de ser
// antes: o template do GHL e renderizado no momento em que a mensagem sai, entao campo gravado depois
// aparece vazio na arte.
// v15: TIRADA a chave de servico que estava CHUMBADA no fonte como fallback. Era um JWT de
// service_role valido ate 2101: quem lesse o codigo da funcao tinha acesso total ao banco, e
// rotacionar exigiria redeploy. Agora so SRV_JWT (secret do projeto), como nas outras funcoes.
// Sem a chave a funcao falha alto, em vez de seguir com credencial embutida.
// v14: chave de servico via srvKey() — desde 23/08 a plataforma injeta em
// SUPABASE_SERVICE_ROLE_KEY uma chave sb_secret_ que o Data API recusa (PGRST303).
// O GET tambem passou a reportar erro em vez de devolver contagem zerada calada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = srvKey();
    if (!key) return j({ erro: "sem chave de servico (secret SRV_JWT ausente)" }, 500);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
    if (req.method === "GET") {
      const u = new URL(req.url); const camp = u.searchParams.get("campanha");
      // A CONTAGEM E DA CAMPANHA INTEIRA, A LISTA E DAS ULTIMAS. Antes as duas vinham das mesmas
      // 200 ultimas linhas, entao o cabecalho dizia "124 pendente" quando a campanha tinha outro
      // numero — e cada tela mostrava um total diferente da outra. Contar e listar sao perguntas
      // diferentes: o resumo usa count exato no banco (head, sem trazer linha), a lista traz 80.
      const cont = async (f: (q: any) => any) => {
        let q = sb.from("fila_envio").select("id", { count: "exact", head: true });
        if (camp) q = q.eq("campanha", camp);
        const { count, error } = await f(q);
        if (error) throw error;
        return count || 0;
      };
      const [total, enviado, erro, cancelado, pend, pendW, pendE] = await Promise.all([
        cont((q: any) => q),
        cont((q: any) => q.eq("status", "enviado")),
        cont((q: any) => q.eq("status", "erro")),
        cont((q: any) => q.eq("status", "cancelado")),
        cont((q: any) => q.in("status", ["pendente", "agendado", "enviando"])),
        cont((q: any) => q.in("status", ["pendente", "agendado", "enviando"]).eq("canal", "whatsapp")),
        cont((q: any) => q.in("status", ["pendente", "agendado", "enviando"]).eq("canal", "email")),
      ]);
      let q = sb.from("fila_envio").select("id,campanha,publico,canal,instancia,fone,email,nome,template_id,status,resultado,criado_em,enviado_em").order("id", { ascending: false }).limit(80);
      if (camp) q = q.eq("campanha", camp);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      return j({
        pendente: pend, enviado, erro, cancelado, total,
        whatsapp_pendente: pendW, email_pendente: pendE,
        itens: rows, itens_de: total,   // itens_de: a lista e um recorte; o total e o de cima
      });
    }
    const b = await req.json().catch(() => ({}));
    const itens: any[] = Array.isArray(b.itens) ? b.itens : [];
    if (!itens.length) return j({ erro: "sem itens" }, 400);
    const rows = itens.filter((it) => (it.canal === "whatsapp" && it.fone) || (it.canal === "email" && it.email)).map((it) => ({
      campanha: it.campanha || null, publico: it.publico || null, canal: it.canal, instancia: it.instancia || null,
      fone: it.fone || null, email: it.email || null, nome: it.nome || null, assunto: it.assunto || null,
      corpo: it.corpo || "", template_id: it.template_id || null, merge: it.merge || null, codparc: it.codparc || null,
      // campos do CRM a gravar no contato antes do envio (o template do GHL le do contato)
      campos: it.campos || null, status: "pendente",
    }));
    for (let i = 0; i < rows.length; i += 500) { const { error } = await sb.from("fila_envio").insert(rows.slice(i, i + 500)); if (error) return j({ erro: detalhar(error) }, 500); }
    return j({ ok: true, enfileirados: rows.length });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
