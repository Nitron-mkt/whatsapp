-- Painel Agenda de Campanhas — objetos NOVOS. Nada existente e alterado.
--
-- agenda_campanha  = o PLANEJADO e as anotacoes (intencao: dia, campanha, publico, objetivo, alvo)
-- agenda_realizado = view que agrega fila_envio por dia/campanha (o REALIZADO nunca e duplicado)
-- agenda_catalogo  = view com o recorte de campanhas que o calendario precisa
--
-- As views usam security_invoker = false (padrao), entao rodam como o owner e leem
-- campanhas sem precisar criar policy na tabela campanhas.

create table if not exists public.agenda_campanha (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  campanha_codigo text not null,
  publico text not null default '',
  canais text[] not null default '{}',
  origem text not null default 'humano',
  status text not null default 'planejado',
  objetivo text,
  alvo_estimado integer,
  observacao text,
  resultado_nota text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint agenda_status_chk check (status in ('planejado','em_andamento','concluido','cancelado')),
  constraint agenda_origem_chk check (origem in ('humano','sugestao')),
  constraint agenda_campanha_uk unique (data, campanha_codigo, publico)
);

create index if not exists agenda_campanha_data_idx on public.agenda_campanha (data);

create or replace function public.agenda_campanha_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.atualizado_em = now(); return new; end $$;

drop trigger if exists agenda_campanha_touch_trg on public.agenda_campanha;
create trigger agenda_campanha_touch_trg before update on public.agenda_campanha
  for each row execute function public.agenda_campanha_touch();

create or replace view public.agenda_catalogo as
select codigo, nome, pipe, ativa, prioridade, status_dados, publico, canais, cadencia, objetivo
from public.campanhas;

create or replace view public.agenda_realizado as
select (criado_em at time zone 'America/Sao_Paulo')::date            as dia,
       coalesce(campanha, '(sem campanha)')                          as campanha,
       count(*)                                                      as total,
       count(*) filter (where status = 'enviado')                     as enviado,
       count(*) filter (where status = 'erro')                        as erro,
       count(*) filter (where status not in ('enviado','erro'))       as pendente,
       count(*) filter (where canal = 'whatsapp')                     as whatsapp,
       count(*) filter (where canal = 'email')                        as email,
       count(distinct lower(coalesce(nullif(trim(fone), ''), trim(email)))) as destinatarios,
       min(criado_em)                                                 as primeiro,
       max(coalesce(enviado_em, criado_em))                           as ultimo
from public.fila_envio
group by 1, 2;

grant select on public.agenda_catalogo to anon, authenticated;
grant select on public.agenda_realizado to anon, authenticated;

-- A tela fala direto com o PostgREST porque o plano free ja esta no teto de 100 edge
-- functions. agenda_campanha e tabela so de planejamento: sem contato, sem telefone,
-- sem mensagem. Quando houver slot de function, mover a escrita para tras dela e
-- remover estas policies.
alter table public.agenda_campanha enable row level security;
drop policy if exists agenda_campanha_leitura on public.agenda_campanha;
drop policy if exists agenda_campanha_escrita on public.agenda_campanha;
create policy agenda_campanha_leitura on public.agenda_campanha
  for select to anon, authenticated using (true);
create policy agenda_campanha_escrita on public.agenda_campanha
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.agenda_campanha to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Segunda parte: o painel passou a explicar POR QUE disparar em cada dia.
-- Para isso precisa dos campos do cadastro que registram a decisao de criar a
-- campanha, e de quantos registros o gatilho dela selecionaria agora.
-- ---------------------------------------------------------------------------

create or replace view public.agenda_catalogo as
select codigo, nome, pipe, ativa, prioridade, status_dados, publico, canais, cadencia,
       objetivo, gatilho, filtros_padrao, observacao, fonte_msg, template_ref, criada_por
from public.campanhas;

-- agenda_espera traduz literalmente o gatilho de cada campanha em uma contagem.
-- Se o gatilho mudar em campanhas.gatilho, a regra aqui precisa acompanhar —
-- a coluna regra existe justamente para a tela poder mostrar o critério usado.
create or replace view public.agenda_espera as
select 'saldo_liberar'::text campanha_codigo, count(*)::bigint esperando,
       'pct_atend >= 90 · atende · valor >= R$ 1.000'::text regra, coalesce(sum(valorpend),0)::numeric valor
  from public.saldo_pedido where pct_atend >= 90 and atende and valorpend >= 1000
union all select 'saldo_parcial', count(*), 'pct_atend entre 50 e 90 · valor >= R$ 1.000', coalesce(sum(valorpend),0)
  from public.saldo_pedido where pct_atend >= 50 and pct_atend < 90 and valorpend >= 1000
union all select 'saldo_sem_estoque', count(*), 'pct_atend < 50 · valor >= R$ 1.000', coalesce(sum(valorpend),0)
  from public.saldo_pedido where pct_atend < 50 and valorpend >= 1000
union all select 'saldo_confirmar', count(*), 'saldo pendente na base', coalesce(sum(valorpend),0)
  from public.saldo_pedido
union all select 'cobranca_juridico', count(*), 'maior atraso > 180 dias', coalesce(sum(valor_vencido),0)
  from public.cobranca_cliente where maior_atraso > 180
union all select 'cobranca_duplicata_cliente', count(*), 'maior atraso entre 1 e 180 dias', coalesce(sum(valor_vencido),0)
  from public.cobranca_cliente where maior_atraso between 1 and 180
union all select 'cobranca_aviso_rep', count(*), 'qualquer titulo vencido', coalesce(sum(valor_vencido),0)
  from public.cobranca_cliente where maior_atraso > 0
union all select 'clube_saldo', count(*), 'saldo do Clube > R$ 2.500', coalesce(sum(saldo),0)
  from public.clube_contrato where saldo > 2500
union all select 'recompra_giro_a_vencer', count(*), 'balde A_VENCER · sem inadimplente', coalesce(sum(fat12m),0)
  from public.snap_giro where bucket = 'A_VENCER' and not inadimp
union all select 'recompra_giro_vencido', count(*), 'balde VENCIDO · sem inadimplente', coalesce(sum(fat12m),0)
  from public.snap_giro where bucket = 'VENCIDO' and not inadimp
union all select 'rep_sem_comprar', count(*), 'baldes VENCIDO e REATIVACAO · sem inadimplente', coalesce(sum(fat12m),0)
  from public.snap_giro where bucket in ('VENCIDO','REATIVACAO') and not inadimp
union all select 'reativacao_180d', count(*), 'balde REATIVACAO · sem inadimplente', coalesce(sum(fat12m),0)
  from public.snap_giro where bucket = 'REATIVACAO' and not inadimp
union all select 'prep_retorno', count(*), 'notas retornadas na base', coalesce(sum(valor),0)
  from public.retorno_pedido
union all select 'prep_liberar', count(*), 'pedidos travados na base', coalesce(sum(valor),0)
  from public.prep_pedido
union all select 'prep_agendar', count(*), 'pedidos aguardando agendamento', coalesce(sum(valor),0)
  from public.agendar_pedido
union all select 'saldo_agendar', count(*), 'pedidos de saldo aguardando agendamento', coalesce(sum(valor),0)
  from public.agendar_pedido where is_saldo
union all select 'rep_roteiro_visitas', count(*), 'pontos de visita · sem inadimplente', 0
  from public.roteiro_cliente where not inad
union all select 'ka_cross_sell', count(*), 'grupos key account na base', 0 from public.ka_grupo
union all select 'ka_revisao_trimestral', count(*), 'grupos key account na base', 0 from public.ka_grupo;

grant select on public.agenda_espera to anon, authenticated;
