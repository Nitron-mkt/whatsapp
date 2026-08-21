# whatsapp — Máquina de Vendas Nitron

Código do projeto Supabase `integracao-crm-sankhya` (`bwbeieumxcuomtrvlqxs`).

## Estrutura

- `app/gestor.html` — Gestor de Campanhas (SPA de arquivo único).
- `app/agenda.html` — Agenda de Campanhas: calendário da semana com o que rodou,
  o que está planejado e as sugestões. Fala direto com o PostgREST
  (`agenda_catalogo`, `agenda_realizado`, `agenda_espera`, `agenda_campanha`).
- `supabase/functions/<slug>/index.ts` — Edge Functions.
- `docs/` — documentação e revisões.

As duas páginas ficam no Storage (bucket `app`) e são servidas pela Edge Function
`gestor`, que existe só para devolver `Content-Type: text/html` — o Storage público
serve tudo como `text/plain; nosniff`, o que faria o navegador mostrar o código.

## Páginas

| Página | URL |
| --- | --- |
| Gestor de Campanhas | `https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/gestor` |
| Agenda de Campanhas | `https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/gestor/agenda` |

A função `gestor` roda com `verify_jwt=false`: as duas páginas já carregam a anon key
no próprio HTML, então exigir header não protegia nada e impedia abrir no navegador.

## Publicar

```
ANON=<anon key>
for f in gestor agenda; do
  curl -X POST "https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/host-upload?path=$f.html" \
    -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
    -H "Content-Type: text/html" --data-binary @app/$f.html
done
```

Para acrescentar uma página nova, suba o HTML com `host-upload` e registre o arquivo
no mapa `PAG` de `supabase/functions/gestor/index.ts`.
