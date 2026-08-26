-- Catalogo da Teak. Nenhuma campanha da Nitron foi copiada: os pipes dela (clube, saldo, cobranca,
-- preparacao) nao existem aqui, e a de voucher teria publico ZERO — dos 13 clientes faturados em
-- 12 meses, nenhum esta no universo de voucher.
--
-- O que a Teak vende: teca — paineis colados/ripados, revestimentos, madeira serrada. Para quem:
-- marcenaria, moveleiro, madeireiro, revenda, construtora, arquitetura. Como chega o lead: feira
-- (Formobile) e WhatsApp de entrada. Quem atende: uma pessoa (Marcelo Carvalho, dono dos 2931
-- contatos no CRM e CODVEND 214 no Sankhya).
--
-- Os pipes espelham os 4 pipelines que a Teak ja desenhou na subconta dela no GHL, para painel e
-- CRM contarem a mesma historia.
insert into campanhas (empresa, codigo, pipe, nome, objetivo, publico, canais, prioridade, status_dados, ativa, fonte_msg, filtros_padrao, observacao) values

 ('teak','teak_lead_aguardando','novos_clientes','Aguardando a nossa resposta',
  'Responder quem ficou esperando. A tag e posta por quem atende quando a bola fica com a gente — e a fila mais antiga primeiro.',
  '{cliente}','{whatsapp}',10,'pronto',true,'ia','{"excluir_inadimplente": false}'::jsonb,
  'Publico: view teak_lead_aguardando (tag aguardando-nossa-resposta, sem DND), ordenado por dias parado. excluir_inadimplente e false de proposito: lead de feira nao tem titulo no ERP, e o filtro descartaria todo mundo.'),

 ('teak','teak_lead_qualificado_proposta','novos_clientes','Qualificado sem proposta',
  'Transformar interesse concreto em proposta: quem ja disse o que precisa (espessura, volume, prazo) e travou no Qualificado.',
  '{cliente}','{whatsapp,email}',15,'pronto',true,'ia','{"excluir_inadimplente": false}'::jsonb,
  'Publico: view teak_lead_qualificado. O campo "Informacoes para AI" do contato ja tras o resumo da conversa e a proxima acao — e a melhor materia-prima de mensagem que a Teak tem.'),

 ('teak','teak_proposta_sem_retorno','novos_clientes','Proposta sem retorno',
  'Retomar proposta parada. E onde o pedido esta mais perto de fechar.',
  '{cliente}','{whatsapp}',20,'pronto',true,'ia','{"excluir_inadimplente": false}'::jsonb,
  'Publico: view teak_lead_proposta (estagio Proposta com oportunidade aberta).'),

 ('teak','teak_lead_feira_retomar','novos_clientes','Retomar lead de feira',
  'Puxar quem passou no estande da Formobile, entrou como Lead e nunca andou. Mensagem tem de lembrar a feira, senao vira contato frio.',
  '{cliente}','{whatsapp,email}',25,'pronto',true,'ia','{"excluir_inadimplente": false}'::jsonb,
  'Publico: view teak_lead_feira (fonte/tag de feira e ainda no estagio Lead).'),

 ('teak','teak_recompra_giro','recompra','Ciclo de recompra',
  'Puxar recompra de quem comprou da Teak e passou do proprio giro.',
  '{cliente}','{whatsapp}',30,'pronto',true,'ia','{"excluir_inadimplente": true}'::jsonb,
  'Publico: view teak_cliente_recompra (giro do CODEMP 8,21). Sao 2 clientes em 26/08 — o painel mostra 2 e nao finge que sao mais. Espelha o pipeline "Ciclo de Recompra" do CRM dela.'),

 ('teak','teak_primeiro_pedido','novos_clientes','Ativar quem comprou uma vez',
  'Cliente que ja faturou na Teak mas nao entrou no ciclo de recompra: virar cliente de verdade.',
  '{cliente}','{whatsapp,email}',35,'pronto',true,'ia','{"excluir_inadimplente": true}'::jsonb,
  'Publico: view teak_cliente_ativar (cliente do ERP da Teak fora do giro). Espelha o estagio "Primeiro Pedido" do pipeline Novos Clientes.'),

 ('teak','teak_dado_telefone','novos_clientes','Consertar contato sem telefone',
  'Lista de conserto: lead sem telefone ou com a tag rever-telefone posta na importacao das feiras. Sem numero valido nao ha WhatsApp.',
  '{interno}','{email}',40,'pronto',true,'manual','{"excluir_inadimplente": false}'::jsonb,
  'Publico: view teak_lead_dado. INTERNO de proposito — nao manda nada para o lead, so mostra o que arrumar.'),

 ('teak','teak_rep_recrutar','recrutamento','Recrutar representante',
  'A Teak precisa de rede de vendas e nao tem: hoje e uma pessoa atendendo tudo. Ha lead cujo ramo no cadastro e REPRESENTANTE, e um pipeline de Recrutamento ja desenhado no CRM.',
  '{cliente}','{whatsapp,email}',50,'pronto',true,'ia','{"excluir_inadimplente": false}'::jsonb,
  'Publico: view teak_rep_candidato (pipeline Recrutamento de Forca de Vendas ou ramo REPRESENTANTE). Mensagem e de PARCERIA, nao de venda — publico e mensagem diferentes das outras.'),

 ('teak','teak_ka_revisao','key_accounts','Revisao da conta grande',
  'Pauta estruturada para as contas que puxam volume, no pipeline Key Accounts do CRM dela.',
  '{cliente}','{email}',60,'precisa_dado',false,'ia','{"excluir_inadimplente": true}'::jsonb,
  'Desligada: precisa primeiro definir na Teak o que e conta grande. Com 12 clientes no ERP, o corte por faturamento ainda nao separa nada.')

on conflict (codigo) do nothing;
