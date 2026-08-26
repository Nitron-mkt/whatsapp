-- Views da Nitron ganham filtro de empresa.
--
-- POR QUE: estas views leem snap_* SEM filtro nenhum. No minuto em que a Teak tiver
-- snapshot, as linhas dela entram nas campanhas da Nitron pela porta de tras.
-- giro_rep_bucket e agenda_espera eram as piores: `from snap_giro` puro.
--
-- E ha um caso que nao e cosmetico: CODVEND e CODPARC sao GLOBAIS no Sankhya. A Teak usa
-- os CODVEND 67, 109, 153 e 214, que TAMBEM existem na Nitron. Sem o filtro, o join
-- rep_carteira -> snap_rep de vw_rep_contato_rastreio casaria duas linhas por rep e
-- DUPLICARIA contato na tela de rastreio.
--
-- O filtro e escrito na mao, empresa por empresa, de proposito: view da Nitron le dado da
-- Nitron, e a Teak tem as views dela. Trava que recusa alto, como manda a secao 8 do doc.

create or replace view giro_rep_bucket as
  select codvend, rep, bucket, count(*) as n, sum(fat12m) as fat
    from snap_giro
   where empresa = 'nitron' and not inadimp and codvend is not null
   group by codvend, rep, bucket;

create or replace view voucher_cli_todos as
  select codparc, nomeparc as nome, codvend, rep, perccampanha as pct, dtvalidade, perc_voucher, perc_adic
    from snap_parceiro
   where empresa = 'nitron'
     and coalesce(perccampanha, 0::numeric) > 0::numeric
     and dtvalidade >= current_date
     and not inadimp;

create or replace view voucher_cli as
  select codparc, nomeparc as nome, codvend, rep, perccampanha as pct, dtvalidade, perc_voucher, perc_adic
    from snap_parceiro sp
   where empresa = 'nitron'
     and coalesce(perccampanha, 0::numeric) > 0::numeric
     and dtvalidade >= current_date
     and not inadimp
     and not exists (select 1 from clube_contrato cc
                      where cc.contrato = sp.contrato and cc.bucket <> 'distrato'::text);

create or replace view clube_grupo as
  with ctr as (
    select contrato,
           mode() within group (order by codparcmatriz) as modemtz,
           max(saldoclube) as saldo,
           max(codparc)    as anycodp
      from snap_parceiro
     where empresa = 'nitron'
       and contrato <> 0
       and coalesce(saldoclube, 0::numeric) > 2500::numeric
       and not inadimp
     group by contrato
  ), lead as (
    select c.contrato, c.saldo,
           case when exists (select 1 from snap_parceiro m
                              where m.empresa = 'nitron' and m.codparc = c.modemtz and m.contrato = c.contrato)
                then c.modemtz else c.anycodp end as leadp
      from ctr c
  )
  select l.contrato, l.leadp as matriz, sp.codvend, sp.rep, sp.nomeparc as grupo, l.saldo
    from lead l
    join snap_parceiro sp on sp.codparc = l.leadp and sp.empresa = 'nitron';

-- rep_instancia: fonte unica de qual instancia atende cada rep (secao 2.2 do doc).
create or replace view rep_instancia as
  select c.codvend, c.codparc, c.apelido as rep, c.assist_idcrm,
         ie.instancia as instancia_erp,
         ic.instancia as instancia_crm,
         case when c.instancia_crm_em is not null then ic.instancia
              else coalesce(ic.instancia, ie.instancia) end as instancia,
         ic.instancia is not null and ie.instancia is not null and ic.instancia <> ie.instancia as divergente,
         c.instancia_crm_em
    from rep_carteira c
    left join instancia_ghl ie on ie.usuario_ghl_id = c.assist_idcrm and ie.ativa and ie.empresa = 'nitron'
    left join instancia_ghl ic on ic.instancia = c.instancia_crm  and ic.ativa and ic.empresa = 'nitron';
