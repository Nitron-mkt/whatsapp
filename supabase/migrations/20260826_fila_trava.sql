-- Por que uma mensagem NAO saiu. Ate agora essa resposta estava espalhada: o painel do gestor
-- mostrava "124 pendente · 67 enviados · 8 erro", a agenda mostrava outro numero, e o motivo real
-- ficava dentro do texto livre de fila_envio.resultado — a resposta crua do GHL, em ingles, uma
-- linha por vez. Dava para contar quantas falharam, nao para saber O QUE fazer.
--
-- Sao tres objetos:
--   fila_trava_catalogo — o de-para de cada motivo: texto em portugues, acao que resolve, de quem e
--                         a bola, e se reenviar tem chance. Existe como view separada de proposito:
--                         a tela consegue explicar um motivo mesmo com zero linhas nele.
--   fila_trava          — uma linha por envio NAO entregue, ja classificado.
--   fila_trava_resumo   — o agregado que a tela desenha primeiro.
--
-- quem:     'nossa'   — configuracao ou dado nosso; da para consertar aqui
--           'contato' — dado do destinatario (e-mail invalido, DND, fixo); reenviar nao resolve
--           'ghl'     — falha passageira do lado deles
-- recupera: true quando reenviar tem chance de funcionar sem mexer em nada antes

create or replace view public.fila_trava_catalogo as
select * from (values
  ('fila_wpp_desligada',      'A fila de WhatsApp esta DESLIGADA — estas linhas nao saem enquanto ela nao voltar', 'Conferir se a instancia esta conectada e ligar o WhatsApp em Cadencia (fila_config.wpp_ativo)',            'nossa',   true,  1),
  ('fila_email_desligada',    'A fila de e-mail esta DESLIGADA',                                                  'Ligar o e-mail em Cadencia (fila_config.email_ativo)',                                                     'nossa',   true,  1),
  ('instancia_desconectada',  'A instancia de WhatsApp estava desconectada: o GHL aceitou, o ZaptosWPP nao entregou', 'Reconectar a instancia no ZaptosWPP (ler o QR) e reenviar estas linhas',                                 'nossa',   true,  1),
  ('preso_enviando',          'Reservada para envio e nunca concluiu — o processo caiu no meio',                    'O resgate da fila devolve para pendente na proxima rodada; se repetir, ver o log da funcao',               'nossa',   true,  2),
  ('bind_nao_confirmado',     'A troca de instancia nao foi confirmada — o texto NAO saiu, de proposito, para nao sair pelo numero errado', 'Conferir se a instancia esta conectada e reenviar',                               'nossa',   true,  2),
  ('ghl_autorizacao',         'O GHL recusou por autorizacao (401/403): token vencido ou sem escopo',              'Renovar o GHL_TOKEN e reenviar',                                                                           'nossa',   true,  2),
  ('ghl_transitorio',         'Falha passageira do GHL (500, timeout ou limite de chamadas)',                      'Reenviar: costuma passar na segunda tentativa',                                                            'ghl',     true,  3),
  ('sem_instancia',           'Sem instancia: ninguem do cadastro ativo e proprietario deste contato no CRM',      'Atribuir o contato a uma assistente do cadastro, no CRM',                                                  'nossa',   false, 3),
  ('instancia_fora_cadastro', 'A instancia pedida nao esta em instancia_ghl como ativa',                           'Cadastrar a instancia (com usuario_ghl_id) ou corrigir a assistente do representante',                     'nossa',   false, 3),
  ('sem_texto',               'A linha entrou na fila sem texto e sem arte',                                       'Refazer o disparo com o modelo preenchido',                                                                'nossa',   false, 3),
  ('email_invalido',          'O GHL recusou: e-mail do contato invalido',                                         'Corrigir o e-mail no Sankhya/CRM — enquanto estiver invalido, reenviar da o mesmo erro',                   'contato', false, 4),
  ('telefone_fixo',           'Numero fixo — nao tem WhatsApp',                                                    'Cadastrar um celular, ou falar com este cliente por e-mail',                                               'contato', false, 4),
  ('dnd_email',               'Contato com DND (nao perturbe) ativo para e-mail',                                  'Decisao de negocio: respeitar, ou pedir ao dono do contato para revisar no CRM',                            'contato', false, 4),
  ('descadastrado',           'O contato se descadastrou dos e-mails',                                             'Nao reenviar: descadastro e escolha do contato',                                                           'contato', false, 4),
  ('email_colado',            'O campo de e-mail tem MAIS DE UM endereco colado (dois @, ; ou espaco) — nao e um e-mail, e dois', 'Separar os enderecos no Sankhya: um por contato. Ex: "a@x.comb@y.com" sao dois e-mails grudados', 'nossa',   false, 3),
  ('contato_nao_criado',      'Nao deu para achar nem criar o contato no CRM',                                    'Ver o e-mail/telefone desta linha: normalmente o dado esta malformado na origem',                          'nossa',   false, 3),
  ('outro',                   'Erro nao classificado',                                                             'Ler o texto cru em resultado e, se o motivo se repetir, classificar na fila_trava_catalogo',               'ghl',     false, 5),
  ('enviando',                'Saindo agora',                                                                      'Nada a fazer',                                                                                             'nossa',   true,  9),
  ('na_fila',                 'Aguardando a vez na cadencia — normal, nao e trava',                                'Nada a fazer: sai sozinho',                                                                                'nossa',   true,  9)
) as c(trava, trava_txt, acao, quem, recupera, gravidade);

create or replace view public.fila_trava as
select
  f.id, f.campanha, f.publico, f.canal, f.status, f.nome, f.fone, f.email, f.codparc,
  f.instancia, f.template_id, f.tentativas, f.criado_em, f.enviado_em, f.resultado,
  (f.criado_em at time zone 'America/Sao_Paulo')::date as dia,
  t.trava,
  c.trava_txt, c.acao, c.quem, c.recupera, c.gravidade
from public.fila_envio f
cross join (
  select coalesce(bool_or(wpp_ativo), false) as wpp_ativo,
         coalesce(bool_or(email_ativo), false) as email_ativo
  from public.fila_config
) cfg
cross join lateral (
  -- A ordem importa: fila desligada vem ANTES de "na fila". 137 linhas paradas com o WhatsApp
  -- desligado nao sao "aguardando a vez", sao trava — e era exatamente o que ninguem via.
  select case
    when f.status = 'pendente' and f.canal = 'whatsapp' and not cfg.wpp_ativo   then 'fila_wpp_desligada'
    when f.status = 'pendente' and f.canal = 'email'    and not cfg.email_ativo then 'fila_email_desligada'
    when f.status = 'pendente'                                                  then 'na_fila'
    when f.status = 'enviando' and f.enviado_em < now() - interval '10 minutes' then 'preso_enviando'
    when f.status = 'enviando'                                                  then 'enviando'
    when f.resultado ~* 'instance is disconnected|instancia desconectada'        then 'instancia_desconectada'
    -- vem antes do email_invalido de proposito: o mesmo dado gera os dois erros, e "dois enderecos
    -- colados no mesmo campo" diz o que fazer, enquanto "o GHL achou invalido" nao diz.
    when f.canal = 'email' and (
           (length(coalesce(f.email,'')) - length(replace(coalesce(f.email,''), '@', ''))) > 1
        or trim(coalesce(f.email,'')) ~ '[;,[:space:]]' )                         then 'email_colado'
    when f.resultado ~* 'e-?mail is invalid|INVALID_EMAIL'                       then 'email_invalido'
    when f.resultado ~* 'DND is active'                                          then 'dnd_email'
    when f.resultado ~* 'unsubscrib|descadastr'                                  then 'descadastrado'
    when f.resultado ~* 'telefone fixo'                                          then 'telefone_fixo'
    when f.resultado ~* 'fora do cadastro instancia'                             then 'instancia_fora_cadastro'
    when f.resultado ~* 'sem instancia'                                          then 'sem_instancia'
    when f.resultado ~* 'nao confirmada|bind nao aceito'                         then 'bind_nao_confirmado'
    when f.resultado ~* 'sem texto|corpo/mensagem vazios'                        then 'sem_texto'
    when f.resultado ~* 'achar/criar contato'                                    then 'contato_nao_criado'
    when f.resultado ~* 'GHL 5[0-9][0-9]|Internal server error|timed out|GHL 429|rate ?limit' then 'ghl_transitorio'
    when f.resultado ~* 'GHL 40[13]'                                             then 'ghl_autorizacao'
    else 'outro'
  end as trava
) t
left join public.fila_trava_catalogo c on c.trava = t.trava
where f.status <> 'enviado';

create or replace view public.fila_trava_resumo as
select campanha, publico, canal, trava, trava_txt, acao, quem, recupera, gravidade,
       count(*) as linhas,
       count(distinct coalesce(codparc::text, lower(coalesce(nullif(trim(fone), ''), trim(email))))) as destinatarios,
       min(criado_em) as primeiro,
       max(criado_em) as ultimo,
       min((criado_em at time zone 'America/Sao_Paulo')::date) as dia_de,
       max((criado_em at time zone 'America/Sao_Paulo')::date) as dia_ate
from public.fila_trava
group by 1,2,3,4,5,6,7,8,9;

grant select on public.fila_trava_catalogo to anon, authenticated;
grant select on public.fila_trava to anon, authenticated;
grant select on public.fila_trava_resumo to anon, authenticated;
