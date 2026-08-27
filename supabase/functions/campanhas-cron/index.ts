// campanhas-cron — agendador MODULAR. Roda todo dia util; le a cadencia de cada campanha
// ativa e dispara (rascunho) so as que tem o dia de hoje. Add campanha = zero mexida no cron.
//
// v16: DUAS CORRECOES, as duas achadas em 26/08 ao configurar a segunda empresa.
//
//   1. FILTRO DE EMPRESA. Esta funcao lia `campanhas` com `.eq("ativa", true)` e mais nada. No
//      minuto em que a Teak ganhou catalogo proprio, as campanhas dela entraram nessa varredura.
//      Nao dispararam por sorte: nasceram sem `cadencia`, e o filtro do dia (`cadencia.includes(dia)`)
//      descarta array vazio. Ou seja, bastava alguem preencher a cadencia de uma campanha da Teak
//      para ela sair sozinha, no dia seguinte, sem ninguem pedir — e `campanhas-disparar` nem sabe
//      montar publico de lead. Agora a varredura e explicitamente da Nitron. Quando outra empresa
//      tiver agendador, ele recebe a empresa como parametro, como as outras funcoes.
//
//   2. CHAVE DE SERVICO CHUMBADA NO FONTE. O srvKey() era
//      `Deno.env.get("SRV_JWT") || "<JWT de service_role literal>" || ""`, com o JWT escrito no
//      codigo. Era o mesmo padrao das pendencias de fila-enfileirar, rep-contato e cache-refresh
//      (ja resolvidas) e da 3 (ghl-contatos-sync, aberta). Tirado: agora so o secret. Se o secret
//      faltar, a funcao FALHA — barulhenta e sem chave viva no repositorio, que e o certo dos dois
//      lados.
//
// v14: chave de servico via SRV_JWT (a SUPABASE_SERVICE_ROLE_KEY injetada pela plataforma virou
// sb_secret_ e o PostgREST recusa com PGRST303) + erro legivel + falha ruidosa quando nao le campanhas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; const p = [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | "); return p || String(e); };

// Este agendador e da Nitron. Explicito, nao esquecido — ver a nota 1 do cabecalho.
const EMPRESA = "nitron";

Deno.serve(async () => {
  try {
    const SUPA = Deno.env.get("SUPABASE_URL")!;
    const SRV = srvKey();
    if (!SRV) throw new Error("sem chave de servico: defina o secret SRV_JWT");
    const sb = createClient(SUPA, SRV);
    const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" }).format(new Date()).toLowerCase();
    const dia = wd.startsWith("seg") ? "seg" : wd.startsWith("ter") ? "ter" : wd.startsWith("qua") ? "qua" : wd.startsWith("qui") ? "qui" : wd.startsWith("sex") ? "sex" : wd.startsWith("sá") ? "sab" : "dom";
    const { data: camps, error: eCamps } = await sb.from("campanhas").select("codigo,cadencia").eq("ativa", true).eq("empresa", EMPRESA);
    if (eCamps) throw eCamps;
    const doDia = (camps || []).filter((c: any) => Array.isArray(c.cadencia) && c.cadencia.includes(dia));
    const res = [];
    for (const c of doDia) {
      try {
        const r = await fetch(`${SUPA}/functions/v1/campanhas-disparar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SRV}` }, body: JSON.stringify({ codigo: c.codigo, modo: "rascunho" }) });
        const d = await r.json();
        res.push({ codigo: c.codigo, gerados: d.gerados ?? 0, erro: d.erro });
      } catch (e) { res.push({ codigo: c.codigo, erro: detalhar(e) }); }
    }
    const falhas = res.filter((r: any) => r.erro).length;
    return new Response(JSON.stringify({ empresa: EMPRESA, dia, campanhas_ativas: (camps || []).length, campanhas_do_dia: doDia.map((c: any) => c.codigo), falhas, resultado: res }), { status: falhas ? 500 : 200, headers: { "Content-Type": "application/json" } });
  } catch (e) { return new Response(JSON.stringify({ erro: detalhar(e) }), { status: 500, headers: { "Content-Type": "application/json" } }); }
});
