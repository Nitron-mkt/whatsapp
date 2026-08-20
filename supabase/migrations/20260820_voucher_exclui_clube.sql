-- Regra de negocio: cliente do Clube Nitron nao recebe campanha de voucher/desconto.
--
-- O filtro fica na view voucher_cli porque ela e a unica fonte do publico dessa
-- campanha: campanhas-preview e campanhas-disparar leem dela, e voucher_rep (as
-- contagens por rep) e derivada dela. Um ponto so, sem alterar edge function.
--
-- Contrato em 'distrato' NAO conta: o cliente perdeu o beneficio do Clube, entao
-- volta a poder receber voucher. Os demais estados (a_pedir, a_vencer, convertido,
-- esgotado) contam como ter Clube.

-- lista completa, sem a regra, preservada para relatorio e conferencia
create or replace view public.voucher_cli_todos as
select codparc, nomeparc as nome, codvend, rep, perccampanha as pct, dtvalidade
from public.snap_parceiro
where coalesce(perccampanha, 0::numeric) > 0::numeric
  and dtvalidade >= current_date
  and not inadimp;

comment on view public.voucher_cli_todos is
  'Todos os clientes com voucher vigente, SEM a regra do Clube. Definicao original de voucher_cli. Use para relatorio; para disparo use voucher_cli.';

create or replace view public.voucher_cli as
select sp.codparc, sp.nomeparc as nome, sp.codvend, sp.rep, sp.perccampanha as pct, sp.dtvalidade
from public.snap_parceiro sp
where coalesce(sp.perccampanha, 0::numeric) > 0::numeric
  and sp.dtvalidade >= current_date
  and not sp.inadimp
  and not exists (
    select 1 from public.clube_contrato cc
    where cc.contrato = sp.contrato and cc.bucket <> 'distrato'
  );

comment on view public.voucher_cli is
  'Publico da campanha de voucher. Exclui cliente com contrato ativo do Clube Nitron (qualquer bucket menos distrato): quem tem Clube nao recebe voucher/desconto. A lista sem essa regra esta em voucher_cli_todos.';
