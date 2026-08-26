// campanha-dono (v3) — empresta e devolve a propriedade dos contatos de uma campanha de cliente.
//
// Por que existe: o numero de WhatsApp que o cliente ve e o do usuario remetente, e numa mensagem de
// API o remetente e o assignedTo do contato. Testamos `fromNumber` em 26/08 com o numero novo: o GHL
// IGNORA — a mensagem foi gravada com o userId da dona do contato. Logo, para a campanha sair pelo
// numero dela, a instancia de campanha tem de ser dona do contato no momento do envio.
//
// Isso e um EMPRESTIMO, nao uma troca de carteira: o dono anterior fica guardado em
// campanha_dono_emprestado e `devolver` recoloca cada um no lugar. Sem esse registro, devolver seria
// adivinhar — e foi exatamente esse tipo de troca cega que a gestao tirou do CRM.
//
// POST { acao:"assumir", itens:[{fone,nome?,codparc?}], campanha?, criar? }
// POST { acao:"devolver", campanha? }   -> devolve todos os emprestados em aberto
// POST { acao:"varrer" }                -> quem RESPONDEU vai para os destinos de plantao
// Qualquer uma aceita { seco:true } para so relatar.
//
// CRIAR: os leads enriquecidos do Motor NAO existem como contato no GHL — conferido em 26/08, uma
// busca por contains_set nos telefones deles devolve zero. O contato so nasceria na hora do envio, e
// nasceria SEM dono, o que e o pior caso (numero de saida indefinido). Entao com `criar` a gente cria
// o contato ja pertencendo a instancia de campanha, com nome e codparc, antes de qualquer envio.
// (O campanhas-enviar v26 tambem passou a criar contato ja com dono, entao este caminho e para quando
// se quer o contato pronto ANTES do disparo.)
//
// v3: o registro do emprestimo virou obrigatorio. Na primeira corrida de verdade (26/08) o upsert
// falhou calado — o indice unico era PARCIAL e ON CONFLICT nao o aceita como alvo — e 9 contatos
// trocaram de dono SEM registro do dono anterior, exatamente o caso que a tabela existe para evitar.
// Agora o conflito e por (contact_id, campanha), com constraint de verdade, e o erro do registro FAZ
// a linha falhar: se nao da para anotar de quem era, e melhor nao tomar emprestado.
//
// `varrer` cobre o periodo em que ainda nao existe o workflow no CRM: pergunta ao GHL quais conversas
// da instancia de campanha tem a ULTIMA mensagem de entrada e reparte esses contatos entre os
// destinos de campanha_resposta_destino, por peso. Quem atende e DADO, nao codigo: mudar de pessoa e
// um update na tabela. O reparto olha o historico ja entregue, entao a divisao continua par entre
// rodadas, e nao so dentro de uma. Cliente que respondeu nao pode ficar numa caixa que ninguem atende.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const digits = (s: any) => String(s || "").replace(/\D/g, "");
const nf = (s: any) => digits(s).replace(/^0+/, "").replace(/^55/, "");
function e164(f: any): string { const d = digits(f); if (!d) return ""; return d.length <= 11 ? "+55" + d : "+" + d; }
function variantes(fone: any): string[] {
  const d = nf(fone); if (d.length < 10) return [];
  const out = new Set<string>([d]);
  if (d.length === 10) out.add(d.slice(0, 2) + "9" + d.slice(2));
  if (d.length === 11 && d[2] === "9") out.add(d.slice(0, 2) + d.slice(3));
  return [...out];
}
const API = "https://services.leadconnectorhq.com";
// v: locationId E TOKEN saem do fonte e vem do cadastro `empresa`. Cada empresa do grupo e uma
// SUBCONTA (location) diferente do mesmo GHL, e o token do GHL e escopado por location:
// conferido em 26/08, o token da Nitron responde 403 "The token does not have access to this
// location" na location da Teak. Mandar para a subconta errada cria contato no CRM errado.
// Os dois sao passados como ARGUMENTO, nunca guardados em variavel de modulo: estado de modulo e
// compartilhado pelo isolate, e duas requisicoes de empresas diferentes ao mesmo tempo poderiam
// trocar o valor no meio da operacao.
// O loader esta repetido nas funcoes que precisam dele de proposito: cada Edge Function e um
// deploy independente, e um import compartilhado significaria redeployar todas juntas.
type EmpGhl = { loc: string; tok: string };
const empGhlCache: Record<string, { at: number; v: EmpGhl }> = {};
async function empresaGhl(id: string): Promise<EmpGhl> {
  const hit = empGhlCache[id];
  if (hit && Date.now() - hit.at < 300000) return hit.v;
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""); const k = srvKey();
  if (!base || !k) throw new Error("sem SUPABASE_URL/chave de servico para ler o cadastro de empresa");
  const r = await fetch(`${base}/rest/v1/empresa?painel_id=eq.${encodeURIComponent(id)}&select=ghl_location,ghl_token_env`, { headers: { apikey: k, Authorization: "Bearer " + k } });
  if (!r.ok) throw new Error("cadastro de empresa: HTTP " + r.status);
  const rows = await r.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  const loc = row?.ghl_location ? String(row.ghl_location) : "";
  if (!loc) throw new Error(`empresa "${id}" sem ghl_location no cadastro — operacao recusada`);
  const tokEnv = String(row?.ghl_token_env || "GHL_TOKEN");
  const tok = Deno.env.get(tokEnv) || Deno.env.get("GHL_TOKEN") || "";
  if (!tok) throw new Error(`sem token do GHL para "${id}": o secret ${tokEnv} nao existe nas Edge Functions`);
  const v: EmpGhl = { loc, tok };
  empGhlCache[id] = { at: Date.now(), v };
  return v;
}
const FID_CODPARC = "HaDWHgnJSjDDdPF7XFDH";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
function ghl(tok: string, method: string, path: string, body?: any) {
  return fetch(API + path, { method, headers: { "Authorization": "Bearer " + Deno.env.get("GHL_TOKEN"), "Version": "2021-07-28", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA }, body: body ? JSON.stringify(body) : undefined });
}
async function acharPorFone(g: EmpGhl, fone: string): Promise<any> {
  for (const v of variantes(fone)) {
    for (const q of [e164(v), v]) {
      try {
        const r = await ghl(g.tok, "GET", `/contacts/?locationId=${g.loc}&query=${encodeURIComponent(q)}&limit=1`);
        if (!r.ok) continue;
        const d = await r.json();
        const c = (d?.contacts || [])[0];
        if (c?.id) return c;
      } catch { /* tenta a proxima forma */ }
    }
  }
  return null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const acao = String(b.acao || "").trim();
    const seco = b.seco === true;
    const campanha = b.campanha ? String(b.campanha) : null;
    // empresa primeiro: sem location resolvida esta funcao nao fala com o GHL.
    const empId = String(b.empresa || "nitron");
    const g = await empresaGhl(empId);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());

    // a instancia de campanha e a de escopo cliente, ativa
    const { data: instCli } = await sb.from("instancia_ghl").select("instancia,usuario_ghl_id").eq("ativa", true).eq("escopo", "cliente").order("instancia").limit(1).maybeSingle();
    if (!instCli?.usuario_ghl_id) return j({ ok: false, erro: "nenhuma instancia de escopo 'cliente' ativa com usuario_ghl_id no cadastro" }, 400);
    const alvo = String(instCli.usuario_ghl_id);

    if (acao === "assumir") {
      // aceita ["11999999999"] ou [{fone,nome,codparc}] — a segunda forma deixa o contato criado com
      // nome de gente em vez de "Contato +5511..."
      const bruto: any[] = Array.isArray(b.itens) ? b.itens : (Array.isArray(b.fones) ? b.fones : []);
      const itens = bruto.map((x: any) => (typeof x === "object" && x ? { fone: String(x.fone || ""), nome: x.nome ? String(x.nome) : "", codparc: x.codparc || null } : { fone: String(x), nome: "", codparc: null })).filter((x: any) => x.fone);
      if (!itens.length) return j({ ok: false, erro: "sem itens" }, 400);
      const criar = b.criar !== false;
      const out: any[] = [];
      for (const it of itens) {
        const f = it.fone;
        const c = await acharPorFone(g, f);
        if (!c?.id) {
          if (!criar) { out.push({ fone: f, acao: "nao_achei_no_crm" }); continue; }
          if (seco) { out.push({ fone: f, acao: "criaria", nome: it.nome || null }); continue; }
          const campos: any = { locationId: g.loc, phone: e164(f), firstName: it.nome || ("Cliente " + e164(f)), assignedTo: alvo };
          if (it.codparc) campos.customFields = [{ id: FID_CODPARC, value: String(it.codparc) }];
          const rc = await ghl(g.tok, "POST", "/contacts/upsert", campos);
          const dc = await rc.json().catch(() => ({}));
          const id = dc?.contact?.id || null;
          if (!id) { out.push({ fone: f, acao: "erro", motivo: "upsert " + rc.status }); continue; }
          const { error: eReg } = await sb.from("campanha_dono_emprestado").upsert(
            { contact_id: id, fone: f, dono_antes: null, dono_depois: alvo, campanha },
            { onConflict: "contact_id,campanha", ignoreDuplicates: false },
          );
          if (eReg) { out.push({ fone: f, contato: id, acao: "erro", motivo: "criado, mas o registro falhou: " + (eReg.message || eReg) }); continue; }
          out.push({ fone: f, contato: id, acao: "criado_na_campanha" });
          continue;
        }
        const antes = String(c.assignedTo || "") || null;
        if (antes === alvo) { out.push({ fone: f, contato: c.id, acao: "ja_era_da_campanha" }); continue; }
        if (seco) { out.push({ fone: f, contato: c.id, acao: "assumiria", dono_antes: antes }); continue; }
        // ANOTA ANTES DE TROCAR. Trocar primeiro e anotar depois deixa a porta aberta para o caso de
        // 26/08: a troca vale e o registro nao, e nao se sabe mais para quem devolver.
        const { error: eReg2 } = await sb.from("campanha_dono_emprestado").upsert(
          { contact_id: c.id, fone: f, dono_antes: antes, dono_depois: alvo, campanha },
          { onConflict: "contact_id,campanha", ignoreDuplicates: false },
        );
        if (eReg2) { out.push({ fone: f, contato: c.id, acao: "erro", motivo: "nao consegui registrar o dono anterior, nada foi trocado: " + (eReg2.message || eReg2) }); continue; }
        const r = await ghl(g.tok, "PUT", `/contacts/${c.id}`, { assignedTo: alvo });
        if (!r.ok) {
          // desfaz o registro, senao fica dizendo que tomou emprestado algo que nao tomou
          // campanha pode ser nula; eq(null) nao filtra o que se espera, entao usa is()
          const desfaz = sb.from("campanha_dono_emprestado").delete().eq("contact_id", c.id);
          await (campanha ? desfaz.eq("campanha", campanha) : desfaz.is("campanha", null));
          out.push({ fone: f, contato: c.id, acao: "erro", motivo: "PUT " + r.status }); continue;
        }
        out.push({ fone: f, contato: c.id, acao: "assumido", dono_antes: antes });
      }
      const cont: Record<string, number> = {}; out.forEach((o) => cont[o.acao] = (cont[o.acao] || 0) + 1);
      return j({ ok: true, acao, seco, instancia: instCli.instancia, total: out.length, contagem: cont, itens: out });
    }

    if (acao === "devolver") {
      let q = sb.from("campanha_dono_emprestado").select("*").is("devolvido_em", null);
      if (campanha) q = q.eq("campanha", campanha);
      const { data: abertos, error } = await q; if (error) throw error;
      const out: any[] = [];
      for (const e of (abertos || [])) {
        if (seco) { out.push({ contato: e.contact_id, acao: "devolveria", para: e.dono_antes }); continue; }
        // sem dono anterior nao ha para onde devolver sem inventar; a varredura resolve pelo ERP
        if (!e.dono_antes) { out.push({ contato: e.contact_id, acao: "sem_dono_anterior" }); continue; }
        const r = await ghl(g.tok, "PUT", `/contacts/${e.contact_id}`, { assignedTo: e.dono_antes });
        if (!r.ok) { out.push({ contato: e.contact_id, acao: "erro", motivo: "PUT " + r.status }); continue; }
        await sb.from("campanha_dono_emprestado").update({ devolvido_em: new Date().toISOString(), devolvido_para: e.dono_antes }).eq("id", e.id);
        out.push({ contato: e.contact_id, acao: "devolvido", para: e.dono_antes });
      }
      const cont: Record<string, number> = {}; out.forEach((o) => cont[o.acao] = (cont[o.acao] || 0) + 1);
      return j({ ok: true, acao, seco, total: out.length, contagem: cont, itens: out });
    }

    if (acao === "varrer") {
      // conversas da instancia de campanha cuja ULTIMA mensagem e de ENTRADA = cliente respondeu
      const r = await ghl(g.tok, "GET", `/conversations/search?locationId=${g.loc}&assignedTo=${alvo}&lastMessageDirection=inbound&limit=100`);
      if (!r.ok) return j({ ok: false, erro: "conversations/search " + r.status + ": " + (await r.text()).slice(0, 200) }, 502);
      const d = await r.json().catch(() => ({}));
      const convs = d?.conversations || [];

      // quem esta de plantao, e quanto cada um ja recebeu (para o rateio nao desandar entre rodadas)
      const { data: destinos, error: eD } = await sb.from("campanha_resposta_destino").select("usuario_ghl_id,nome,peso").eq("ativo", true).order("usuario_ghl_id"); if (eD) throw eD;
      if (!destinos || !destinos.length) return j({ ok: false, erro: "campanha_resposta_destino sem ninguem ativo — nao ha para quem mandar a resposta" }, 400);
      const { data: ja } = await sb.from("campanha_dono_emprestado").select("devolvido_para").not("devolvido_para", "is", null);
      const conta: Record<string, number> = {};
      destinos.forEach((x: any) => conta[x.usuario_ghl_id] = 0);
      (ja || []).forEach((x: any) => { const k = String(x.devolvido_para); if (k in conta) conta[k]++; });
      // proximo = quem esta mais atras do proprio peso (rateio ponderado, nao round-robin cego)
      const proximo = () => destinos.slice().sort((a: any, b: any) =>
        (conta[a.usuario_ghl_id] / Math.max(1, a.peso)) - (conta[b.usuario_ghl_id] / Math.max(1, b.peso))
        || String(a.usuario_ghl_id).localeCompare(String(b.usuario_ghl_id)))[0];

      const out: any[] = [];
      for (const c of convs) {
        const cid = String(c?.contactId || "");
        if (!cid) continue;
        const dest = proximo();
        if (seco) { out.push({ contato: cid, acao: "iria_para", para: dest.nome }); conta[dest.usuario_ghl_id]++; continue; }
        const r2 = await ghl(g.tok, "PUT", `/contacts/${cid}`, { assignedTo: dest.usuario_ghl_id });
        if (!r2.ok) { out.push({ contato: cid, acao: "erro", motivo: "PUT " + r2.status }); continue; }
        conta[dest.usuario_ghl_id]++;
        await sb.from("campanha_dono_emprestado").update({ devolvido_em: new Date().toISOString(), devolvido_para: dest.usuario_ghl_id }).eq("contact_id", cid).is("devolvido_em", null);
        await sb.from("resposta_roteada").insert({ contact_id: cid, acao: "atribuido", instancia: instCli.instancia, usuario_ghl_id: dest.usuario_ghl_id, motivo: "respondeu a campanha · rateio para " + dest.nome });
        out.push({ contato: cid, acao: "entregue", para: dest.nome });
      }
      const cont: Record<string, number> = {}; out.forEach((o) => cont[o.acao] = (cont[o.acao] || 0) + 1);
      const porPessoa: Record<string, number> = {}; destinos.forEach((x: any) => porPessoa[x.nome] = conta[x.usuario_ghl_id]);
      return j({ ok: true, acao, seco, responderam: convs.length, contagem: cont, acumulado_por_pessoa: porPessoa, itens: out });
    }

    return j({ ok: false, erro: "acao deve ser assumir, devolver ou varrer" }, 400);
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
