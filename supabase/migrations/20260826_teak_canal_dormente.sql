-- Tres achados que so apareceram DEPOIS da primeira carga real dos 2931 leads e da leitura de uma
-- conversa de verdade da Teak. Nenhum deles estava no doc, e cada um invalidava uma suposicao.

-- (1) O CANAL DE WHATSAPP NAO E O MESMO NAS DUAS EMPRESAS.
-- Conferido na conversa cCJkM5EoHxj36OSFr7Ps: as mensagens da Teak sao messageType TYPE_WHATSAPP
-- (tipo 19) com altId "wamid.HBg..." — id da Meta. A Teak usa o WhatsApp NATIVO do GHL (WhatsApp
-- Business Cloud API), com UM numero por location (+55 11 95150-9821), que nao depende do dono do
-- contato. Nao ha ZaptosWPP, nao ha instancia, nao ha #contact_instance, nao ha bind.
-- Todo o aparato de campanhas-enviar existe por causa do ZaptosWPP. Aplicado a Teak, ele recusaria
-- TODO envio por falta de instancia: uma trava correta disparando pelo motivo errado.
-- Em troca entra um limite que a Nitron nao tem: a Meta so aceita texto livre dentro de 24h desde
-- a ultima mensagem do cliente; fora disso exige template aprovado.
alter table empresa add column if not exists canal_wpp text not null default 'zaptos'
  check (canal_wpp in ('zaptos','ghl_nativo'));
comment on column empresa.canal_wpp is
  'Como o WhatsApp sai nesta empresa. zaptos = ZaptosWPP via type SMS + #contact_instance + confirmacao de bind, com instancia por assistente (Nitron). ghl_nativo = WhatsApp Business Cloud API da Meta pelo proprio GHL, type WhatsApp, sem instancia e sem bind, um numero por location (Teak).';

update empresa set canal_wpp = 'zaptos'     where codigo = 'NITRON';
update empresa set canal_wpp = 'ghl_nativo' where codigo = 'TEAK';

-- (2) LEAD SEM DONO. 8 dos 2931 contatos estao sem assignedTo. A regra mais importante do sistema
-- e que o numero de saida e o do DONO do contato — sem dono, o numero de saida e indefinido. Nao e
-- detalhe de cadastro, e motivo de recusa. As listas de ENVIO passam a excluir; a lista de
-- CONSERTO passa a incluir, com o nome do problema.
--
-- (3) BASE DORMENTE. 1979 contatos sem oportunidade nenhuma no CRM, parados em media 201 dias;
-- 1923 sem fonte e sem tag de feira, criados entre 02/2025 e 08/2026, 1498 com telefone. Maior
-- ativo inexplorado da Teak E maior risco: disparar para ~1500 contatos frios de um numero so e
-- como se derruba o numero. Vira lista, com a campanha DESLIGADA.
--
-- teak_lead_dado e teak_espera precisam de DROP e nao de replace: teak_lead_dado foi criada como
-- `select *, problema`, e a coluna nova de teak_lead empurraria o nome de "problema" — o Postgres
-- recusa renomear coluna de view.
drop view if exists teak_espera;
drop view if exists teak_lead_dado;

create or replace view teak_lead as
  select l.ghl_id, l.nome, l.fone, l.email, l.dono_ghl_id, l.tags, l.fonte,
         l.razao_social, l.ramo, l.canal, l.resumo_ia, l.codparc, l.dnd,
         p.pipeline, p.stage, p.posicao,
         l.opp_id, l.opp_status, l.opp_valor,
         l.criado_em, l.mexido_em,
         (current_date - l.mexido_em::date) as dias_parado,
         nullif(substring(l.resumo_ia from '^\[([^\]]+)\]'), '') as etiqueta_ia,
         l.dono_ghl_id is null as sem_dono          -- coluna nova entra NO FIM (secao 5.5 do doc)
    from snap_lead l
    left join snap_pipeline p on p.empresa = l.empresa and p.stage_id = l.stage_id
   where l.empresa = 'teak';

create or replace view teak_lead_aguardando as
  select * from teak_lead
   where 'aguardando-nossa-resposta' = any (tags) and not dnd and not sem_dono
   order by dias_parado desc nulls last;

create or replace view teak_lead_feira as
  select * from teak_lead
   where (coalesce(fonte,'') ilike 'feira%' or exists (select 1 from unnest(tags) t where t ilike 'feira-%'))
     and coalesce(stage,'Lead') = 'Lead'
     and not dnd and not sem_dono
   order by dias_parado desc nulls last;

create or replace view teak_lead_qualificado as
  select * from teak_lead
   where stage = 'Qualificado' and coalesce(opp_status,'open') = 'open' and not dnd and not sem_dono
   order by dias_parado desc nulls last;

create or replace view teak_lead_proposta as
  select * from teak_lead
   where stage = 'Proposta' and coalesce(opp_status,'open') = 'open' and not dnd and not sem_dono
   order by dias_parado desc nulls last;

create or replace view teak_rep_candidato as
  select * from teak_lead
   where (pipeline = 'Recrutamento de Forca de Vendas' or coalesce(ramo,'') ilike '%representante%')
     and not dnd and not sem_dono
   order by dias_parado desc nulls last;

create view teak_lead_dado as
  select *, case when sem_dono then 'sem dono no CRM (numero de saida indefinido)'
                 when fone is null then 'sem telefone'
                 when 'rever-telefone' = any (tags) then 'telefone marcado para revisar'
                 else 'verificar' end as problema
    from teak_lead
   where fone is null or 'rever-telefone' = any (tags) or sem_dono
   order by dias_parado desc nulls last;

create or replace view teak_lead_dormente as
  select * from teak_lead
   where stage is null and pipeline is null
     and not dnd and not sem_dono and fone is not null
   order by dias_parado desc nulls last;

create view teak_espera as
  select 'teak_lead_aguardando'::text as campanha_codigo, count(*) as esperando,
         'tag aguardando-nossa-resposta · sem DND · com dono'::text as regra from teak_lead_aguardando
union all
  select 'teak_lead_feira_retomar', count(*), 'lead de feira ainda no estagio Lead' from teak_lead_feira
union all
  select 'teak_lead_qualificado_proposta', count(*), 'estagio Qualificado com oportunidade aberta' from teak_lead_qualificado
union all
  select 'teak_proposta_sem_retorno', count(*), 'estagio Proposta com oportunidade aberta' from teak_lead_proposta
union all
  select 'teak_base_dormente', count(*), 'sem oportunidade no CRM · com telefone · com dono' from teak_lead_dormente
union all
  select 'teak_dado_telefone', count(*), 'sem telefone, tag rever-telefone, ou sem dono no CRM' from teak_lead_dado
union all
  select 'teak_rep_recrutar', count(*), 'pipeline de Recrutamento ou ramo REPRESENTANTE' from teak_rep_candidato
union all
  select 'teak_recompra_giro', count(*), 'giro do CODEMP da Teak · sem inadimplente'
    from teak_cliente_recompra where not inadimp
union all
  select 'teak_primeiro_pedido', count(*), 'cliente do ERP da Teak fora do giro'
    from teak_cliente_ativar where not no_giro and not inadimp;

insert into campanhas (empresa, codigo, pipe, nome, objetivo, publico, canais, prioridade, status_dados, ativa, fonte_msg, filtros_padrao, observacao) values
 ('teak','teak_base_dormente','novos_clientes','Base dormente — reativar com cuidado',
  'A base que nunca foi trabalhada: contato no CRM sem oportunidade nenhuma, parado em media 201 dias. E o maior ativo inexplorado da Teak.',
  '{cliente}','{whatsapp,email}',45,'pronto',false,'ia','{"excluir_inadimplente": false}'::jsonb,
  'DESLIGADA de proposito. Publico: view teak_lead_dormente (~1500 contatos com telefone). Disparar isso de um numero so, em cadencia de metronomo, e como se derruba o numero do WhatsApp — e a Teak tem UM numero. Quem ligar tem de definir lote pequeno, wpp_burst com espera sorteada, e abrir a conversa no GHL depois do primeiro lote. Preferir e-mail no primeiro toque quando houver endereco. Some-se a isso a janela de 24h da Meta: nesta base ela esta fechada para praticamente todo mundo, entao o primeiro toque por WhatsApp exige template aprovado.')
on conflict (codigo) do nothing;
