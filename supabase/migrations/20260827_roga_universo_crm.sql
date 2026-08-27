-- Roga Village: um terceiro universo, porque o dela nao nasce no ERP.
--
-- O check de `universo` aceitava 'clube' e 'faturamento' — os dois casos que existiam quando ele
-- foi escrito. Ambos pressupoem CODEMP e nota de venda no Sankhya. A Roga nao tem nem um nem outro:
-- conferido em 27/08, as 976 notas dela em 12 meses sao TODAS de compra (Compra Servicos, Compra
-- Consumo, Compra Energia Eletrica) e os 298 parceiros com movimento sao FORNECEDORES do hotel.
-- Rodar cache-refresh com CODEMP 12 devolve zero linha.
--
-- Por isso 'crm': o publico dela vive na subconta do GHL (10 mil contatos, lead entrando todo dia
-- pelo site e pelo Instagram, cinco pipelines). O caminho e o inverso do da Nitron e da Teak.
-- Deixar a Roga como 'clube' fazia o cadastro afirmar algo falso sobre ela — e cadastro que mente
-- e pior que cadastro vazio, porque alguem vai confiar nele.
alter table empresa drop constraint if exists empresa_universo_check;
alter table empresa add  constraint empresa_universo_check
  check (universo in ('clube','faturamento','crm'));

comment on column empresa.universo is
  'De onde sai o publico da empresa. clube = contrato/voucher no Sankhya (Nitron). '
  'faturamento = quem comprou nos ultimos 12 meses, sem clube (Teak). '
  'crm = nao ha publico no ERP, o funil vive no GHL (Roga Village: o ERP dela so tem compra).';

-- O nome do secret com o token da subconta. A Roga precisa do proprio: o GHL_TOKEN que existe e
-- escopado a location da Nitron e responde 403 "The token does not have access to this location"
-- para qualquer outra. Enquanto GHL_TOKEN_ROGA nao existir nos segredos, a funcao roga-crm devolve
-- o erro dizendo exatamente isso, e a tela mostra o que fazer em vez de quebrar.
update empresa
   set universo      = 'crm',
       ghl_token_env = 'GHL_TOKEN_ROGA',
       marca         = coalesce(marca, 'Roga Village')
 where codigo = 'ROGA';
