-- O que ainda estava implicito no codigo da Nitron e virou cadastro.
-- Cada coluna aqui saiu de um valor chumbado que so funcionava porque havia uma empresa so.

-- 1) UNIVERSO: quem entra no snapshot nao e a mesma pergunta em cada empresa.
-- Na Nitron e o Clube/voucher: AD_PARCEIRO where CONTRATO<>0 or PERCCAMPANHA>0 (1050 parceiros).
-- Esse universo NAO tem CODEMP nenhum — e por isso que trocar o CODEMP do cache-refresh nunca ia
-- gerar o snapshot da outra empresa, so quebrar o da Nitron.
-- Na Teak nao existe Clube: dos 13 clientes faturados em 12 meses, zero tem voucher. O universo
-- dela so pode ser quem comprou no CODEMP dela.
alter table empresa add column if not exists universo text not null default 'clube'
  check (universo in ('clube','faturamento'));
comment on column empresa.universo is
  'Regra de quem entra no snapshot. clube = AD_PARCEIRO com contrato ou voucher (Nitron). faturamento = quem comprou no CODEMP da empresa nos ultimos 12 meses (Teak e qualquer empresa sem programa de Clube).';

-- 2) CONTATO DE TESTE: estava chumbado em campanhas-enviar como RENATO, um contato da location da
-- Nitron. Esse id nao existe na subconta da Teak — o modo b.test passaria sem testar nada.
alter table empresa add column if not exists teste_contact_id text;
comment on column empresa.teste_contact_id is
  'Contato desta location usado pelo modo b.test de campanhas-enviar. Nulo = o chamador tem de passar contact_id; id de outra location nao serve para teste nenhum.';

-- 3) MARCA: preencher() trocava {{location.name}} e {{user.name}} por "Nitron" fixo. Campanha da
-- Teak sairia assinada como Nitron.
alter table empresa add column if not exists marca text;
comment on column empresa.marca is
  'Nome curto que aparece no texto da mensagem ({{location.name}}, {{user.name}}) e como assunto padrao de e-mail.';

-- 4) TOKEN DO GHL: o achado que faltava no roteiro do doc. O GHL_TOKEN do projeto e escopado a UMA
-- location. Conferido em 26/08 chamando /contacts/search com o locationId da Teak:
--   HTTP 403 {"message":"The token does not have access to this location."}
-- Nao era so o locationId que era da Nitron — a credencial tambem.
alter table empresa add column if not exists ghl_token_env text;
comment on column empresa.ghl_token_env is
  'Nome do secret das Edge Functions com o token do GHL desta empresa. O token do GHL e escopado por location: o da Nitron responde 403 na location da Teak. Nulo = usa GHL_TOKEN.';

update empresa set universo = 'clube',       marca = 'Nitron',      teste_contact_id = 'bnKA8BWCRaTeiBC2rjRs', ghl_token_env = 'GHL_TOKEN'      where codigo = 'NITRON';
update empresa set universo = 'faturamento', marca = 'Teak Brazil',                                            ghl_token_env = 'GHL_TOKEN_TEAK' where codigo = 'TEAK';
update empresa set marca = nome where marca is null;
