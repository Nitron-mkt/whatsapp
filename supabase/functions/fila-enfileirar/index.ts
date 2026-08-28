// fila-enfileirar (v18) — TRAVA DE DUPLICIDADE. A funcao inseria as linhas as cegas: nada impedia
// que o mesmo (campanha, canal, destino) entrasse duas vezes. Em 28/08 o painel mostrou tres linhas
// do MESMO rep, MESMO numero e MESMA campanha, criadas 08:59, 09:01 e 09:03 — tres cliques em
// "Criar fila e enviar". Em 25/08 a mesma coisa aconteceu no rep_comunicado e as tres SAIRAM: o
// representante recebeu a mesma mensagem tres vezes. Agora duas travas:
//   1) dentro do proprio pedido (o mesmo destino repetido na mesma leva)
//   2) contra a fila: destino que ja esta pendente/enviando na campanha, ou que JA RECEBEU nas
//      ultimas ANTI_DUP_HORAS. Mandar de novo em 12h nao e cadencia, e incomodo.
// A resposta diz quantas foram barradas e por que, para a tela poder mostrar em vez de sumir com a
// diferenca entre "marquei 30" e "entraram 27".
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
    const validos = itens.filter((it) => (it.canal === "whatsapp" && it.fone) || (it.canal === "email" && it.email));

    /* ---------------- TRAVA DE DUPLICIDADE ----------------
       A chave e o DESTINO NORMALIZADO, nao a linha: o mesmo celular escrito "11970399053" e
       "+5511970399053" e o mesmo WhatsApp, e o mesmo e-mail com caixa diferente e o mesmo e-mail.
       Sem normalizar, a trava passaria batido justamente nos casos que a criaram. */
    const dest = (it: any) => it.canal === "email"
      ? String(it.email || "").trim().toLowerCase()
      : String(it.fone || "").replace(/\D/g, "").replace(/^55/, "");
    const chave = (it: any) => [it.campanha || "", it.canal, dest(it)].join("|");

    const noPedido = new Set<string>(); const rowsUnicas: any[] = []; let dupPedido = 0;
    for (const it of validos) {
      const k = chave(it);
      if (noPedido.has(k)) { dupPedido++; continue; }
      noPedido.add(k); rowsUnicas.push(it);
    }

    // ja na fila (pendente/enviando) ou entregue nas ultimas ANTI_DUP_HORAS
    const ANTI_DUP_HORAS = Math.max(0, Number(Deno.env.get("ANTI_DUP_HORAS")) || 12);
    const camps = Array.from(new Set(rowsUnicas.map((it) => it.campanha).filter(Boolean)));
    const jaTem = new Set<string>(); const amostraFila: any[] = [];
    if (camps.length) {
      const desde = new Date(Date.now() - ANTI_DUP_HORAS * 3600000).toISOString();
      let f = 0;
      while (true) {
        const { data, error } = await sb.from("fila_envio")
          .select("campanha,canal,fone,email,status,nome,enviado_em")
          .in("campanha", camps)
          .or("status.in.(pendente,agendado,enviando),and(status.eq.enviado,enviado_em.gte." + desde + ")")
          .range(f, f + 999);
        if (error) return j({ erro: detalhar(error) }, 500);
        (data || []).forEach((r: any) => {
          const k = chave(r);
          if (!jaTem.has(k)) { jaTem.add(k); if (amostraFila.length < 5) amostraFila.push({ nome: r.nome, canal: r.canal, status: r.status, campanha: r.campanha }); }
        });
        if (!data || data.length < 1000) break;
        f += 1000;
      }
    }
    let dupFila = 0;
    const aInserir = rowsUnicas.filter((it) => { if (jaTem.has(chave(it))) { dupFila++; return false; } return true; });

    const rows = aInserir.map((it) => ({
      campanha: it.campanha || null, publico: it.publico || null, canal: it.canal, instancia: it.instancia || null,
      fone: it.fone || null, email: it.email || null, nome: it.nome || null, assunto: it.assunto || null,
      corpo: it.corpo || "", template_id: it.template_id || null, merge: it.merge || null, codparc: it.codparc || null,
      // campos do CRM a gravar no contato antes do envio (o template do GHL le do contato)
      campos: it.campos || null, status: "pendente",
    }));
    for (let i = 0; i < rows.length; i += 500) { const { error } = await sb.from("fila_envio").insert(rows.slice(i, i + 500)); if (error) return j({ erro: detalhar(error) }, 500); }
    return j({
      ok: true, enfileirados: rows.length,
      recebidos: itens.length, sem_destino: itens.length - validos.length,
      duplicados_no_pedido: dupPedido || undefined,
      duplicados_na_fila: dupFila || undefined,
      anti_dup_horas: (dupFila || dupPedido) ? ANTI_DUP_HORAS : undefined,
      duplicados_exemplo: (dupFila && amostraFila.length) ? amostraFila : undefined,
    });
  } catch (e) { return j({ erro: detalhar(e) }, 500); }
});
