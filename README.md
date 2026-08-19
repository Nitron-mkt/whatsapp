# whatsapp — Máquina de Vendas Nitron

Código do projeto Supabase `integracao-crm-sankhya` (`bwbeieumxcuomtrvlqxs`).

## Estrutura

- `app/gestor.html` — painel do gestor (SPA de arquivo único). Servido do Storage
  (bucket `app`) pela Edge Function `gestor`, e publicado com `host-upload`.
- `supabase/functions/<slug>/index.ts` — Edge Functions.
- `docs/` — documentação e revisões.

## Publicar o painel

```
curl -X POST "https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/host-upload?path=gestor.html" \
  -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY" \
  -H "Content-Type: text/html" --data-binary @app/gestor.html
```

O painel fica em `https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/gestor`.
