-- Quem entra no roteiro de visitas. A regra fica AQUI, numa view, e nao espalhada
-- dentro da funcao: campanhas-roteiro le desta view nos tres modos (lista, rep e lote),
-- entao nao ha como um modo divergir do outro.
--
-- Fora do roteiro:
--   1. pendencia financeira — inadimplente no snapshot de cobranca OU titulo vencido em
--      aberto. Sao dois numeros diferentes: inad pega 240 clientes, titulo vencido pega
--      521. Visita de venda para quem deve e assunto da cobranca, nao do roteiro.
--   2. giro em dia — quem esta comprando no ritmo nao precisa de visita de empurrao;
--      a visita rende mais em quem furou o ciclo ou esta a vencer.
--
-- LEFT JOIN de proposito: cliente sem ficha em contato_enriquecido continua no roteiro.
-- Falha para dentro, nao para fora — melhor visitar demais do que sumir com o cliente.
create or replace view public.roteiro_cliente_apto as
select r.*
from public.roteiro_cliente r
left join public.contato_enriquecido ce on ce.codparc = r.codparc
where not r.inad
  and coalesce(ce.titulos_vencidos, 0) <= 0
  and coalesce(ce.situacao, '') <> 'Em dia';

comment on view public.roteiro_cliente_apto is
  'Clientes elegiveis ao roteiro de visitas: sem pendencia financeira (inadimplente ou titulo vencido) e com giro fora de dia. Usada por campanhas-roteiro.';

-- superficie minima: so quem monta o roteiro precisa ler
revoke all on public.roteiro_cliente_apto from anon;
grant select on public.roteiro_cliente_apto to service_role;
