// campanhas-enviar (v29) — email com ARTE + {{...}}. Garante contato. WhatsApp via SMS+#contact_instance. Recusa WhatsApp para telefone FIXO (10 digitos). ?diag mostra rate-limit.
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
// v28: A ARTE DO VOUCHER SAIA COM OS NUMEROS EM BRANCO. Quem troca as {{...}} do template somos nos
//      (a gente baixa o HTML e renderiza aqui), e o mapa do preencher() nao conhecia
//      contact.voucher_positivacao / adicional_positivacao / total_pontos / voucher_validade — as
//      quatro tags que o template "Campanha de Positivacao" usa. Tag desconhecida sai VAZIA, entao o
//      e-mail iria com "desconto total de  %" e "valido ate ". Agora id do campo e merge tag moram na
//      MESMA tabela (CAMPO), e o valor vem do mesmo `campos` que e gravado no contato.
//      Junto vem `previa: true`: devolve a arte preenchida pelo mesmo caminho do envio, sem mandar
//      nada, e lista as tags que ficaram sem valor. A tela mostra o resultado real antes do disparo.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// v29: MULTI-EMPRESA. locationId, ids de campo personalizado, contato de teste e marca sairam do
//      fonte e vao para o cadastro `empresa`. Cada empresa do grupo e uma SUBCONTA (location)
//      diferente do mesmo GHL, e mandar para a subconta errada cria contato no CRM errado.
//      Duas escolhas de proposito aqui:
//      (a) a empresa e passada como ARGUMENTO por toda a cadeia, nunca guardada em variavel de
//          modulo. Estado de modulo e compartilhado pelo isolate: duas requisicoes de empresas
//          diferentes ao mesmo tempo poderiam trocar o locationId no meio do envio, e o resultado
//          seria mensagem pela subconta errada — o pior defeito possivel nesta funcao.
//      (b) as MERGE TAGS ficam no codigo e so os IDS vem do cadastro. A tag e contrato do template
//          ({{contact.voucher_positivacao}}); o id do campo e por location. Sao coisas diferentes
//          com ciclos de vida diferentes.
const API = "https://services.leadconnectorhq.com";

// ---- cadastro da empresa (cache de 5 min por empresa, por isolate) ----
type Empresa = {
  painel_id: string; nome: string; marca: string; loc: string;
  campos: Record<string, string>; teste_contact_id: string | null;
};
const empCache: Record<string, { at: number; e: Empresa }> = {};
async function carregarEmpresa(id: string): Promise<Empresa> {
  const hit = empCache[id];
  if (hit && Date.now() - hit.at < 300000) return hit.e;
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""); const k = srvKey();
  if (!base || !k) throw new Error("sem SUPABASE_URL/chave de servico para ler o cadastro de empresa");
  const r = await fetch(`${base}/rest/v1/empresa?painel_id=eq.${encodeURIComponent(id)}&select=painel_id,nome,marca,ghl_location,campos,teste_contact_id`, { headers: { apikey: k, Authorization: "Bearer " + k } });
  if (!r.ok) throw new Error("cadastro de empresa: HTTP " + r.status);
  const rows = await r.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error(`empresa "${id}" nao esta no cadastro`);
  // Sem locationId nao ha para onde mandar. Recusar alto: chutar location e criar contato na
  // subconta errada, que e irreversivel na pratica.
  if (!row.ghl_location) throw new Error(`empresa "${id}" sem ghl_location no cadastro — envio recusado`);
  const e: Empresa = {
    painel_id: String(row.painel_id), nome: String(row.nome || id),
    marca: String(row.marca || row.nome || id), loc: String(row.ghl_location),
    campos: (row.campos && typeof row.campos === "object") ? row.campos : {},
    teste_contact_id: row.teste_contact_id ? String(row.teste_contact_id) : null,
  };
  empCache[id] = { at: Date.now(), e };
  return e;
}
// De-para das chaves semanticas para o campo personalizado do GHL. Uma tabela so, com o id (para
// gravar no contato) E a merge tag (para preencher na arte). Eram duas listas separadas e isso e
// pedir para divergirem: bastava o template usar {{contact.voucher_validade}} e o preencher() nao
// conhecer a tag para o e-mail sair com o percentual em branco — que era exatamente o caso.
// Os tres primeiros ja existiam (da positivacao) e sao alimentados tambem por outro processo, no
// contato da empresa; aqui a gente preenche no contato que recebe. O de validade foi criado em 26/08.
// A merge tag e contrato do TEMPLATE e nao muda por empresa. O id do campo muda: e por location.
// Por isso a tag fica aqui e o id vem de empresa.campos — antes os dois estavam juntos no fonte, o
// que funcionava para uma empresa so.
const TAG: Record<string, string> = {
  voucher_pct: "contact.voucher_positivacao",       // PERC_VOUCHER
  voucher_adic: "contact.adicional_positivacao",    // PERC_ADIC
  voucher_total: "contact.total_pontos",            // a soma
  voucher_validade: "contact.voucher_validade",     // "31/08/2026"
};
// Grava no contato os campos pedidos. Devolve o que foi gravado, ou null quando nao havia nada.
// Campo que a empresa nao tem cadastrado e simplesmente ignorado: a Teak, por exemplo, nao tem
// campo de voucher nenhum porque nao tem Clube, e isso nao e erro.
async function gravarCampos(emp: Empresa, contactId: string, campos: any): Promise<string[] | null> {
  if (!campos || typeof campos !== "object") return null;
  const cf = Object.keys(campos)
    .filter((k) => emp.campos[k] && campos[k] !== null && campos[k] !== undefined && String(campos[k]) !== "")
    .map((k) => ({ id: emp.campos[k], value: String(campos[k]) }));
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
// Uma entrada de cache por empresa: instancia_ghl agora tem dono, e misturar o cadastro de duas
// empresas faria a trava de instancia aceitar um token que nao e da empresa que esta enviando.
const instCache: Record<string, { at: number; c: Cadastro }> = {};
async function cadastro(emp: Empresa): Promise<Cadastro | null> {
  const hit = instCache[emp.painel_id];
  if (hit && Date.now() - hit.at < 300000) return hit.c;
  try {
    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""); const k = srvKey();
    if (!base || !k) return null;
    const r = await fetch(`${base}/rest/v1/instancia_ghl?ativa=eq.true&empresa=eq.${encodeURIComponent(emp.painel_id)}&select=instancia,usuario_ghl_id`, { headers: { apikey: k, Authorization: "Bearer " + k } });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const set = new Set<string>(rows.map((x: any) => String(x.instancia)));
    const porUsuario: Record<string, string> = {}; const idDe: Record<string, string> = {};
    rows.forEach((x: any) => { if (x.usuario_ghl_id) { porUsuario[String(x.usuario_ghl_id)] = String(x.instancia); idDe[String(x.instancia)] = String(x.usuario_ghl_id); } });
    const c = { set, porUsuario, idDe };
    instCache[emp.painel_id] = { at: Date.now(), c };
    return c;
  } catch { return null; }
}
async function instanciasValidas(emp: Empresa): Promise<Set<string> | null> { const c = await cadastro(emp); return c ? c.set : null; }
// Quem o CRM diz que e o dono do contato — e portanto por qual numero o WhatsApp vai sair.
// null = nao deu para saber; "" = tem dono, mas ele nao e instancia nenhuma do cadastro ativo.
async function donoDoContato(emp: Empresa, contactId: string): Promise<string | null> {
  const c = await cadastro(emp); if (!c) return null;
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
function preencher(emp: Empresa, str: string, nome?: string, texto?: string, merge?: any, campos?: any): string {
  if (!str) return str;
  const full = String(nome || "").trim(); const first = full.split(/\s+/)[0] || ""; const last = full.split(/\s+/).slice(1).join(" ");
  const msg = String(texto || "").replace(/\n/g, "<br>"); const m = merge || {};
  const map: Record<string, string> = {
    "contact.first_name": first, "first_name": first, "nome": first, "primeiro_nome": first,
    "contact.name": full || first, "contact.full_name": full || first, "nome_completo": full || first,
    "contact.last_name": last, "sobrenome": last,
    "document.recipient.firstname": first, "document.recipient.lastname": last,
    // A marca vem do cadastro: com "Nitron" fixo aqui, uma campanha da Teak sairia assinada
    // como Nitron. As chaves "nitron"/"empresa_nitron" continuam existindo porque templates
    // antigos da Nitron as usam pelo nome — nao vou quebrar arte publicada.
    "location.name": emp.marca, "user.name": emp.marca, "marca": emp.marca,
    "nitron": "Nitron", "empresa_nitron": "Nitron",
    "mensagem": msg, "corpo": msg, "texto": msg,
    "cliente": String(m.cliente || m.empresa || full || ""), "empresa": String(m.empresa || m.cliente || full || ""),
    "saldo": String(m.saldo || ""), "validade": String(m.validade || ""), "valor": String(m.valor || m.saldo || ""), "dias": String(m.dias || ""), "lista": String(m.lista || ""),
    "rep": String(m.rep || ""), "representante": String(m.rep || ""), "assistente": String(m.instancia || m.assistente || ""),
  };
  // As tags dos campos personalizados. Quem renderiza a arte aqui somos nos, nao o GHL: a gente baixa
  // o HTML do template e troca as {{...}} — entao tag que o mapa nao conhece sai VAZIA. Sem estas
  // quatro linhas o e-mail do voucher saia com percentual e validade em branco, mesmo com o campo
  // gravado no contato. O valor vem de `campos` (o mesmo que foi escrito no CRM), com o merge como
  // reserva, para prévia, e-mail e campo do contato dizerem sempre a mesma coisa.
  const cp = campos && typeof campos === "object" ? campos : {};
  const reserva: Record<string, unknown> = { voucher_total: m.saldo, voucher_validade: m.validade };
  // o template imprime o "%" ele mesmo ({{contact.total_pontos}} %), entao o valor vai sem sinal —
  // senao sai "6% %". Na validade nao se mexe: e texto ("31/08/2026").
  const so = (v: string, chave: string) => chave === "voucher_validade" ? v : v.replace(/\s*%\s*$/, "").trim();
  for (const [chave, tag] of Object.entries(TAG)) {
    const v = cp[chave] !== undefined && cp[chave] !== null && String(cp[chave]) !== "" ? cp[chave] : reserva[chave];
    const txt = v === undefined || v === null ? "" : so(String(v), chave);
    map[tag.toLowerCase()] = txt;
    map[tag.replace(/^contact\./, "").toLowerCase()] = txt;   // aceita a tag sem o prefixo
  }
  return str.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_full, key) => { const k = String(key).trim().toLowerCase(); return (k in map) ? map[k] : ""; });
}
async function buscarUm(emp: Empresa, q: string): Promise<any> {
  try { const r = await ghl("GET", `/contacts/?locationId=${emp.loc}&query=${encodeURIComponent(q)}&limit=1`, null); const d = await r.json(); return (d?.contacts || [])[0] || null; } catch { return null; }
}
async function upsertContato(emp: Empresa, fields: any): Promise<string | null> {
  try { const r = await ghl("POST", "/contacts/upsert", { locationId: emp.loc, ...fields }); const d = await r.json().catch(() => ({})); return d?.contact?.id || null; } catch { return null; }
}
// O campo de CODPARC tambem e por location: `campos.codparc` do cadastro. Empresa sem esse campo
// cadastrado grava o contato sem CODPARC em vez de mandar um id de campo de outra subconta, que o
// GHL aceitaria calado e gravaria no campo errado.
async function garantirPorFone(emp: Empresa, fone: string, nome?: string, codparc?: any, dono?: string) {
  for (const v of foneVariants(fone)) { const c = await buscarUm(emp, v); if (c?.id) return { id: c.id, via: "fone:" + v, criado: false }; }
  const fields: any = { phone: e164(fone), firstName: nome || ("Contato " + e164(fone)) };
  if (codparc && emp.campos.codparc) fields.customFields = [{ id: emp.campos.codparc, value: String(codparc) }];
  if (dono) fields.assignedTo = dono;   // nasce com dono: sem isso o numero de saida fica indefinido
  return { id: await upsertContato(emp, fields), via: "criado", criado: true };
}
async function garantirPorEmail(emp: Empresa, email: string, nome?: string, codparc?: any, dono?: string) {
  const c = await buscarUm(emp, email.trim()); if (c?.id) return { id: c.id, via: "email", criado: false };
  const fields: any = { email: email.trim(), firstName: nome || email.trim() };
  if (codparc && emp.campos.codparc) fields.customFields = [{ id: emp.campos.codparc, value: String(codparc) }];
  if (dono) fields.assignedTo = dono;
  return { id: await upsertContato(emp, fields), via: "criado", criado: true };
}
async function arteHtml(emp: Empresa, templateId: string): Promise<string | null> {
  try {
    const r = await ghl("GET", `/emails/builder?locationId=${emp.loc}&limit=100`, null);
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
async function enviarMsg(emp: Empresa, contactId: string, canal: string, texto: string, assunto?: string, templateId?: string, instancia?: string, fone?: string, nome?: string, merge?: any, opts?: any) {
  if (canal === "email") {
    let html: string | null = null; let arte_ok = false;
    if (templateId) { const raw = await arteHtml(emp, templateId); if (raw) { html = preencher(emp, raw, nome, texto, merge, opts?.campos); arte_ok = true; } }
    if (!html) html = "<div>" + String(texto).replace(/\n/g, "<br>") + "</div>";
    const subj = preencher(emp, assunto || emp.marca, nome, texto, merge, opts?.campos);
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
    // A empresa e a PRIMEIRA coisa resolvida: locationId, ids de campo e marca dependem dela, e
    // sem cadastro valido esta funcao nao manda nada. Default 'nitron' para nao quebrar quem
    // chama sem o campo (a fila e o painel antigos).
    const emp = await carregarEmpresa(String(b.empresa || "nitron"));
    if (b.diag) {
      const r = await ghl("GET", `/contacts/?locationId=${emp.loc}&query=milton&limit=1`, null);
      const hdr: Record<string, string> = {};
      for (const kk of ["x-ratelimit-limit-daily", "x-ratelimit-daily-remaining", "x-ratelimit-interval-milliseconds", "x-ratelimit-max", "x-ratelimit-remaining", "retry-after"]) { const v = r.headers.get(kk); if (v != null) hdr[kk] = v; }
      const body = (await r.text()).slice(0, 200);
      const set = await instanciasValidas(emp);
      return j({ diag: true, status: r.status, headers: hdr, body, empresa: emp.painel_id, location: emp.loc, campos_cadastrados: Object.keys(emp.campos), instancias_cadastradas: set ? [...set] : null, bind: { espera_ms: BIND_ESPERA_MS, poll_ms: BIND_POLL_MS, margem_ms: BIND_MARGEM_MS } });
    }
    const canal = b.canal || "whatsapp";
    const texto = b.texto || "";
    const instancia = String(b.instancia || "").trim();

    // ---- PREVIA: devolve a arte JA preenchida, sem tocar em contato nem mandar nada ----
    // Passa pelo mesmo arteHtml() + preencher() do envio de verdade, de proposito: previa que usa
    // outro caminho mente. Se a tag do template nao estiver no de-para, ela sai vazia aqui tambem —
    // e e isso que a tela precisa mostrar, para a pessoa ver o buraco ANTES de disparar.
    if (b.previa === true) {
      const raw = b.templateId ? await arteHtml(emp, b.templateId) : null;
      if (b.templateId && !raw) return j({ ok: false, previa: true, motivo: "nao consegui baixar o HTML desta arte no GHL", template_id: b.templateId });
      const base = raw || ("<div style=\"font:15px/1.5 system-ui,sans-serif;padding:18px\">" + String(texto).replace(/\n/g, "<br>") + "</div>");
      const html = preencher(emp, base, b.nome, texto, b.merge, b.campos);
      // que tags o template pede e quais delas ficaram sem valor — o aviso mais util da tela
      const tags = [...new Set([...String(base).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((x) => String(x[1])))];
      const vazias = tags.filter((t) => !String(preencher(emp, "{{" + t + "}}", b.nome, texto, b.merge, b.campos)).trim());
      return j({ ok: true, previa: true, empresa: emp.painel_id, arte: !!raw, template_id: b.templateId || null, assunto: preencher(emp, b.assunto || "", b.nome, texto, b.merge, b.campos), html, tags, tags_vazias: vazias });
    }

    // ---- TRAVA DE INSTANCIA (so WhatsApp; email nao usa instancia) ----
    if (canal !== "email") {
      if (!instancia) return j({ ok: false, motivo: "sem instancia — WhatsApp nao enviado (a mensagem sairia pela instancia errada)", sem_instancia: true });
      if (!formaOk(instancia)) return j({ ok: false, motivo: "instancia com formato invalido: " + instancia, instancia_invalida: true });
      const validas = await instanciasValidas(emp);
      if (validas && !validas.has(instancia)) return j({ ok: false, motivo: "instancia '" + instancia + "' nao esta no cadastro instancia_ghl (ativa) da empresa " + emp.painel_id, instancia_invalida: true });
    }

    // dono para o caso de o contato ainda nao existir: o usuario da instancia pedida
    const cad = await cadastro(emp);
    const donoNovo = (instancia && cad?.idDe[instancia]) || undefined;

    let contactId: string | null = null; let via: string | undefined; let criado = false;
    if (b.test) {
      // Contato de teste e POR LOCATION: um id da Nitron nao existe na subconta da Teak, e o
      // "teste" passaria sem testar nada.
      if (!emp.teste_contact_id) return j({ ok: false, motivo: "empresa " + emp.painel_id + " nao tem teste_contact_id no cadastro — passe contact_id de um contato desta location", sem_contato_teste: true });
      contactId = emp.teste_contact_id; via = "teste";
    }
    else if (b.contact_id) { contactId = b.contact_id; via = "id"; }
    else if (canal === "email") { if (!b.email) return j({ ok: false, motivo: "sem email" }); const a = await garantirPorEmail(emp, b.email, b.nome, b.codparc, donoNovo); contactId = a.id; via = a.via; criado = a.criado; }
    else { if (!b.fone) return j({ ok: false, motivo: "sem telefone" }); if (foneFixo(b.fone)) return j({ ok: false, motivo: "telefone fixo (sem WhatsApp)", fixo: true, fone: b.fone }); const a = await garantirPorFone(emp, b.fone, b.nome, b.codparc, donoNovo); contactId = a.id; via = a.via; criado = a.criado; }
    // ---- TRAVA DO PROPRIETARIO (so WhatsApp): o numero de saida e o do dono do contato ----
    // Vem antes do lookup de proposito: com lookup=true a tela consegue perguntar "por quem isso
    // sairia?" sem mandar nada.
    // usar_dono=true: em vez de recusar, manda PELA dona do contato (e o [ASSISTENTE] do texto passa
    // a ser ela tambem, senao a mensagem sai coerente no numero e incoerente no texto). E o que a
    // fila usa nas campanhas de cliente. Nas de representante a divergencia e recusada de proposito:
    // ali ela significa que o CRM esta desalinhado do organograma e a gestao precisa ver.
    let dono: string | null = null;
    let instUsada = instancia;
    if (contactId && canal !== "email" && b.ignorar_dono !== true) dono = await donoDoContato(emp, contactId);
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
    const camposGravados = await gravarCampos(emp, contactId, b.campos);
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
    const res: any = await enviarMsg(emp, contactId, canal, textoUsado, b.assunto, b.templateId, instUsada || undefined, b.fone, b.nome, mergeUsado, { espera_ms: b.espera_ms, margem_ms: b.margem_ms, exigir_confirmacao: b.exigir_confirmacao, campos: b.campos });
    const ok = res.status >= 200 && res.status < 300;
    return j({ ok, empresa: emp.painel_id, contactId, via, criado, canal, instancia: instUsada || null, instancia_pedida: instUsada !== instancia ? instancia : undefined, texto_ajustado: textoAjustado || undefined, campos_gravados: camposGravados || undefined, dono_crm: dono, arte: !!b.templateId, arte_ok: res.arte_ok, motivo: ok ? undefined : (res.recusado || ("GHL " + res.status + ": " + res.body)), bind_nao_confirmado: res.recusado ? true : undefined, resultado: res, teste: !!b.test });
  } catch (e) { return j({ ok: false, erro: String(e) }, 500); }
});
