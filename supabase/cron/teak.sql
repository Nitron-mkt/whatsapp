-- Refresh automatico da Teak. Ate 26/08 o snapshot dela era manual (era a pendencia 14 do doc).
--
-- O token do Authorization e a chave ANON, a mesma que os outros crons deste projeto usam e que ja
-- esta embutida no HTML publico do painel. Nao e chave de servico.
--
-- Horarios escolhidos para nao cair junto com os da Nitron: o cache-refresh da Nitron roda aos :15
-- de 3 em 3 horas, entao o da Teak roda aos :05 — os dois batem no mesmo Sankhya.
select cron.schedule('cache-refresh-teak-3h', '5 */3 * * *', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cache-refresh?parte=all&empresa=teak',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON>'),
    body := '{}'::jsonb
  );
$$);

-- Os leads mudam o dia inteiro (WhatsApp de entrada), mas sao 2931 contatos em 30 paginas do GHL:
-- de 2 em 2 horas e o meio-termo entre a tela desatualizada e queimar cota de API a toa.
select cron.schedule('ghl-leads-refresh-teak-2h', '38 */2 * * *', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/ghl-leads-refresh?empresa=teak',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON>'),
    body := '{}'::jsonb
  );
$$);

-- Ja existia antes desta sessao, e foi de onde veio a convencao ?empresa=<painel_id>:
--   teak-conversas-10min  '7-59/10 11-23 * * *'  emp-conversas-classificar?empresa=teak&limite=20
-- E ela que escreve o campo "Informacoes para AI" do contato, que as campanhas de lead usam como
-- materia-prima da mensagem.
