-- TETO POR MINUTO, POR INSTANCIA.
-- Ate aqui a vazao era emergente: o cron roda 1x/min, o portao esperava wpp_intervalo_seg desde a
-- ultima enviada, e em rajada a margem de acomodacao virava 0 — o cruzamento dessas tres coisas
-- resultou em 1,9 msg/min no lote de 26/08. Funcionou por acidente: mudar qualquer uma das tres
-- muda a vazao sem ninguem perceber, e "no maximo 2 por minuto" nao estava escrito em lugar nenhum.
-- Agora esta. O processador conta quantas ESTA instancia mandou nos ultimos 60s e nunca passa deste
-- teto, independente de intervalo, rajada e jitter.
-- Por instancia (= por numero) de proposito: o limite que protege de bloqueio e o do numero, nao o
-- da operacao inteira. Duas assistentes mandando 2/min cada nao aumenta o risco de nenhuma das duas.
alter table public.fila_config
  add column if not exists wpp_max_min integer not null default 2;

comment on column public.fila_config.wpp_max_min is
  'Teto de mensagens de WhatsApp por minuto POR INSTANCIA. O processador conta as enviadas nos ultimos 60s e corta a rajada. 2 = pedido da operacao para campanhas de cliente.';
