// fila-processar (v17) — cron (1/min). Le fila_config: email em lote (email_lote) se email_ativo; WhatsApp 1 por instancia a cada wpp_intervalo_seg se wpp_ativo. Chama campanhas-enviar (passa merge).
// BILINGUE: drena tanto as linhas do GESTOR (status='pendente', texto em `corpo`, com assunto)
// quanto as do MOTOR (status='agendado', texto em `mensagem`, sem assunto). texto = corpo||mensagem.
// v13: chave de servico via srvKey(). Desde 23/08 a plataforma injeta em
// SUPABASE_SERVICE_ROLE_KEY uma chave sb_secret_ que o Data API recusa (PGRST303), e a fila
// parou de drenar em silencio — respondia {"emails":0,"whatsapp":0} sem conseguir ler nada.
// v15: confere a instancia contra o cadastro instancia_ghl antes de enviar. Antes bloqueava so
// instancia NULA — token invalido (ex.: "<sem", "Monica" sem acento) passava e o #contact_instance
// nao amarrava nada, entao a mensagem saia pela instancia errada e o cliente recebia algo desconexo.
// v17: campanha de cliente vai com usar_dono — quem manda e a dona do contato no CRM, porque e o
//      numero dela que aparece no WhatsApp. Campanha de rep continua recusando divergencia.
// v16: as instancias passam a ser drenadas EM PARALELO. O campanhas-enviar v23 agora espera o app
// confirmar a troca de instancia antes de soltar o texto (~25s no pior caso), e em serie 7 instancias
// estourariam o tempo da funcao — o cron abortaria no meio e a fila ficaria parada sem aviso.
// Cada linha e de uma instancia e de um contato diferente, entao nao ha ordem a preservar entre elas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const PEND = ["pendente", "agendado"];
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!; const key = srvKey();
    const sb = createClient(url, key);
    const now = Date.now();
    const { data: cfg, error: eCfg } = await sb.from("fila_config").select("*").eq("id", 1).maybeSingle();
    if (eCfg) throw eCfg;   // antes o erro era engolido e a fila parecia vazia
    const WPP_INTERVALO_MS = Math.max(30, Number(cfg?.wpp_intervalo_seg ?? 120)) * 1000;
    const EMAIL_LOTE = Math.max(1, Number(cfg?.email_lote ?? 25));
    const WPP_ATIVO = cfg?.wpp_ativo !== false;
    const EMAIL_ATIVO = cfg?.email_ativo !== false;
    // cadastro de instancias validas (fonte de verdade da gestao, nao do organograma do Sankhya)
    const { data: instRows, error: eInst } = await sb.from("instancia_ghl").select("instancia").eq("ativa", true);
    if (eInst) throw eInst;
    const INST_OK = new Set((instRows || []).map((x: any) => String(x.instancia)));
    if (!INST_OK.size) throw new Error("instancia_ghl sem instancia ativa — abortado para nao mandar WhatsApp sem amarrar");
    async function enviar(m: any) {
      const texto = m.corpo || m.mensagem || "";
      if (!texto) { await sb.from("fila_envio").update({ status: "erro", resultado: "sem texto (corpo/mensagem vazios)" }).eq("id", m.id); return false; }
      const assunto = m.assunto || ("Nitron — " + (m.nome || "")).trim();
      const body = m.canal === "email"
        ? { canal: "email", email: m.email, nome: m.nome, assunto, texto, templateId: m.template_id || undefined, merge: m.merge || undefined, codparc: m.codparc || undefined }
        // usar_dono nas campanhas de CLIENTE: o WhatsApp sai pelo numero de quem e dono do contato no
        // CRM, entao ali a gente manda pela dona de fato (e o campanhas-enviar acerta o nome no texto).
        // Nas de REPRESENTANTE nao: divergir do organograma e um aviso para a gestao, e a linha fica
        // com erro dizendo de quem o contato e — melhor do que mandar em nome de quem nao mandou.
        : { canal: "whatsapp", fone: m.fone, nome: m.nome, instancia: m.instancia, texto, codparc: m.codparc || undefined, usar_dono: m.publico === "cliente" };
      let ok = false, resumo = "";
      try {
        const r = await fetch(url + "/functions/v1/campanhas-enviar", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        ok = !!d.ok; resumo = ok ? ("ok " + (d.via || "") + (d.instancia_pedida ? (" · saiu pela " + d.instancia + " (dona do contato), nao pela " + d.instancia_pedida) : "")) : (d.motivo || d.erro || ("status " + r.status));
      } catch (e) { resumo = String(e); }
      await sb.from("fila_envio").update({ status: ok ? "enviado" : "erro", enviado_em: new Date().toISOString(), tentativas: (m.tentativas || 0) + 1, resultado: resumo.slice(0, 300) }).eq("id", m.id);
      return ok;
    }
    let emails = 0;
    if (EMAIL_ATIVO) {
      const { data: eRows, error } = await sb.from("fila_envio").select("*").in("status", PEND).eq("canal", "email").order("id").limit(EMAIL_LOTE);
      if (error) throw error;
      for (const m of (eRows || [])) { await enviar(m); emails++; }
    }
    let whatsapp = 0; let bloqueados = 0;
    if (WPP_ATIVO) {
      const { data: wRows, error } = await sb.from("fila_envio").select("*").in("status", PEND).eq("canal", "whatsapp").order("id");
      if (error) throw error;
      const firstByInst: Record<string, any> = {};
      for (const m of (wRows || [])) { const k = m.instancia || ""; if (!firstByInst[k]) firstByInst[k] = m; }
      const tarefas: Promise<void>[] = [];
      for (const inst of Object.keys(firstByInst)) {
        const m = firstByInst[inst];
        if (!inst) { await sb.from("fila_envio").update({ status: "erro", resultado: "sem instancia (WhatsApp nao roteavel)" }).eq("id", m.id); bloqueados++; continue; }
        if (!INST_OK.has(inst)) { await sb.from("fila_envio").update({ status: "erro", resultado: "instancia '" + inst + "' fora do cadastro instancia_ghl" }).eq("id", m.id); bloqueados++; continue; }
        tarefas.push((async () => {
          const { data: last } = await sb.from("fila_envio").select("enviado_em").eq("canal", "whatsapp").eq("instancia", inst).eq("status", "enviado").order("enviado_em", { ascending: false }).limit(1).maybeSingle();
          const lastMs = last?.enviado_em ? new Date(last.enviado_em).getTime() : 0;
          if (now - lastMs >= WPP_INTERVALO_MS) { await enviar(m); whatsapp++; }
        })());
      }
      await Promise.all(tarefas);   // uma instancia lenta nao segura as outras
    }
    return j({ ok: true, emails, whatsapp, bloqueados_por_instancia: bloqueados, instancias_ativas: INST_OK.size, cfg: { wpp_seg: WPP_INTERVALO_MS / 1000, email_lote: EMAIL_LOTE, wpp_ativo: WPP_ATIVO, email_ativo: EMAIL_ATIVO } });
  } catch (e: any) {
    const msg = [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
    console.error("fila-processar falhou:", msg);
    return j({ ok: false, erro: msg }, 500);
  }
});
