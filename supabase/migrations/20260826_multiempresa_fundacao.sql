-- Fundacao multi-empresa.
--
-- POR QUE: ate aqui a maquina rodava uma empresa so (Nitron). O snapshot nao tinha coluna de
-- empresa e cache-refresh troca a tabela inteira (delete + insert). Rodar cache-refresh com o
-- CODEMP de outra empresa, como o roteiro de docs/nova-conta-como-comecar.md (secao 4, passo 2)
-- mandava fazer, APAGARIA o snapshot da Nitron. Medido em 26/08 antes de mexer: snap_giro
-- cairia de 1175 linhas para 2 e snap_contato de 2613 para ~1050, porque o CODEMP so filtra
-- faturamento/inadimplencia — o universo (AD_PARCEIRO) nao tem CODEMP nenhum.
--
-- ACHADO QUE MUDOU O PLANO: a tabela `empresa` JA EXISTIA (cadastro do Motor de prospeccao),
-- com chave `codigo`, ghl_location, linha_negocio e descricao_ia. Nao esta em
-- supabase/migrations nem no doc, e nenhuma view ou Edge Function a le. Criar uma segunda
-- tabela de empresa quebraria a regra "uma fonte de verdade por assunto" (secao 8 do doc),
-- entao esta migracao ESTENDE a que existe em vez de duplicar.
--
-- `painel_id` e a chave minuscula que o painel e as tabelas de dado usam ('nitron','teak'),
-- porque `codigo` e maiusculo ('NITRON') e as EMPRESAS do gestor.html sempre foram minusculas.

-- ------------------------------------------------------------- 1. estende o cadastro
alter table empresa add column if not exists painel_id     text;
alter table empresa add column if not exists campos        jsonb not null default '{}';
alter table empresa add column if not exists painel        text;
alter table empresa add column if not exists fonte_publico text[] not null default '{}';
alter table empresa add column if not exists pronto        boolean not null default false;

comment on column empresa.campos is
  'Ids de campo personalizado do GHL, que sao POR LOCATION — o mesmo campo tem id diferente em cada subconta. Pegadinha do GHL: o fieldKey e derivado do nome e a derivacao e perdida; nomeie campo sem % e sem acento.';
comment on column empresa.painel_id is
  'Chave minuscula usada pelo painel e pela coluna `empresa` das tabelas de dado. Existe porque `codigo` e maiusculo.';
comment on column empresa.fonte_publico is
  'De onde sai o publico das campanhas desta empresa: sankhya (snapshot do ERP), crm (contatos do GHL), ou os dois.';

-- Nitron: os ids vieram do que estava chumbado em campanhas-enviar (secao 3.2 do doc).
update empresa set
  painel_id     = 'nitron',
  painel        = 'gestor.html',
  fonte_publico = '{sankhya}',
  pronto        = true,
  campos        = jsonb_build_object(
    'codparc',          'HaDWHgnJSjDDdPF7XFDH',
    'voucher_pct',      'II773kLNc7R4Pw278zcf',
    'voucher_adic',     'h6yFBPOnoe4af0BDWNIB',
    'voucher_total',    '8YX7LVJcbwiqD8dHwUSe',
    'voucher_validade', 'sQsGU460EXuId97hpKEi'),
  actualizado_em = now()
where codigo = 'NITRON';

-- Teak: location e CODEMP confirmados em 26/08 via API do GHL e via TSIEMP
-- (8 = TEAK BRAZIL, 21 = TEAK BRAZIL (RONDONIA)). O cadastro estava sem os dois.
-- Sem campo de voucher de proposito: nao ha Clube na Teak — dos 13 clientes faturados em
-- 12 meses, zero estao no universo de voucher, entao campanha de voucher teria publico 0.
update empresa set
  painel_id     = 'teak',
  codemp        = '8,21',
  ghl_location  = 'DRhJc78pTfF9dlaH5NK9',
  painel        = 'teak.html',
  fonte_publico = '{sankhya,crm}',
  pronto        = false,
  campos        = jsonb_build_object('codparc', '5ZfLRhefBnUyAys0BOGU'),
  actualizado_em = now()
where codigo = 'TEAK';

update empresa set painel_id = lower(codigo) where painel_id is null;

alter table empresa drop constraint if exists empresa_painel_id_key;
alter table empresa add  constraint empresa_painel_id_key unique (painel_id);

-- ------------------------------------------- 2. coluna empresa nas tabelas de dado
-- Default 'nitron': as linhas que ja existem sao todas da Nitron, e qualquer insert antigo
-- que nao souber de empresa continua caindo no lugar certo em vez de violar NOT NULL.
alter table snap_parceiro  add column if not exists empresa text not null default 'nitron' references empresa(painel_id);
alter table snap_contato   add column if not exists empresa text not null default 'nitron' references empresa(painel_id);
alter table snap_rep       add column if not exists empresa text not null default 'nitron' references empresa(painel_id);
alter table snap_giro      add column if not exists empresa text not null default 'nitron' references empresa(painel_id);
alter table instancia_ghl  add column if not exists empresa text not null default 'nitron' references empresa(painel_id);
alter table fila_envio     add column if not exists empresa text not null default 'nitron' references empresa(painel_id);
alter table campanhas      add column if not exists empresa text not null default 'nitron' references empresa(painel_id);

-- A chave passa a ser (empresa, codparc): o mesmo CODPARC pode existir em duas empresas.
-- E o caso real do CODPARC 1 (NITRONPLAST), que aparece como cliente da Teak.
alter table snap_parceiro drop constraint if exists snap_parceiro_pkey;
alter table snap_parceiro add  primary key (empresa, codparc);
alter table snap_giro     drop constraint if exists snap_giro_pkey;
alter table snap_giro     add  primary key (empresa, codparc);
alter table snap_rep      drop constraint if exists snap_rep_pkey;
alter table snap_rep      add  primary key (empresa, codvend);

-- instancia_ghl mantem PK (instancia) de proposito: instancia_alias tem FK para ela, e o nome
-- da instancia no ZaptosWPP e unico na conta inteira, nao por empresa. So ganha a coluna.

-- snap_contato nunca teve PK (ha varios contatos por parceiro). So indice de leitura.
create index if not exists snap_contato_emp_idx     on snap_contato (empresa, codparc);
create index if not exists snap_giro_emp_bucket_idx on snap_giro (empresa, bucket);
create index if not exists fila_envio_emp_idx       on fila_envio (empresa, status);
create index if not exists campanhas_emp_idx        on campanhas (empresa, prioridade);
create index if not exists instancia_ghl_emp_idx    on instancia_ghl (empresa, ativa);

-- UNIQUE(codigo) do catalogo fica global de proposito: os codigos da Teak nascem com prefixo
-- teak_, entao nao colidem, e nenhuma funcao que busca campanha por codigo precisa mudar.
-- A Teak nao usa os pipes da Nitron (clube, saldo, cobranca). Precisa dos dela.
alter table campanhas drop constraint if exists campanhas_pipe_check;
alter table campanhas add  constraint campanhas_pipe_check check (pipe = any (array[
  'clube','saldo','recompra','reativacao','representantes','key_accounts',
  'inteligencia','aquisicao','cobranca','preparacao','logistica','redes',
  -- Teak: espelham os pipelines que ja existem na subconta dela no GHL
  'novos_clientes','recrutamento','relacionamento'
]));
