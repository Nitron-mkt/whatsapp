-- Parte 2 das views da Nitron: as duas grandes.
--
-- vw_rep_contato_rastreio — o filtro aqui NAO e cosmetico. CODVEND e CODPARC sao globais no
-- Sankhya e a Teak usa os CODVEND 67, 109, 153 e 214, que tambem existem na Nitron. Sem o
-- filtro o join rep_carteira -> snap_rep casa duas linhas por rep e duplica contato na tela.
--
-- agenda_espera — so os quatro ramos que leem snap_giro mudam. Os outros (saldo_pedido,
-- cobranca_cliente, roteiro_cliente, ka_grupo, retorno_pedido, prep_pedido, agendar_pedido)
-- vem de tabelas que ainda sao so da Nitron; quando alguma virar multi-empresa, filtrar aqui.

create or replace view vw_rep_contato_rastreio as
  with reps as (
    select rc.codvend, rc.codparc, sr.rep, sr.celular, sr.fone_parc, sr.email, sr.email_parc, sr.email_crm
      from rep_carteira rc
      join snap_rep sr on sr.codvend = rc.codvend and sr.empresa = 'nitron'
  )
  select codvend, rep, codparc as codparc_rep, canal, valor, base, origem, risco,
         nome_contato, business_id, verificar
    from (
      select reps.codvend, reps.rep, reps.codparc, 'telefone'::text as canal, reps.celular as valor,
             'Sankhya'::text as base, 'cadastro do rep (celular)'::text as origem, 'OK'::text as risco,
             null::text as nome_contato, null::text as business_id, ''::text as verificar
        from reps where coalesce(reps.celular, '') <> ''
      union all
      select reps.codvend, reps.rep, reps.codparc, 'telefone'::text, reps.fone_parc,
             'Sankhya'::text, 'cadastro do rep (fone_parc)'::text, 'OK'::text, null::text, null::text, ''::text
        from reps where coalesce(reps.fone_parc, '') <> ''
      union all
      select reps.codvend, reps.rep, reps.codparc, 'email'::text, reps.email,
             'Sankhya'::text, 'cadastro do rep (email)'::text, 'OK'::text, null::text, null::text, ''::text
        from reps where coalesce(reps.email, '') <> ''
      union all
      select reps.codvend, reps.rep, reps.codparc, 'email'::text, reps.email_parc,
             'Sankhya'::text, 'cadastro do rep (email_parc)'::text, 'OK'::text, null::text, null::text, ''::text
        from reps where coalesce(reps.email_parc, '') <> ''
      union all
      select reps.codvend, reps.rep, reps.codparc, 'email'::text, reps.email_crm,
             'CRM'::text, 'cadastro do rep (email_crm)'::text, 'OK'::text, null::text, null::text, ''::text
        from reps where coalesce(reps.email_crm, '') <> ''
      union all
      select r.codvend, r.rep, r.codparc, 'telefone'::text, sc.fone,
             'Sankhya'::text, ('contato do parceiro do rep (codparc ' || r.codparc) || ')', 'OK'::text,
             sc.nome, null::text, ''::text
        from reps r join snap_contato sc on sc.codparc = r.codparc and sc.empresa = 'nitron'
       where coalesce(sc.fone, '') <> ''
      union all
      select r.codvend, r.rep, r.codparc, 'email'::text, sc.email,
             'Sankhya'::text, ('contato do parceiro do rep (codparc ' || r.codparc) || ')', 'OK'::text,
             sc.nome, null::text, ''::text
        from reps r join snap_contato sc on sc.codparc = r.codparc and sc.empresa = 'nitron'
       where coalesce(sc.email, '') <> ''
      union all
      select r.codvend, r.rep, r.codparc, 'telefone'::text, gc.fone, 'CRM'::text,
             case when gc.ghl_id like '%#biz%' then 'CRM: via EMPRESA do GHL'
                  when gc.ghl_id like '%#r%'   then 'CRM: CASADO por email/fone do rep'
                  else ('CRM: contato direto (AD_CODPARC=' || r.codparc) || ')' end,
             case when gc.ghl_id like '%#biz%' or gc.ghl_id like '%#r%' then 'REVISAR' else 'OK' end,
             gc.nome, gc.business_id,
             case when gc.ghl_id like '%#biz%' then 'Veio da mesma EMPRESA do rep no GHL. Se for contato de CLIENTE, separe as empresas no GHL (rep vs cliente).'
                  when gc.ghl_id like '%#r%'   then 'Casou pelo e-mail/telefone do rep. Se for contato de CLIENTE, remova o e-mail/telefone do rep desse contato no GHL.'
                  else '' end
        from reps r join ghl_contato gc on gc.codparc = r.codparc
       where coalesce(gc.fone, '') <> ''
      union all
      select r.codvend, r.rep, r.codparc, 'email'::text, gc.email, 'CRM'::text,
             case when gc.ghl_id like '%#biz%' then 'CRM: via EMPRESA do GHL'
                  when gc.ghl_id like '%#r%'   then 'CRM: CASADO por email/fone do rep'
                  else ('CRM: contato direto (AD_CODPARC=' || r.codparc) || ')' end,
             case when gc.ghl_id like '%#biz%' or gc.ghl_id like '%#r%' then 'REVISAR' else 'OK' end,
             gc.nome, gc.business_id,
             case when gc.ghl_id like '%#biz%' then 'Veio da mesma EMPRESA do rep no GHL. Se for contato de CLIENTE, separe as empresas no GHL (rep vs cliente).'
                  when gc.ghl_id like '%#r%'   then 'Casou pelo e-mail/telefone do rep. Se for contato de CLIENTE, remova o e-mail/telefone do rep desse contato no GHL.'
                  else '' end
        from reps r join ghl_contato gc on gc.codparc = r.codparc
       where coalesce(gc.email, '') <> ''
      union all
      select rce.codvend, r.rep, r.codparc,
             case when rce.tipo = 'telefone' then 'telefone' else 'email' end,
             rce.valor, 'Manual'::text, 'adicionado na tela'::text, 'OK'::text, null::text, null::text, ''::text
        from rep_contato_extra rce join reps r on r.codvend = rce.codvend
       where rce.ativo = true
    ) t
   order by rep, canal, (risco = 'OK'), valor;

create or replace view agenda_espera as
 select 'saldo_liberar'::text as campanha_codigo, count(*) as esperando,
        'pct_atend >= 90 · atende · valor >= R$ 1.000'::text as regra,
        coalesce(sum(valorpend), 0::numeric) as valor
   from saldo_pedido where pct_atend >= 90 and atende and valorpend >= 1000::numeric
union all
 select 'saldo_parcial'::text, count(*), 'pct_atend entre 50 e 90 · valor >= R$ 1.000'::text,
        coalesce(sum(valorpend), 0::numeric)
   from saldo_pedido where pct_atend >= 50 and pct_atend < 90 and valorpend >= 1000::numeric
union all
 select 'saldo_sem_estoque'::text, count(*), 'pct_atend < 50 · valor >= R$ 1.000'::text,
        coalesce(sum(valorpend), 0::numeric)
   from saldo_pedido where pct_atend < 50 and valorpend >= 1000::numeric
union all
 select 'saldo_confirmar'::text, count(*), 'saldo pendente na base'::text,
        coalesce(sum(valorpend), 0::numeric)
   from saldo_pedido
union all
 select 'cobranca_juridico'::text, count(*), 'maior atraso > 180 dias'::text,
        coalesce(sum(valor_vencido), 0::numeric)
   from cobranca_cliente where maior_atraso > 180
union all
 select 'cobranca_duplicata_cliente'::text, count(*), 'maior atraso entre 1 e 180 dias'::text,
        coalesce(sum(valor_vencido), 0::numeric)
   from cobranca_cliente where maior_atraso >= 1 and maior_atraso <= 180
union all
 select 'cobranca_aviso_rep'::text, count(*), 'qualquer titulo vencido'::text,
        coalesce(sum(valor_vencido), 0::numeric)
   from cobranca_cliente where maior_atraso > 0
union all
 select 'clube_saldo'::text, count(*), 'saldo do Clube > R$ 2.500'::text,
        coalesce(sum(saldo), 0::numeric)
   from clube_contrato where saldo > 2500::numeric
union all
 select 'recompra_giro_a_vencer'::text, count(*), 'balde A_VENCER · sem inadimplente'::text,
        coalesce(sum(fat12m), 0::numeric)
   from snap_giro where empresa = 'nitron' and bucket = 'A_VENCER'::text and not inadimp
union all
 select 'recompra_giro_vencido'::text, count(*), 'balde VENCIDO · sem inadimplente'::text,
        coalesce(sum(fat12m), 0::numeric)
   from snap_giro where empresa = 'nitron' and bucket = 'VENCIDO'::text and not inadimp
union all
 select 'rep_sem_comprar'::text, count(*), 'baldes VENCIDO e REATIVACAO · sem inadimplente'::text,
        coalesce(sum(fat12m), 0::numeric)
   from snap_giro where empresa = 'nitron' and bucket = any (array['VENCIDO'::text,'REATIVACAO'::text]) and not inadimp
union all
 select 'reativacao_180d'::text, count(*), 'balde REATIVACAO · sem inadimplente'::text,
        coalesce(sum(fat12m), 0::numeric)
   from snap_giro where empresa = 'nitron' and bucket = 'REATIVACAO'::text and not inadimp
union all
 select 'prep_retorno'::text, count(*), 'notas retornadas na base'::text, coalesce(sum(valor), 0::numeric)
   from retorno_pedido
union all
 select 'prep_liberar'::text, count(*), 'pedidos travados na base'::text, coalesce(sum(valor), 0::numeric)
   from prep_pedido
union all
 select 'prep_agendar'::text, count(*), 'pedidos aguardando agendamento'::text, coalesce(sum(valor), 0::numeric)
   from agendar_pedido
union all
 select 'saldo_agendar'::text, count(*), 'pedidos de saldo aguardando agendamento'::text, coalesce(sum(valor), 0::numeric)
   from agendar_pedido where is_saldo
union all
 select 'rep_roteiro_visitas'::text, count(*), 'pontos de visita · sem inadimplente'::text, 0
   from roteiro_cliente where not inad
union all
 select 'ka_cross_sell'::text, count(*), 'grupos key account na base'::text, 0 from ka_grupo
union all
 select 'ka_revisao_trimestral'::text, count(*), 'grupos key account na base'::text, 0 from ka_grupo;
