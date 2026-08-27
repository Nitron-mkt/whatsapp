// gestor — entrega as paginas do painel que estao no storage 'app'.
//
//   /functions/v1/gestor              -> gestor.html
//   /functions/v1/gestor/agenda       -> agenda.html
//   ...?dl=1                          -> baixa o arquivo (Content-Disposition: attachment)
//
// ATENCAO: o Supabase NAO serve HTML. Esta documentado:
// "GET requests that return text/html will be rewritten to text/plain".
// O gateway troca o Content-Type e ainda manda nosniff + CSP sandbox, entao o
// navegador mostra o codigo-fonte em vez da pagina. Por isso o modo padrao aqui e
// ?dl=1: baixa o arquivo, que abre normalmente com clique duplo (o painel fala com
// o PostgREST por CORS, que aceita origem file://).
// Para ter URL de verdade, as duas paginas precisam de um host estatico qualquer
// fora do supabase.co — a pasta ja esta pronta pra isso, e so subir app/*.html.
const BASE = (Deno.env.get("SUPABASE_URL") || "https://bwbeieumxcuomtrvlqxs.supabase.co") + "/storage/v1/object/public/app/";
// Uma pagina por empresa quando o processo e diferente. A Teak nao usa o gestor.html: ela vende
// teca para lead de feira, nao carteira com Clube e voucher, e a tela dela e um funil organizado
// nos 4 pipelines que ela mesma desenhou no CRM.
const PAG: Record<string, string> = { "": "gestor.html", "gestor": "gestor.html", "agenda": "agenda.html", "teak": "teak.html" };

Deno.serve(async (req) => {
  const txt = (s: string, st: number) => new Response(s, { status: st, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  try {
    const u = new URL(req.url);
    const seg = u.pathname.split("/").filter(Boolean);
    const i = seg.lastIndexOf("gestor");
    const sub = (i >= 0 ? seg.slice(i + 1).join("/") : "") || u.searchParams.get("p") || "";
    const arq = PAG[sub];
    if (!arq) return txt("pagina desconhecida: /" + sub + "\npaginas: /gestor · /gestor/agenda · /gestor/teak", 404);
    const r = await fetch(BASE + arq, { headers: { "cache-control": "no-cache" } });
    if (!r.ok) return txt("erro ao carregar " + arq + " (" + r.status + ")", 502);
    const html = await r.text();
    // inline=1 fica para o dia em que a pagina estiver atras de um host proprio
    const inline = u.searchParams.get("inline") === "1";
    const h: Record<string, string> = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
    if (inline) h["Content-Type"] = "text/html; charset=utf-8";
    else { h["Content-Type"] = "application/octet-stream"; h["Content-Disposition"] = 'attachment; filename="' + arq + '"'; }
    return new Response(html, { headers: h });
  } catch (e) { return txt("erro: " + String(e), 500); }
});
