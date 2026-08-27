// fila-processar (v20) — cron (1/min). Le fila_config: email em lote (email_lote) se email_ativo; WhatsApp 1 por instancia a cada wpp_intervalo_seg se wpp_ativo. Chama campanhas-enviar (passa merge).
// v20: TETO POR MINUTO, POR INSTANCIA (fila_config.wpp_max_min, padrao 2). A vazao era emergente:
//      cron de 1x/min + portao de wpp_intervalo_seg + margem 0 na rajada davam 1,9 msg/min no lote de
//      26/08. Funcionou por acidente — mudar qualquer uma das tres constantes mudava a vazao sem
//      ninguem perceber, e "no maximo 2 por minuto" nao estava escrito em lugar nenhum. Agora a
//      rodada conta quantas ESTA instancia mandou nos ultimos 60s e corta a rajada no teto. Por
//      instancia porque o limite que protege de bloqueio e o do NUMERO: duas assistentes a 2/min cada
//      nao aumentam o risco de nenhuma das duas.
// BILINGUE: drena tanto as linhas do GESTOR (status='pendente', texto em `corpo`, com assunto)
// quanto as do MOTOR (status='agendado', texto em `mensagem`, sem assunto). texto = corpo||mensagem.
// v13: chave de servico via srvKey(). Desde 23/08 a plataforma injeta em
// SUPABASE_SERVICE_ROLE_KEY uma chave sb_secret_ que o Data API recusa (PGRST303), e a fila
// parou de drenar em silencio — respondia {"emails":0,"whatsapp":0} sem conseguir ler nada.
// v15: confere a instancia contra o cadastro instancia_ghl antes de enviar. Antes bloqueava so
// instancia NULA — token invalido (ex.: "<sem", "Monica" sem acento) passava e o #contact_instance
// nao amarrava nada, entao a mensagem saia pela instancia errada e o cliente recebia algo desconexo.
// v19: repassa `campos` — os campos personalizados do CRM que a linha quer gravar no contato antes do
//      envio, para o template do GHL ter o que imprimir na arte.
// v18: RAJADA COM ESPERA SORTEADA. Antes a rodada soltava 1 mensagem por instancia, e como a rodada
//      e o cron de 1x/min o piso real era 1 mensagem por minuto por instancia — 139 clientes levariam
//      2h20 numa instancia so, por limite do cron e nao por politica. Agora fila_config.wpp_burst diz
//      quantas a rodada pode soltar da mesma instancia, e a espera entre elas e SORTEADA entre
//      wpp_burst_min_seg e wpp_burst_max_seg. Sorteada de proposito: cadencia de metronomo e um dos
//      sinais que derruba numero. Com wpp_burst=1 nada muda em relacao ao v17.
//      A margem do bind vai a 0 na rajada: ela existia para uma corrida que nao existe (o numero de
//      saida e o do dono do contato, nao do #contact_instance), e a 20s por mensagem inviabiliza lote.
//      Duas travas que a rajada exige:
//      1) ORCAMENTO DE TEMPO. A funcao tem limite de execucao, e 139 mensagens numa rodada nao caberiam.
//         A rodada para em BURST_JANELA_MS e o proximo tick continua de onde parou.
//      2) RESERVA DA LINHA. Com rajada duas rodadas do cron se sobrepoem, e as duas leriam a MESMA
//         linha pendente — o cliente receberia a mensagem duas vezes. Entao a linha e reservada
//         (status 'enviando') antes de enviar, e so quem reservou envia. Linha reservada ha mais de
//         RESGATE_MIN minutos volta para pendente (rodada que morreu no meio).
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
    const BURST = Math.max(1, Math.min(500, Number(cfg?.wpp_burst ?? 1)));
    // 0 ou ausente = sem teto (comportamento antigo); qualquer valor >0 e limite duro
    const MAX_MIN = Math.max(0, Number(cfg?.wpp_max_min ?? 0));
    const BURST_MIN_MS = Math.max(0, Number(cfg?.wpp_burst_min_seg ?? 0)) * 1000;
    const BURST_MAX_MS = Math.max(BURST_MIN_MS, Number(cfg?.wpp_burst_max_seg ?? 0) * 1000);
    const sorteio = () => BURST_MIN_MS + Math.floor(Math.random() * (BURST_MAX_MS - BURST_MIN_MS + 1));
    const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const BURST_JANELA_MS = Math.max(5000, Number(Deno.env.get("BURST_JANELA_MS")) || 50000);
    const RESGATE_MIN = 10;
    const t0 = Date.now();
    const EMAIL_LOTE = Math.max(1, Number(cfg?.email_lote ?? 25));
    const WPP_ATIVO = cfg?.wpp_ativo !== false;
    const EMAIL_ATIVO = cfg?.email_ativo !== false;
    // cadastro de instancias validas (fonte de verdade da gestao, nao do organograma do Sankhya)
    const { data: instRows, error: eInst } = await sb.from("instancia_ghl").select("instancia").eq("ativa", true);
    if (eInst) throw eInst;
    const INST_OK = new Set((instRows || []).map((x: any) => String(x.instancia)));
    if (!INST_OK.size) throw new Error("instancia_ghl sem instancia ativa — abortado para nao mandar WhatsApp sem amarrar");
    // rodada anterior pode ter morrido no meio e deixado linha reservada; devolve para a fila
    {
      // a reserva estampa enviado_em, entao e por ele que se sabe QUANDO a linha foi reservada.
      // (criado_em nao serve: linha antiga reservada agora seria "resgatada" e sairia em duplicidade.)
      const limite = new Date(Date.now() - RESGATE_MIN * 60000).toISOString();
      await sb.from("fila_envio").update({ status: "pendente" }).eq("status", "enviando").lt("enviado_em", limite);
      await sb.from("fila_envio").update({ status: "pendente" }).eq("status", "enviando").is("enviado_em", null);
    }
    async function enviar(m: any, rajada = false) {
      const texto = m.corpo || m.mensagem || "";
      if (!texto) { await sb.from("fila_envio").update({ status: "erro", resultado: "sem texto (corpo/mensagem vazios)" }).eq("id", m.id); return { ok: false, caiu: false }; }
      const assunto = m.assunto || ("Nitron — " + (m.nome || "")).trim();
      const body = m.canal === "email"
        ? { canal: "email", email: m.email, nome: m.nome, assunto, texto, templateId: m.template_id || undefined, merge: m.merge || undefined, codparc: m.codparc || undefined, campos: m.campos || undefined }
        // usar_dono nas campanhas de CLIENTE: o WhatsApp sai pelo numero de quem e dono do contato no
        // CRM, entao ali a gente manda pela dona de fato (e o campanhas-enviar acerta o nome no texto).
        // Nas de REPRESENTANTE nao: divergir do organograma e um aviso para a gestao, e a linha fica
        // com erro dizendo de quem o contato e — melhor do que mandar em nome de quem nao mandou.
        : { canal: "whatsapp", fone: m.fone, nome: m.nome, instancia: m.instancia, texto, codparc: m.codparc || undefined, campos: m.campos || undefined, usar_dono: m.publico === "cliente", margem_ms: rajada ? 0 : undefined, exigir_confirmacao: rajada ? false : undefined };
      let ok = false, resumo = "", caiu = false;
      try {
        const r = await fetch(url + "/functions/v1/campanhas-enviar", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        ok = !!d.ok; caiu = !!d.instancia_caiu;
        resumo = ok ? ("ok " + (d.via || "") + (d.instancia_pedida ? (" · saiu pela " + d.instancia + " (dona do contato), nao pela " + d.instancia_pedida) : "")) : (d.motivo || d.erro || ("status " + r.status));
      } catch (e) { resumo = String(e); }
      await sb.from("fila_envio").update({ status: ok ? "enviado" : "erro", enviado_em: new Date().toISOString(), tentativas: (m.tentativas || 0) + 1, resultado: resumo.slice(0, 300) }).eq("id", m.id);
      return { ok, caiu };
    }
    let emails = 0;
    if (EMAIL_ATIVO) {
      const { data: eRows, error } = await sb.from("fila_envio").select("*").in("status", PEND).eq("canal", "email").order("id").limit(EMAIL_LOTE);
      if (error) throw error;
      for (const m of (eRows || [])) {
        const { data: presa } = await sb.from("fila_envio").update({ status: "enviando", enviado_em: new Date().toISOString() })
          .eq("id", m.id).in("status", PEND).select("id");
        if (!presa || !presa.length) continue;   // outra rodada pegou primeiro
        await enviar(m); emails++;
      }
    }
    let whatsapp = 0; let bloqueados = 0; let estourou = 0; const caiuInst: string[] = [];
    if (WPP_ATIVO) {
      const { data: wRows, error } = await sb.from("fila_envio").select("*").in("status", PEND).eq("canal", "whatsapp").order("id");
      if (error) throw error;
      const porInst: Record<string, any[]> = {};
      for (const m of (wRows || [])) { const k = m.instancia || ""; (porInst[k] = porInst[k] || []).push(m); }
      const tarefas: Promise<void>[] = [];
      for (const inst of Object.keys(porInst)) {
        const lote = porInst[inst];
        if (!inst) { for (const m of lote) { await sb.from("fila_envio").update({ status: "erro", resultado: "sem instancia (WhatsApp nao roteavel)" }).eq("id", m.id); bloqueados++; } continue; }
        if (!INST_OK.has(inst)) { for (const m of lote) { await sb.from("fila_envio").update({ status: "erro", resultado: "instancia '" + inst + "' fora do cadastro instancia_ghl" }).eq("id", m.id); bloqueados++; } continue; }
        tarefas.push((async () => {
          const { data: last } = await sb.from("fila_envio").select("enviado_em").eq("canal", "whatsapp").eq("instancia", inst).eq("status", "enviado").order("enviado_em", { ascending: false }).limit(1).maybeSingle();
          const lastMs = last?.enviado_em ? new Date(last.enviado_em).getTime() : 0;
          if (now - lastMs < WPP_INTERVALO_MS) return;   // essa instancia ainda esta no intervalo
          // Quantas ESTA instancia ja mandou nos ultimos 60s. O teto vale sobre a janela movel, e
          // nao sobre a rodada: sem isso duas rodadas sobrepostas somariam 2 + 2 no mesmo minuto.
          let teto = BURST;
          if (MAX_MIN > 0) {
            const desde = new Date(now - 60000).toISOString();
            const { count } = await sb.from("fila_envio").select("id", { count: "exact", head: true })
              .eq("canal", "whatsapp").eq("instancia", inst).eq("status", "enviado").gte("enviado_em", desde);
            teto = Math.max(0, MAX_MIN - (count || 0));
            if (teto === 0) { estourou++; return; }   // ja bateu o teto neste minuto
          }
          const quantas = Math.min(BURST, teto, lote.length);
          for (let i = 0; i < quantas; i++) {
            if (Date.now() - t0 > BURST_JANELA_MS) break;   // o proximo tick continua
            if (i > 0) await dormir(sorteio());             // espera sorteada entre uma e outra
            // reserva a linha: sem isso duas rodadas sobrepostas mandariam a mesma mensagem
            const { data: presa } = await sb.from("fila_envio").update({ status: "enviando", enviado_em: new Date().toISOString() })
              .eq("id", lote[i].id).in("status", PEND).select("id");
            if (!presa || !presa.length) continue;          // outra rodada pegou primeiro
            const r = await enviar(lote[i], BURST > 1);
            whatsapp++;
            // INSTANCIA CAIU: para o lote desta instancia agora. Em 26/08 o lote seguiu com a
            // instancia desconectada e oito linhas viraram "enviado" sem nada chegar. As demais
            // continuam pendentes e saem quando a instancia voltar — nao ha nada a ganhar
            // insistindo, e cada tentativa a mais e uma linha marcada errada.
            if (r && r.caiu) { caiuInst.push(inst); break; }
          }
        })());
      }
      await Promise.all(tarefas);   // uma instancia lenta nao segura as outras
    }
    return j({ ok: true, emails, whatsapp, bloqueados_por_instancia: bloqueados, instancias_ativas: INST_OK.size, instancias_no_teto: estourou, instancias_caidas: caiuInst.length ? [...new Set(caiuInst)] : undefined, cfg: { wpp_seg: WPP_INTERVALO_MS / 1000, email_lote: EMAIL_LOTE, wpp_ativo: WPP_ATIVO, email_ativo: EMAIL_ATIVO, burst: BURST, burst_seg: [BURST_MIN_MS / 1000, BURST_MAX_MS / 1000], max_min: MAX_MIN } });
  } catch (e: any) {
    const msg = [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
    console.error("fila-processar falhou:", msg);
    return j({ ok: false, erro: msg }, 500);
  }
});
