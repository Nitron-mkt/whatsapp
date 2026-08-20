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
