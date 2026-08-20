-- Rastreio de contatos dos representantes: uma linha por contato, com origem e risco.
-- Saída consumida por scripts/rastreio_contatos_rep.py (salvar como rows2.json).
with reps as (
  select sr.codvend, sr.rep, rc.codparc, sr.celular, sr.fone_parc, sr.email, sr.email_parc, sr.email_crm
  from snap_rep sr join rep_carteira rc on rc.codvend = sr.codvend
),
cad as (
  select codvend, rep, codparc, 'telefone' canal, celular contato, 'Sankhya' base, 'cadastro do rep (celular)' origem, 'OK' risco, null::text nome_ct, null::text biz from reps where coalesce(celular,'')<>''
  union all select codvend, rep, codparc, 'telefone', fone_parc, 'Sankhya', 'cadastro do rep (fone_parc)', 'OK', null, null from reps where coalesce(fone_parc,'')<>''
  union all select codvend, rep, codparc, 'email', email, 'Sankhya', 'cadastro do rep (email)', 'OK', null, null from reps where coalesce(email,'')<>''
  union all select codvend, rep, codparc, 'email', email_parc, 'Sankhya', 'cadastro do rep (email_parc)', 'OK', null, null from reps where coalesce(email_parc,'')<>''
  union all select codvend, rep, codparc, 'email', email_crm, 'Sankhya', 'cadastro do rep (email_crm)', 'OK', null, null from reps where coalesce(email_crm,'')<>''
),
extra as (
  select r.codvend, r.rep, r.codparc, case when e.tipo='email' then 'email' else 'telefone' end, e.valor, 'Manual', 'adicionado na tela', 'OK', null, null
  from reps r join rep_contato_extra e on e.codvend = r.codvend where e.ativo and coalesce(e.valor,'')<>''
),
parc as (
  select r.codvend, r.rep, r.codparc, 'telefone', sc.fone, 'Sankhya', 'contato do parceiro do rep (codparc '||r.codparc||')', 'OK', null, null
  from reps r join snap_contato sc on sc.codparc = r.codparc where coalesce(sc.fone,'')<>''
  union all
  select r.codvend, r.rep, r.codparc, 'email', sc.email, 'Sankhya', 'contato do parceiro do rep (codparc '||r.codparc||')', 'OK', null, null
  from reps r join snap_contato sc on sc.codparc = r.codparc where coalesce(sc.email,'')<>''
),
-- #biz antes de #r, na mesma ordem de campanhas-preview
crm as (
  select r.codvend, r.rep, r.codparc, 'telefone' canal, g.fone contato, 'CRM' base,
    case when g.ghl_id like '%#biz%' then 'CRM: via EMPRESA do GHL'
         when g.ghl_id like '%#r%' then 'CRM: CASADO por email/fone do rep'
         else 'CRM: contato direto (AD_CODPARC='||r.codparc||')' end origem,
    case when g.ghl_id like '%#biz%' or g.ghl_id like '%#r%' then 'REVISAR' else 'OK' end risco,
    g.nome, g.business_id
  from reps r join ghl_contato g on g.codparc = r.codparc where coalesce(g.fone,'')<>''
  union all
  select r.codvend, r.rep, r.codparc, 'email', g.email, 'CRM',
    case when g.ghl_id like '%#biz%' then 'CRM: via EMPRESA do GHL'
         when g.ghl_id like '%#r%' then 'CRM: CASADO por email/fone do rep'
         else 'CRM: contato direto (AD_CODPARC='||r.codparc||')' end,
    case when g.ghl_id like '%#biz%' or g.ghl_id like '%#r%' then 'REVISAR' else 'OK' end,
    g.nome, g.business_id
  from reps r join ghl_contato g on g.codparc = r.codparc where coalesce(g.email,'')<>''
),
tudo as (select * from cad union all select * from extra union all select * from parc union all select * from crm)
select codvend, rep, codparc, canal, contato, base, origem, risco, nome_ct, biz,
       (select max(atualizado) from ghl_contato)::text sync_ghl
from tudo order by rep, canal, base, origem, contato;
