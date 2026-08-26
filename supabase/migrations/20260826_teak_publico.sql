-- O publico da Teak: snap_lead, snap_pipeline, as views dela e o catalogo de campanhas.
--
-- Na Nitron todo publico vem do ERP. Na Teak isso da 13 clientes. O volume real dela esta no CRM:
-- 2931 contatos, quase todos leads de feira (Formobile 2024 e 2026) e WhatsApp de entrada, sem
-- CODPARC porque nunca compraram. Destes, 220 com a tag "aguardando-nossa-resposta" — divida da
-- empresa, nao lista de prospeccao. Nenhuma view da maquina conseguia enxergar isso.

create table if not exists snap_lead (
  empresa       text not null references empresa(painel_id),
  ghl_id        text not null,
  nome          text,
  fone          text,
  email         text,
  dono_ghl_id   text,                            -- assignedTo: e ele que decide o numero de saida
  tags          text[] not null default '{}',
  fonte         text,                            -- contact.source ("Feira Formobile 2026")
  pipeline_id   text,
  stage_id      text,
  opp_id        text,
  opp_status    text,
  opp_valor     numeric,
  codparc       int,                             -- preenchido quando o lead JA e cliente do ERP
  razao_social  text,
  ramo          text,
  canal         text,
  resumo_ia     text,                            -- campo "Informacoes para AI" do CRM
  dnd           boolean not null default false,
  criado_em     timestamptz,
  mexido_em     timestamptz,                     -- dateUpdated: base do "parado ha N dias"
  atualizado    timestamptz not null default now(),
  primary key (empresa, ghl_id)
);
comment on table snap_lead is
  'Espelho dos contatos do CRM por empresa. Existe porque na Teak o publico das campanhas nao esta no ERP: sao leads de feira e de WhatsApp que ainda nao viraram cliente. Alimentado por ghl-leads-refresh.';
comment on column snap_lead.dono_ghl_id is
  'assignedTo do contato no GHL. E a regra mais importante do sistema: o numero de saida do WhatsApp e o do dono do contato, nao um fromNumber.';
comment on column snap_lead.mexido_em is
  'dateUpdated do GHL. E daqui que sai "parado ha N dias" — o sinal que move as campanhas de lead.';

create index if not exists snap_lead_emp_stage_idx  on snap_lead (empresa, stage_id);
create index if not exists snap_lead_emp_tags_idx   on snap_lead using gin (tags);
create index if not exists snap_lead_emp_mexido_idx on snap_lead (empresa, mexido_em);

create table if not exists snap_pipeline (
  empresa     text not null references empresa(painel_id),
  pipeline_id text not null,
  pipeline    text not null,
  stage_id    text not null,
  stage       text not null,
  posicao     int  not null default 0,
  atualizado  timestamptz not null default now(),
  primary key (empresa, stage_id)
);
comment on table snap_pipeline is
  'Pipelines e estagios de cada location do GHL. A Teak ja tinha 4 pipelines desenhados (Novos Clientes, Ciclo de Recompra, Key Accounts, Recrutamento de Forca de Vendas) — o painel dela e organizado em cima deles em vez de copiar os pipes da Nitron.';

-- Ids dos campos personalizados da Teak, conferidos na API em 26/08. Sao POR LOCATION.
update empresa set campos = campos || jsonb_build_object(
    'codparc',      '5ZfLRhefBnUyAys0BOGU',   -- "Codigo Parceiro"
    'resumo_ia',    'FVkgUfbibO7orEKslX9V',   -- "Informacoes para AI"
    'razao_social', 'KYxlHMRFr6NGb9H0Wrnh',   -- "Razão Social:"
    'ramo',         'gCKsxr8C5U5UTKKm0l3D',   -- "Ramo Atuacao"
    'canal',        'd3OVUYhlGveZbmLZ8YZe',   -- "Canal"
    'cnpj',         'PlJX2whrWFpZs642DNj4',   -- "CPF/CNPJ"
    'representante','vLsfwDjZ1bQqjbgX4us0'),  -- "Representante"
  actualizado_em = now()
where codigo = 'TEAK';

-- ------------------------------------------------------------------ views da Teak
-- NAO sao copia das da Nitron, porque o processo nao e o mesmo. A Nitron vende carteira
-- (contrato, saldo do Clube, voucher, giro de 17 mil clientes). A Teak vende teca — paineis
-- colados/ripados, revestimentos, madeira serrada — para marcenaria, moveleiro, madeireiro e
-- construtora. O que move a Teak e o LEAD ANDAR NO PIPELINE, nao o cliente recomprar.

create or replace view teak_lead as
  select l.ghl_id, l.nome, l.fone, l.email, l.dono_ghl_id, l.tags, l.fonte,
         l.razao_social, l.ramo, l.canal, l.resumo_ia, l.codparc, l.dnd,
         p.pipeline, p.stage, p.posicao,
         l.opp_id, l.opp_status, l.opp_valor,
         l.criado_em, l.mexido_em,
         (current_date - l.mexido_em::date) as dias_parado,
         -- o resumo da IA vem prefixado com [Lead] / [Qualificado] no proprio texto
         nullif(substring(l.resumo_ia from '^\[([^\]]+)\]'), '') as etiqueta_ia
    from snap_lead l
    left join snap_pipeline p on p.empresa = l.empresa and p.stage_id = l.stage_id
   where l.empresa = 'teak';

-- A DIVIDA. Tag posta por quem atende quando a bola esta com a gente: 220 contatos em 26/08.
-- Primeira no painel de proposito — e a unica lista onde o cliente ja pediu algo e esta esperando.
create or replace view teak_lead_aguardando as
  select * from teak_lead
   where 'aguardando-nossa-resposta' = any (tags) and not dnd
   order by dias_parado desc nulls last;

create or replace view teak_lead_feira as
  select * from teak_lead
   where (coalesce(fonte,'') ilike 'feira%' or exists (select 1 from unnest(tags) t where t ilike 'feira-%'))
     and coalesce(stage,'Lead') = 'Lead'
     and not dnd
   order by dias_parado desc nulls last;

create or replace view teak_lead_qualificado as
  select * from teak_lead
   where stage = 'Qualificado' and coalesce(opp_status,'open') = 'open' and not dnd
   order by dias_parado desc nulls last;

create or replace view teak_lead_proposta as
  select * from teak_lead
   where stage = 'Proposta' and coalesce(opp_status,'open') = 'open' and not dnd
   order by dias_parado desc nulls last;

-- Publico INTERNO: nao sai mensagem para ninguem, e a lista de conserto de dado.
create or replace view teak_lead_dado as
  select *, case when fone is null then 'sem telefone'
                 when 'rever-telefone' = any (tags) then 'telefone marcado para revisar'
                 else 'verificar' end as problema
    from teak_lead
   where fone is null or 'rever-telefone' = any (tags)
   order by dias_parado desc nulls last;

-- A Teak precisa de rede de vendas e nao tem: hoje e uma pessoa atendendo tudo.
create or replace view teak_rep_candidato as
  select * from teak_lead
   where (pipeline = 'Recrutamento de Forca de Vendas' or coalesce(ramo,'') ilike '%representante%')
     and not dnd
   order by dias_parado desc nulls last;

-- Aqui a regra E a mesma da Nitron (giro efetivo), so que sobre o CODEMP da Teak. Sao 2 clientes:
-- o painel mostra 2 e nao finge que sao mais.
create or replace view teak_cliente_recompra as
  select g.codparc, g.nomeparc, g.codvend, g.rep, g.ultima, g.dias, g.fat12m, g.bucket, g.inadimp,
         c.fone, c.email
    from snap_giro g
    left join (select codparc, min(fone) fone, min(email) email
                 from snap_contato where empresa = 'teak' group by codparc) c on c.codparc = g.codparc
   where g.empresa = 'teak'
   order by g.fat12m desc nulls last;

create or replace view teak_cliente_ativar as
  select p.codparc, p.nomeparc, p.codvend, p.rep, p.inadimp,
         c.fone, c.email,
         g.codparc is not null as no_giro
    from snap_parceiro p
    left join snap_giro g on g.empresa = p.empresa and g.codparc = p.codparc
    left join (select codparc, min(fone) fone, min(email) email
                 from snap_contato where empresa = 'teak' group by codparc) c on c.codparc = p.codparc
   where p.empresa = 'teak'
   order by p.nomeparc;

-- Resumo do painel. Contado no banco, nao nas ultimas N linhas: se o numero e um total, conte no
-- banco (secao 5.7 do doc).
create or replace view teak_espera as
  select 'teak_lead_aguardando'::text as campanha_codigo, count(*) as esperando,
         'tag aguardando-nossa-resposta · sem DND'::text as regra from teak_lead_aguardando
union all
  select 'teak_lead_feira_retomar', count(*), 'lead de feira ainda no estagio Lead' from teak_lead_feira
union all
  select 'teak_lead_qualificado_proposta', count(*), 'estagio Qualificado com oportunidade aberta' from teak_lead_qualificado
union all
  select 'teak_proposta_sem_retorno', count(*), 'estagio Proposta com oportunidade aberta' from teak_lead_proposta
union all
  select 'teak_dado_telefone', count(*), 'sem telefone ou tag rever-telefone' from teak_lead_dado
union all
  select 'teak_rep_recrutar', count(*), 'pipeline de Recrutamento ou ramo REPRESENTANTE' from teak_rep_candidato
union all
  select 'teak_recompra_giro', count(*), 'giro do CODEMP da Teak · sem inadimplente'
    from teak_cliente_recompra where not inadimp
union all
  select 'teak_primeiro_pedido', count(*), 'cliente do ERP da Teak fora do giro'
    from teak_cliente_ativar where not no_giro and not inadimp;

-- agenda_catalogo lia `campanhas` sem filtro: com o catalogo da Teak dentro, a agenda da Nitron
-- passaria a listar campanha de teca. A coluna empresa entra NO FIM do select de proposito —
-- "create or replace view nao reordena coluna" (secao 5.5 do doc).
create or replace view agenda_catalogo as
  select codigo, nome, pipe, ativa, prioridade, status_dados, publico, canais, cadencia,
         objetivo, gatilho, filtros_padrao, observacao, fonte_msg, template_ref, criada_por,
         empresa
    from campanhas
   where empresa = 'nitron';
