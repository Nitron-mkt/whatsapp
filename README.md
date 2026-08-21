# whatsapp — Máquina de Vendas Nitron

Código do projeto Supabase `integracao-crm-sankhya` (`bwbeieumxcuomtrvlqxs`).

## Estrutura

- `app/gestor.html` — Gestor de Campanhas (SPA de arquivo único).
- `app/agenda.html` — Agenda de Campanhas: calendário da semana com o que rodou,
  o que está planejado e as sugestões. Fala direto com o PostgREST
  (`agenda_catalogo`, `agenda_realizado`, `agenda_espera`, `agenda_campanha`).
- `supabase/functions/<slug>/index.ts` — Edge Functions.
- `docs/` — documentação e revisões.

As duas páginas ficam no Storage (bucket `app`) e a Edge Function `gestor` escolhe o
arquivo pelo caminho: `/gestor` entrega o `gestor.html`, `/gestor/agenda` entrega o
`agenda.html`. Para acrescentar uma página nova, suba o HTML com `host-upload` e registre
o arquivo no mapa `PAG` de `supabase/functions/gestor/index.ts`.

## Páginas

O Supabase **não serve HTML**. Está na documentação das Edge Functions:
*"GET requests that return `text/html` will be rewritten to `text/plain`"* — o gateway
troca o Content-Type e ainda manda `nosniff` + CSP `sandbox`, então o navegador mostra o
código-fonte. Vale para o Storage também. Não há como hospedar a página dentro do
`supabase.co`.

Enquanto não houver um host estático, a função `gestor` entrega o arquivo para download:

| Página | Baixar |
| --- | --- |
| Gestor de Campanhas | `https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/gestor` |
| Agenda de Campanhas | `https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/gestor/agenda` |

Baixe e abra com clique duplo: o painel funciona igual a partir de `file://`, porque o
PostgREST reflete a origem no CORS (testado com `Origin: null`). Acrescentar `?inline=1`
devolve `text/html` — serve para o dia em que as páginas estiverem atrás de um host
próprio, hoje o gateway reescreve.

Para ter URL de verdade, basta subir `app/gestor.html` e `app/agenda.html` em qualquer
host estático (Cloudflare Pages, Netlify, ou a hospedagem do site da Nitron). As páginas
são arquivo único, sem build, e falam com o Supabase por CORS.

## Publicar

```
ANON=<anon key>
for f in gestor agenda; do
  curl -X POST "https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/host-upload?path=$f.html" \
    -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
    -H "Content-Type: text/html" --data-binary @app/$f.html
done
```

## Subir o painel — as duas páginas se atualizam sozinhas

O Supabase não serve HTML, mas serve o **texto** do arquivo. Então quem hospeda a página
busca esse texto na hora de abrir, e publicar com `host-upload` já atualiza a página para
todo mundo — sem redeploy, sem subir arquivo de novo.

**Cloudflare Worker** (`deploy/worker/`) — é o que está no ar em
`gestor-nitron.nicoletti-ricardo.workers.dev`. Busca o arquivo no Storage a cada request e
devolve com `Content-Type: text/html`. O código deste repositório roteia por caminho:
`/` e `/gestor` entregam o gestor, `/agenda` entrega a agenda.

```
cd deploy/worker && wrangler deploy
```

**HostGator** (`deploy/painel/`, empacotado em `deploy/painel-nitron.zip`) — `gestor.html`
e `agenda.html` ali são carregadores de 40 linhas: buscam o arquivo no Storage com
`?v=<agora>` e trocam o documento. Sobem uma vez e nunca mais.

1. cPanel → Gerenciador de Arquivos → `public_html` → enviar o zip → **Extrair**
2. Abrir `https://SEUDOMINIO/painel/`
3. cPanel → **Privacidade de diretório**, marcar `painel`, criar usuário e senha

O passo 3 não é opcional, e vale para qualquer host: as páginas carregam a anon key no
próprio HTML e mostram carteira, faturamento e contato de cliente. Sem senha, quem souber
o endereço vê tudo. `noindex` e cache desligado já vêm no `.htaccess`, mas isso não é
autenticação — a URL do Worker, por exemplo, está aberta.

Enquanto isso, `/functions/v1/gestor` e `/functions/v1/gestor/agenda` continuam entregando
cada arquivo para download, para quem quiser abrir local.
