// campanhas-enviar (v27) — email com ARTE + {{...}}. Garante contato. WhatsApp via SMS+#contact_instance. Recusa WhatsApp para telefone FIXO (10 digitos). ?diag mostra rate-limit.
// v22: TRAVA DE INSTANCIA. Antes, sem instancia ele mandava o texto SEM amarrar — a mensagem saia pela ultima instancia
//      a que aquele contato ficou preso (de outro assunto, de outro mes), e o cliente recebia algo desconexo.
//      Agora WhatsApp sem instancia e RECUSADO, e o token e conferido contra o cadastro instancia_ghl (cache de 5 min).
// v23: ESPERA A TROCA DE FATO ACONTECER. O sleep de 1500ms era chute e perdia a corrida: em 24/08 o bind foi aceito,
//      o texto saiu 4s depois e o cliente recebeu pela instancia ANTIGA. O ZaptosWPP grava "[System]: Contact Instance
//      Updated!" na conversa quando processa o comando, entao agora a gente fica lendo a conversa ate essa confirmacao
//      aparecer (com dateAdded posterior ao proprio bind) e SO ENTAO espera a margem de acomodacao e manda o texto.
//      Sem confirmacao dentro da janela, o texto NAO sai — melhor nao enviar do que enviar pelo numero errado.
//      A instancia nao existe como campo do contato no GHL (conferido: 100 custom fields, nenhum) — o app guarda no
//      banco dele, e a tela do CRM mostra cache (foi por isso que so apareceu certo depois do reload). A confirmacao
//      na conversa e o unico sinal observavel que temos.
//      Medicoes de 24/08: a confirmacao chega 2,2-2,3s depois do bind, sempre (3 amostras). E ela e
//      INCONDICIONAL — sai tambem quando o contato JA estava na instancia pedida (probe 16:57), entao
//      "sem confirmacao" significa de verdade que o comando nao foi processado, e recusar e seguro.
//      Margem em 20s: com 1,7s depois da confirmacao a mensagem saiu pela instancia antiga; com 22,6s
//      saiu certa. A fila manda 1 por instancia a cada 120s, entao a espera nao custa vazao.
// v25: CONFERE O PROPRIETARIO DO CONTATO NO CRM. O numero de saida e o do usuario remetente, e numa
//      mensagem de API o remetente e o assignedTo do contato — o #contact_instance manda na atribuicao
//      de entrada, nao na de saida. Entao antes de mandar a gente le o assignedTo: se ele e uma
//      instancia ATIVA do cadastro e nao e a instancia pedida, o texto NAO sai (sairia pelo numero da
//      outra assistente, com o [ASSISTENTE] do texto errado). Se o proprietario nao e nenhuma
//      instancia do cadastro, segue como antes — nao ha o que comparar, e recusar quebraria as
//      campanhas de cliente. Nunca mexemos no assignedTo: mudar o dono tira a visibilidade do contato
//      das outras assistentes (foi por isso que a gestao tirou aquele workflow do CRM).
// v26: CONTATO NOVO NASCE COM DONO. Os leads enriquecidos do Motor nao existem no CRM (conferido em
//      26/08: busca por telefone devolve zero), e o contato so nascia aqui, no envio, SEM proprietario.
//      Contato sem dono e o pior caso — o numero de saida fica indefinido. Agora, ao criar, o contato
//      ja e atribuido ao usuario da instancia pedida, entao a mensagem sai pelo numero certo na
//      primeira mensagem, sem precisar de passada previa de reatribuicao.
// v27: GRAVA CAMPO DO CRM ANTES DE ENVIAR. O template do GHL so sabe imprimir campo do contato, e e
//      renderizado no momento do envio — campo gravado depois sai vazio na arte. Entao `campos` vem no
//      corpo por chave semantica e e escrito no contato que esta recebendo, no mesmo ponto onde o
//      CODPARC ja era gravado. Escrever no contato do DESTINATARIO e o ponto: o percentual do voucher
//      existia no CRM so no contato da EMPRESA (tag sankhya-cliente), e a campanha manda para os
//      contatos das PESSOAS (comprador, financeiro), onde o campo vinha vazio.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API = "https://services.leadconnectorhq.com";
const LOC = "rZ8y7lzqV7fzxsartaX2";
const RENATO = "bnKA8BWCRaTeiBC2rjRs";
const FID_CODPARC = "HaDWHgnJSjDDdPF7XFDH";
// de-para das chaves semanticas para o id do campo personalizado no GHL. Os tres primeiros ja
// existiam (da positivacao) e sao alimentados tambem por outro processo, no contato da empresa; aqui
// a gente preenche no contato que recebe. O de validade foi criado em 26/08 (contact.voucher_validade).
const FID_CAMPO: Record<string, string> = {
  voucher_pct: "II773kLNc7R4Pw278zcf",       // contact.voucher_positivacao  = PERC_VOUCHER
  voucher_adic: "h6yFBPOnoe4af0BDWNIB",      // contact.adicional_positivacao = PERC_ADIC
  voucher_total: "8YX7LVJcbwiqD8dHwUSe",     // contact.total_pontos          = a soma
  voucher_validade: "sQsGU460EXuId97hpKEi",  // contact.voucher_validade      = texto "31/08/2026"
};
// Grava no contato os campos pedidos. Devolve o que foi gravado, ou null quando nao havia nada.
async function gravarCampos(contactId: string, campos: any): Promise<string[] | null> {
  if (!campos || typeof campos !== "object") return null;
  const cf = Object.keys(campos)
    .filter((k) => FID_CAMPO[k] && campos[k] !== null && campos[k] !== undefined && String(campos[k]) !== "")
    .map((k) => ({ id: FID_CAMPO[k], value: String(campos[k]) }));
  if (!cf.length) return null;
  try {
    const r = await ghl("PUT", `/contacts/${contactId}`, { customFields: cf });
    if (!r.ok) return null;
    return cf.map((x) => x.id);
  } catch { return null; }
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const numEnv = (nome: string, padrao: number) => { const v = Number(Deno.env.get(nome)); return Number.isFinite(v) && v > 0 ? v : padrao; };
// janela para a confirmacao aparecer, intervalo de leitura e margem depois de confirmada
const BIND_ESPERA_MS = numEnv("BIND_ESPERA_MS", 25000);
const BIND_POLL_MS = numEnv("BIND_POLL_MS", 1500);
const BIND_MARGEM_MS = numEnv("BIND_MARGEM_MS", 20000);
function ghl(method: string, path: string, body: any, version = "2021-07-28") {
  return fetch(API + path, { method, headers: { "Authorization": "Bearer " + Deno.env.get("GHL_TOKEN"), "Version": version, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA }, body: body ? JSON.stringify(body) : undefined });
}
// ---- cadastro de instancias (cache de 5 min por isolate) ----
type Cadastro = { set: Set<string>; porUsuario: Record<string, string>; idDe: Record<string, string> };
let instCache: { at: number; c: Cadastro } | null = null;
async function cadastro(): Promise<Cadastro | null> {
  if (instCache && Date.now() - instCache.at < 300000) return instCache.c;
  try {
    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""); const k = srvKey();
    if (!base || !k) return null;
    const r = await fetch(`${base}/rest/v1/instancia_ghl?ativa=eq.true&select=instancia,usuario_ghl_id`, { headers: { apikey: k, Authorization: "Bearer " + k } });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const set = new Set<string>(rows.map((x: any) => String(x.instancia)));
    const porUsuario: Record<string, string> = {}; const idDe: Record<string, string> = {};
    rows.forEach((x: any) => { if (x.usuario_ghl_id) { porUsuario[String(x.usuario_ghl_id)] = String(x.instancia); idDe[String(x.instancia)] = String(x.usuario_ghl_id); } });
    const c = { set, porUsuario, idDe };
    instCache = { at: Date.now(), c };
    return c;
  } catch { return null; }
}
async function instanciasValidas(): Promise<Set<string> | null> { const c = await cadastro(); return c ? c.set : null; }
// Quem o CRM diz que e o dono do contato — e portanto por qual numero o WhatsApp vai sair.
// null = nao deu para saber; "" = tem dono, mas ele nao e instancia nenhuma do cadastro ativo.
async function donoDoContato(contactId: string): Promise<string | null> {
  const c = await cadastro(); if (!c) return null;
  try {
    const r = await ghl("GET", `/contacts/${contactId}`, null);
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    const uid = String(d?.contact?.assignedTo || d?.assignedTo || "");
    if (!uid) return "";
    return c.porUsuario[uid] || "";
  } catch { return null; }
}
const formaOk = (s: string) => /^[\p{L}\p{N} ._-]{2,40}$/u.test(s);
function foneVariants(fone: string): string[] {
  const d = String(fone || "").replace(/\D/g, ""); const out = new Set<string>();
  if (fone) out.add(String(fone).trim());
  if (d) { out.add(d); if (d.length <= 11) { out.add("55" + d); out.add("+55" + d); } out.add("+" + d); }
  return [...out].filter((x) => x && x.length >= 3);
}
function e164(fone: string): string { const d = String(fone || "").replace(/\D/g, ""); if (!d) return ""; if (d.length <= 11) return "+55" + d; return "+" + d; }
function foneFixo(fone: string): boolean { let d = String(fone || "").replace(/\D/g, "").replace(/^0+/, ""); if (d.slice(0, 2) === "55") d = d.slice(2); d = d.replace(/^0+/, ""); return d.length === 10; }
function preencher(str: string, nome?: string, texto?: string, merge?: any): string {
  if (!str) return str;
  const full = String(nome || "").trim(); const first = full.split(/\s+/)[0] || ""; const last = full.split(/\s+/).slice(1).join(" ");
  const msg = String(texto || "").replace(/\n/g, "<br>"); const m = merge || {};
  const map: Record<string, string> = {
    "contact.first_name": first, "first_name": first, "nome": first, "primeiro_nome": first,
    "contact.name": full || first, "contact.full_name": full || first, "nome_completo": full || first,
    "contact.last_name": last, "sobrenome": last,
    "document.recipient.firstname": first, "document.recipient.lastname": last,
    "location.name": "Nitron", "nitron": "Nitron", "empresa_nitron": "Nitron", "user.name": "Nitron",
    "mensagem": msg, "corpo": msg, "texto": msg,
    "cliente": String(m.cliente || m.empresa || full || ""), "empresa": String(m.empresa || m.cliente || full || ""),
    "saldo": String(m.saldo || ""), "validade": String(m.validade || ""), "valor": String(m.valor || m.saldo || ""), "dias": String(m.dias || ""), "lista": String(m.lista || ""),
    "rep": String(m.rep || ""), "representante": String(m.rep || ""), "assistente": String(m.instancia || m.assistente || ""),
  };
  return str.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_full, key) => { const k = String(key).trim().toLowerCase(); return (k in map) ? map[k] : ""; });
}
async function buscarUm(q: string): Promise<any> {
  try { const r = await ghl("GET", `/contacts/?locationId=${LOC}&query=${encodeURIComponent(q)}&limit=1`, null); const d = await r.json(); return (d?.contacts || [])[0] || null; } catch { return null; }
}
async function upsertContato(fields: any): Promise<string | null> {
  try { const r = await ghl("POST", "/contacts/upsert", { locationId: LOC, ...fields }); const d = await r.json().catch(() => ({})); return d?.contact?.id || null; } catch { return null; }
}
async function garantirPorFone(fone: string, nome?: string, codparc?: any, dono?: string) {
  for (const v of foneVariants(fone)) { const c = await buscarUm(v); if (c?.id) return { id: c.id, via: "fone:" + v, criado: false }; }
  const fields: any = { phone: e164(fone), firstName: nome || ("Contato " + e164(fone)) };
  if (codparc) fields.customFields = [{ id: FID_CODPARC, value: String(codparc) }];
  if (dono) fields.assignedTo = dono;   // nasce com dono: sem isso o numero de saida fica indefinido
  return { id: await upsertContato(fields), via: "criado", criado: true };
}
async function garantirPorEmail(email: string, nome?: string, codparc?: any, dono?: string) {
  const c = await buscarUm(email.trim()); if (c?.id) return { id: c.id, via: "email", criado: false };
  const fields: any = { email: email.trim(), firstName: nome || email.trim() };
  if (codparc) fields.customFields = [{ id: FID_CODPARC, value: String(codparc) }];
  if (dono) fields.assignedTo = dono;
  return { id: await upsertContato(fields), via: "criado", criado: true };
}
async function arteHtml(templateId: string): Promise<string | null> {
  try {
    const r = await ghl("GET", `/emails/builder?locationId=${LOC}&limit=100`, null);
    const d = await r.json(); const lista = d?.builders || d?.data?.builders || [];
    const tpl = lista.find((t: any) => t.id === templateId); if (!tpl?.previewUrl) return null;
    const h = await fetch(tpl.previewUrl, { headers: { "User-Agent": UA } }); if (!h.ok) return null;
    const html = await h.text(); return html && html.length > 50 ? html : null;
  } catch { return null; }
}
async function sms(contactId: string, message: string, toNumber?: string) {
  const payload: any = { type: "SMS", contactId, message }; if (toNumber) payload.toNumber = toNumber;
  const r = await ghl("POST", "/conversations/messages", payload, "2021-04-15");
  return { status: r.status, body: (await r.text()).slice(0, 400) };
}
// ---- confirmacao da troca de instancia ----
const ehAck = (m: any) => /contact\s+instance\s+updated/i.test(String(m?.body || ""));
async function lerConversa(cid: string): Promise<{ http: number; msgs: any[] }> {
  const r = await ghl("GET", `/conversations/${cid}/messages?limit=20`, null, "2021-04-15");
  if (!r.ok) return { http: r.status, msgs: [] };
  const d = await r.json().catch(() => ({}));
  const arr = d?.messages?.messages || d?.messages || [];
  return { http: 200, msgs: Array.isArray(arr) ? arr : [] };
}
// Espera o ZaptosWPP gravar a confirmacao na conversa, com dateAdded >= o dateAdded do proprio bind.
// Os dois horarios vem do GHL, entao nao ha risco de desencontro de relogio com o isolate.
async function esperarTroca(cid: string, bindId: string, janelaMs: number) {
  const t0 = Date.now(); let bindAt = 0; let http = 200;
  while (Date.now() - t0 < janelaMs) {
    const lida = await lerConversa(cid);
    http = lida.http;
    if (http !== 200) return { confirmado: null as boolean | null, ms: Date.now() - t0, http, motivo: "nao consegui ler a conversa (HTTP " + http + ")" };
    if (!bindAt) { const bm = lida.msgs.find((m: any) => m?.id === bindId); if (bm?.dateAdded) bindAt = new Date(bm.dateAdded).getTime(); }
    if (bindAt) {
      const ack = lida.msgs.find((m: any) => ehAck(m) && m?.dateAdded && new Date(m.dateAdded).getTime() >= bindAt);
      if (ack) return { confirmado: true, ms: Date.now() - t0, http, ack_em: ack.dateAdded, ack_id: ack.id };
    }
    await sleep(BIND_POLL_MS);
  }
  return { confirmado: false, ms: Date.now() - t0, http, motivo: "o app nao confirmou a troca em " + Math.round(janelaMs / 1000) + "s" };
}
async function enviarMsg(contactId: string, canal: string, texto: string, assunto?: string, templateId?: string, instancia?: string, fone?: string, nome?: string, merge?: any, opts?: any) {
  if (canal === "email") {
    let html: string | null = null; let arte_ok = false;
    if (templateId) { const raw = await arteHtml(templateId); if (raw) { html = preencher(raw, nome, texto, merge); arte_ok = true; } }
    if (!html) html = "<div>" + String(texto).replace(/\n/g, "<br>") + "</div>";
    const subj = preencher(assunto || "Nitron", nome, texto, merge);
    const r = await ghl("POST", "/conversations/messages", { type: "Email", contactId, subject: subj, html }, "2021-04-15");
    return { status: r.status, body: (await r.text()).slice(0, 400), bind: null as any, arte_ok };
  }
  const to = fone ? e164(fone) : undefined;
  const janela = Number(opts?.espera_ms) > 0 ? Number(opts.espera_ms) : BIND_ESPERA_MS;
  const margem = opts?.margem_ms !== undefined && Number(opts?.margem_ms) >= 0 ? Number(opts.margem_ms) : BIND_MARGEM_MS;
  const exigir = opts?.exigir_confirmacao === false ? false : true;
  // 1) amarra o contato na instancia certa
  const bind = await sms(contactId, `#contact_instance:${instancia}`, to);
  if (!(bind.status >= 200 && bind.status < 300)) return { status: 0, body: "", bind, troca: { confirmado: false, motivo: "o GHL recusou o proprio bind" }, recusado: "bind nao aceito — texto nao enviado" };
  let cid = ""; let bindId = "";
  try { const d = JSON.parse(bind.body); cid = String(d?.conversationId || ""); bindId = String(d?.messageId || ""); } catch { /* corpo inesperado */ }
  // 2) espera o app confirmar a troca na conversa
  let troca: any;
  if (cid && bindId) troca = await esperarTroca(cid, bindId, janela);
  else troca = { confirmado: null, motivo: "o bind nao devolveu conversationId/messageId" };
  if (troca.confirmado === false && exigir) return { status: 0, body: "", bind, troca, recusado: "troca de instancia nao confirmada — texto nao enviado para nao sair pela instancia antiga" };
  // 3) margem de acomodacao: a confirmacao diz que o app processou, nao que a sessao de envio ja pegou a troca
  const esperaTotal = troca.confirmado === true ? margem : Math.max(margem, janela - (troca.ms || 0));
  await sleep(esperaTotal);
  const res = await sms(contactId, texto, to);
  return { ...res, bind, troca: { ...troca, margem_ms: esperaTotal } };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    if (b.diag) {
      const r = await ghl("GET", `/contacts/?locationId=${LOC}&query=milton&limit=1`, null);
      const hdr: Record<string, string> = {};
      for (const kk of ["x-ratelimit-limit-daily", "x-ratelimit-daily-remaining", "x-ratelimit-interval-milliseconds", "x-ratelimit-max", "x-ratelimit-remaining", "retry-after"]) { const v = r.headers.get(kk); if (v != null) hdr[kk] = v; }
      const body = (await r.text()).slice(0, 200);
      const set = await instanciasValidas();
      return j({ diag: true, status: r.status, headers: hdr, body, instancias_cadastradas: set ? [...set] : null, bind: { espera_ms: BIND_ESPERA_MS, poll_ms: BIND_POLL_MS, margem_ms: BIND_MARGEM_MS } });
    }
    const canal = b.canal || "whatsapp";
    const texto = b.texto || "";
    const instancia = String(b.instancia || "").trim();

    // ---- TRAVA DE INSTANCIA (so WhatsApp; email nao usa instancia) ----
    if (canal !== "email") {
      if (!instancia) return j({ ok: false, motivo: "sem instancia — WhatsApp nao enviado (a mensagem sairia pela instancia errada)", sem_instancia: true });
      if (!formaOk(instancia)) return j({ ok: false, motivo: "instancia com formato invalido: " + instancia, instancia_invalida: true });
      const validas = await instanciasValidas();
      if (validas && !validas.has(instancia)) return j({ ok: false, motivo: "instancia '" + instancia + "' nao esta no cadastro instancia_ghl (ativa)", instancia_invalida: true });
    }

    // dono para o caso de o contato ainda nao existir: o usuario da instancia pedida
    const cad = await cadastro();
    const donoNovo = (instancia && cad?.idDe[instancia]) || undefined;

    let contactId: string | null = null; let via: string | undefined; let criado = false;
    if (b.test) { contactId = RENATO; via = "teste"; }
    else if (b.contact_id) { contactId = b.contact_id; via = "id"; }
    else if (canal === "email") { if (!b.email) return j({ ok: false, motivo: "sem email" }); const a = await garantirPorEmail(b.email, b.nome, b.codparc, donoNovo); contactId = a.id; via = a.via; criado = a.criado; }
    else { if (!b.fone) return j({ ok: false, motivo: "sem telefone" }); if (foneFixo(b.fone)) return j({ ok: false, motivo: "telefone fixo (sem WhatsApp)", fixo: true, fone: b.fone }); const a = await garantirPorFone(b.fone, b.nome, b.codparc, donoNovo); contactId = a.id; via = a.via; criado = a.criado; }
    // ---- TRAVA DO PROPRIETARIO (so WhatsApp): o numero de saida e o do dono do contato ----
    // Vem antes do lookup de proposito: com lookup=true a tela consegue perguntar "por quem isso
    // sairia?" sem mandar nada.
    // usar_dono=true: em vez de recusar, manda PELA dona do contato (e o [ASSISTENTE] do texto passa
    // a ser ela tambem, senao a mensagem sai coerente no numero e incoerente no texto). E o que a
    // fila usa nas campanhas de cliente. Nas de representante a divergencia e recusada de proposito:
    // ali ela significa que o CRM esta desalinhado do organograma e a gestao precisa ver.
    let dono: string | null = null;
    let instUsada = instancia;
    if (contactId && canal !== "email" && b.ignorar_dono !== true) dono = await donoDoContato(contactId);
    if (b.lookup) return j({ ok: !!contactId, contactId, via, criado, instancia: instancia || null, dono_crm: dono, dono_divergente: !!(dono && dono !== instancia) });
    if (!texto && !b.templateId && b.so_campos !== true) return j({ ok: false, motivo: "sem texto nem arte" }, 400);
    if (!contactId) return j({ ok: false, motivo: "nao foi possivel achar/criar contato no CRM", email: b.email, fone: b.fone });
    if (dono && dono !== instancia) {
      if (b.usar_dono === true) instUsada = dono;
      else return j({
        ok: false, contactId, via, criado, canal, instancia, dono_crm: dono, dono_divergente: true,
        motivo: "o contato e da " + dono + " no CRM, entao o WhatsApp sairia pelo numero dela e nao pelo da " + instancia + " — texto nao enviado. Ajuste o proprietario no CRM ou mande pela " + dono + ".",
      });
    }

    // campos do CRM antes do envio, para o template ter o que imprimir
    const camposGravados = await gravarCampos(contactId, b.campos);
    // so_campos: grava e para. Serve para conferir o de-para dos campos sem mandar mensagem nenhuma.
    if (b.so_campos === true) return j({ ok: !!camposGravados, contactId, via, criado, campos_gravados: camposGravados, motivo: camposGravados ? undefined : "nenhum campo reconhecido em `campos`" });

    // no WhatsApp o texto chega da tela ja com o [ASSISTENTE] trocado, entao se o envio passou para a
    // dona do contato o nome escrito no texto tambem precisa mudar — senao a mensagem sai do numero
    // de uma e assinada por outra.
    let textoUsado = texto; let textoAjustado = false;
    if (instUsada !== instancia && instancia && typeof texto === "string" && texto) {
      const re = new RegExp("(?<![\\p{L}\\p{N}])" + instancia.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\p{L}\\p{N}])", "giu");
      if (re.test(texto)) { textoUsado = texto.replace(re, instUsada); textoAjustado = true; }
    }
    const mergeUsado = (instUsada !== instancia && b.merge && typeof b.merge === "object") ? { ...b.merge, instancia: instUsada, assistente: instUsada } : b.merge;
    const res: any = await enviarMsg(contactId, canal, textoUsado, b.assunto, b.templateId, instUsada || undefined, b.fone, b.nome, mergeUsado, { espera_ms: b.espera_ms, margem_ms: b.margem_ms, exigir_confirmacao: b.exigir_confirmacao });
    const ok = res.status >= 200 && res.status < 300;
    return j({ ok, contactId, via, criado, canal, instancia: instUsada || null, instancia_pedida: instUsada !== instancia ? instancia : undefined, texto_ajustado: textoAjustado || undefined, campos_gravados: camposGravados || undefined, dono_crm: dono, arte: !!b.templateId, arte_ok: res.arte_ok, motivo: ok ? undefined : (res.recusado || ("GHL " + res.status + ": " + res.body)), bind_nao_confirmado: res.recusado ? true : undefined, resultado: res, teste: !!b.test });
  } catch (e) { return j({ ok: false, erro: String(e) }, 500); }
});
