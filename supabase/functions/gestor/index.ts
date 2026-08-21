// gestor — serve as paginas do painel a partir do storage 'app' com Content-Type text/html
// (o storage publico devolve tudo como text/plain + nosniff, por isso a pagina passa por aqui).
//
//   /functions/v1/gestor           -> gestor.html   (Gestor de Campanhas, intocado)
//   /functions/v1/gestor/agenda    -> agenda.html   (Agenda de Campanhas, pagina nova)
//
// Publico de proposito: as duas paginas ja carregam a anon key no proprio HTML, entao exigir
// header aqui nao protegia nada e impedia abrir o painel no navegador.
const BASE = (Deno.env.get("SUPABASE_URL") || "https://bwbeieumxcuomtrvlqxs.supabase.co") + "/storage/v1/object/public/app/";
const PAG: Record<string, string> = { "": "gestor.html", "gestor": "gestor.html", "agenda": "agenda.html" };

Deno.serve(async (req) => {
  const txt = (s: string, st: number) => new Response(s, { status: st, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  try {
    const u = new URL(req.url);
    // o que vem depois do slug da funcao decide a pagina; ?p= serve de atalho
    const seg = u.pathname.split("/").filter(Boolean);
    const i = seg.lastIndexOf("gestor");
    const sub = (i >= 0 ? seg.slice(i + 1).join("/") : "") || u.searchParams.get("p") || "";
    const arq = PAG[sub];
    if (!arq) return txt("pagina desconhecida: /" + sub + "\npaginas: /gestor · /gestor/agenda", 404);
    const r = await fetch(BASE + arq, { headers: { "cache-control": "no-cache" } });
    if (!r.ok) return txt("erro ao carregar " + arq + " (" + r.status + ")", 502);
    return new Response(await r.text(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
  } catch (e) { return txt("erro: " + String(e), 500); }
});
