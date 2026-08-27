// Cloudflare Worker que serve os painéis da Máquina de Vendas.
//
// Por que existe: o Supabase não serve HTML. Está na documentação das Edge Functions —
// "GET requests that return text/html will be rewritten to text/plain" — e o Storage faz o
// mesmo. O Worker busca o arquivo no Storage a cada request e devolve com o Content-Type
// certo. Resultado: publicar com host-upload já atualiza a página, sem redeploy do Worker.
//
//   /            -> gestor.html   (área Comercial)
//   /gestor      -> gestor.html   (área Comercial)
//   /logistica   -> gestor.html   (mesma página; ela le a área do caminho da URL)
//   /cobranca    -> gestor.html   (idem)
//   /agenda      -> agenda.html
//   /teak        -> teak.html     (Teak Brazil: outra empresa, outro processo, outra pagina)
//
// Deploy:  wrangler deploy   (ou colar no editor do dashboard da Cloudflare)
//
// ATENCAO: em 26/08 o Worker PUBLICADO estava atras deste arquivo — /logistica e /cobranca
// respondiam 404 embora estejam no mapa aqui (e a pendencia 8 do doc). Ou seja, editar este
// arquivo NAO basta: sem `wrangler deploy` a rota nova nao existe. Enquanto isso, a pagina da
// Teak sai por https://<projeto>.supabase.co/functions/v1/gestor/teak

const BASE = "https://bwbeieumxcuomtrvlqxs.supabase.co/storage/v1/object/public/app/";

// As três áreas do gestor são o MESMO arquivo: a página decide o que mostrar pelo
// caminho. Assim não existe cópia do painel para manter em três lugares.
const PAG = {
  "": "gestor.html",
  "gestor": "gestor.html",
  "gestor.html": "gestor.html",
  "comercial": "gestor.html",
  "logistica": "gestor.html",
  "logística": "gestor.html",
  "cobranca": "gestor.html",
  "cobrança": "gestor.html",
  "agenda": "agenda.html",
  "agenda.html": "agenda.html",
  // A Teak nao e uma "area" do gestor: e outra empresa, com processo proprio (lead de feira em
  // vez de carteira com Clube). Por isso arquivo proprio, e nao mais um alias do gestor.html.
  "teak": "teak.html",
  "teak.html": "teak.html",
};

export default {
  async fetch(req) {
    const u = new URL(req.url);
    const chave = u.pathname.replace(/^\/+|\/+$/g, "");
    const arq = PAG[chave];
    if (!arq) {
      return new Response("página desconhecida: /" + chave +
        "\npáginas: /gestor · /logistica · /cobranca · /agenda · /teak", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    // cache-buster: o Storage manda cache-control public,max-age=60 e a equipe
    // precisa ver a versão nova no mesmo minuto em que ela sobe
    const r = await fetch(BASE + arq + "?v=" + Date.now(), { cf: { cacheTtl: 0 } });
    if (!r.ok) {
      return new Response("erro ao carregar " + arq + " (" + r.status + ")", {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(r.body, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  },
};
