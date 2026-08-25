# Revisão do catálogo de campanhas — Máquina de Vendas Nitron

Projeto Supabase `integracao-crm-sankhya` (`bwbeieumxcuomtrvlqxs`).
Data da apuração: 19/08/2026. Base: 38 campanhas, 388 disparos, 241 registros de fila.

---

## Resumo

O catálogo tem 38 campanhas em 11 pipes, 12 marcadas como ativas. Na prática **apenas 2
campanhas chegaram a enviar mensagem** (`voucher_empurrar` e `clube_saldo`), num único dia
(18/08). As outras 10 ativas ou geram rascunho que nunca sai, ou não geram nada.

O problema principal não é a configuração das campanhas individuais — é que a camada de
identificação do destinatário está vazia. Enquanto isso não for resolvido, **ativar mais
campanhas multiplica envios não rastreáveis e não filtrados**, não resultado.

---

## 1. Defeitos estruturais

Afetam todas as campanhas, independentemente da configuração de cada uma.

### 1.1 `contact_id` nulo em 100% dos registros

388 disparos e 241 itens de fila: nenhum tem `contact_id`. O envio funciona porque
`fila_envio` carrega `fone`/`email` direto, driblando a identificação.

Consequências:

- **Sem deduplicação.** Nada impede o mesmo contato receber 3 campanhas no mesmo dia.
- **Sem atribuição.** Não há como medir conversão de campanha — o `status` de `disparos`
  nunca sai de `rascunho` porque não existe chave para reconciliar a resposta.
- **Sem opt-out.** Não há como honrar um pedido de descadastro.

### 1.2 `codparc` nulo em 377 de 388 disparos (97%)

`clube_saldo` e `rep_sem_comprar`: 100% nulo. `voucher_empurrar`: 125 de 126.

Sem `codparc` não há cruzamento com o Sankhya. O filtro `excluir_inadimplente: true`,
presente em **34 das 38 campanhas**, não tem como ser aplicado. Existem 448 registros em
`inadimplente` que hoje não são consultáveis a partir de um disparo — risco de ofertar ou
cobrar indevidamente.

### 1.3 Sete campanhas ativas geram zero disparo

| Campanha | Cadência | Disparos |
|---|---|---|
| `saldo_liberar` | seg–sex | 0 |
| `saldo_confirmar` | seg–sex | 0 |
| `prep_retorno` | seg/qua/sex | 0 |
| `reativacao_180d` | qua | 0 |
| `cobranca_juridico` | seg | 0 |
| `promocao_redes` | *(vazia)* | 0 |
| `templates_whatsapp` | *(vazia)* | 0 |

`saldo_liberar` e `saldo_confirmar` estão programadas 5 dias por semana e nunca produziram
uma linha. Ambas dependem da tela de Gestão de Saldos; `saldo_pedido` tem 528 registros,
então os dados de origem existem.

### 1.4 Rascunhos órfãos: 190 disparos que nunca entram na fila

`recompra_giro_vencido` (81), `rep_sem_comprar` (69) e `recompra_giro_a_vencer` (40) geram
disparo mas nunca aparecem em `fila_envio`. Só `voucher_empurrar` e `clube_saldo` fazem a
travessia. Há uma ponte faltando entre gerar e enfileirar.

### 1.5 Os 9 erros de fila não têm mensagem de erro

Todos os 9 registros com `status='erro'` têm `erro = NULL`. O status é gravado sem o
motivo, o que torna o diagnóstico impossível. Corrigir isso é pré-requisito para depurar
qualquer coisa no envio.

---

## 2. Problemas de catálogo

### 2.1 Duas linhas não são campanhas

- **`templates_whatsapp`** (pipe `aquisicao`, `ativa=true`) — é o repositório de modelos
  Meta aprovados, não uma campanha. Cadência vazia.
- **`ia_propoe`** (pipe `inteligencia`) — é o motor que *cria* campanhas.

Ambas inflam a contagem do catálogo e podem ser varridas pelo agendador. O lugar delas é
fora de `campanhas` (a primeira já tem `wa_template`).

### 2.2 `template_ref` é NULL em todas as 38 campanhas

Existem 3 registros em `wa_template` e uma campanha dedicada a templates, mas nenhuma
campanha referencia um template. Como o WhatsApp exige template aprovado pela Meta para
primeiro contato, **toda campanha de 1º toque frio está tecnicamente inviável hoje** —
incluindo `prospeccao_aquisicao` e as três de `reativacao`.

### 2.3 `canais` fora de padrão em `prospeccao_aquisicao`

Usa `{WHATSAPP, DM_INSTAGRAM, EMAIL}` em maiúsculas, contra `whatsapp`/`email` minúsculos
nas outras 37. Qualquer comparação de canal por igualdade falha. É também a única com
`DM_INSTAGRAM`, canal que não aparece em `fila_envio` — ou seja, sem caminho de entrega.

### 2.4 Encoding corrompido em campanha gerada por IA

`ia_devolu_o_coordenada_antes_do_despacho` tem nome e objetivo com mojibake
(`Devolu��o`, `cr�dito`, `log�stica`). O próprio `codigo` foi derivado do texto corrompido
— daí o `devolu_o`. É um bug de encoding em `campanhas-ia-propoe`, não um erro de
digitação. A outra proposta da mesma data (`ia_saldo_lista_desconto_validada`) saiu limpa,
então a corrupção depende do conteúdo de origem.

### 2.5 Cadência vazia em duas campanhas ativas

`promocao_redes` e `templates_whatsapp` têm `cadencia = {}`. Estando ativas, nunca serão
agendadas — ficam num limbo em que aparecem como ligadas e não rodam.

---

## 3. Os dois pipes mortos

### `inteligencia` — 0 de 3 ativas

`ia_propoe` é meta-campanha (item 2.1). As outras duas são propostas que a IA inseriu em
14/08, ambas ainda com `status_dados='proposta'` e nunca revisadas — uma delas com o
encoding quebrado. O gargalo aqui não é técnico: **o funil de propostas da IA não tem
ninguém aprovando**. A IA escreve, e para.

As duas propostas vieram de evidência real de conversas do CRM (NF 83869/83875 cancelada
após despacho; caso Multi Atacado com 69 SKUs). São pautas legítimas.

### `key_accounts` — 0 de 3 ativas

As três são email-only para `publico=['rep']`, todas sem cadência.

- `ka_revisao_trimestral` — a observação diz "ligar quando o diretor quiser". É **decisão
  de negócio pendente, não defeito**.
- `ka_cross_sell` — precisa mix por conta. `abc_linha` (433) e `ka_grupo` (122) já existem;
  vale checar se o dado necessário já está lá.
- `ka_ruptura_rede` — `status_dados='precisa_dado'`, depende de estoque/saldo.

---

## 4. Veredicto por campanha

### Não ativar nada antes de resolver 1.1 e 1.2

Esta é a recomendação central. Ativar campanha nova hoje só aumenta o volume de envio sem
rastreio e sem filtro de inadimplência.

### Tirar do catálogo (2)

`templates_whatsapp`, `ia_propoe` — não são campanhas.

### Diagnosticar (7 ativas silenciosas)

As da tabela em 1.3. Prioridade para `saldo_liberar` e `saldo_confirmar`: são diárias, têm
dado de origem e produzem zero.

### Destravar (3 com rascunho órfão)

`recompra_giro_vencido`, `recompra_giro_a_vencer`, `rep_sem_comprar` — 190 rascunhos
prontos esperando a ponte para a fila. É o ganho mais rápido do catálogo: o conteúdo já
está gerado.

### Bloqueadas por dado faltante (6)

`cobranca_notificacao`, `ka_ruptura_rede`, `reativacao_win_back`, `saldo_envelhece`,
`saldo_avisa_cliente`, `saldo_aviso_pre_entrega` — todas com `status_dados='precisa_dado'`.
Não são candidatas a ativação até a fonte existir.

### Candidatas reais a ativação, depois dos consertos (14)

Com `status_dados='pronto'` e sem bloqueio conhecido: `saldo_parcial`,
`saldo_pequeno_consolidar`, `saldo_agendar`, `saldo_sem_estoque`, `prep_liberar`,
`prep_agendar`, `clube_a_vencer`, `cobranca_aviso_rep`, `cobranca_duplicata_cliente`,
`reativacao_faixas`, `recompra_cross_sell`, `recompra_novo_produto`,
`rep_roteiro_visitas`, `rep_sugestao_produto`.

Ressalva: as de canal WhatsApp para cliente frio dependem de `template_ref` (item 2.2), e
`recompra_cross_sell`/`recompra_novo_produto`/`rep_sugestao_produto` dependem de curva ABC
por conta.

---

## 5. Ordem sugerida

1. Passar a gravar `erro` na fila (1.5) — sem isso não se depura nada.
2. Popular `contact_id` e `codparc` nos disparos (1.1, 1.2).
3. Ligar os 190 rascunhos órfãos à fila (1.4).
4. Descobrir por que `saldo_liberar`/`saldo_confirmar` não geram (1.3).
5. Limpar o catálogo: tirar as 2 não-campanhas, corrigir `canais` e o mojibake (2.1–2.5).
6. Ativar em lotes pequenos, medindo, a partir das 14 candidatas.

---

## 6. Por que algumas campanhas não abrem (24/08)

O clique numa campanha passa por `clicavel(cod)` no `app/gestor.html`, que consulta onze mapas
de códigos escritos à mão (`OPERAVEIS`, `KA`, `ROT`, `SAL`, `COB`, `AGE`, `RET`, `IAP`, `PROS`,
`TPL`, `REDES`). Código que não está em nenhum deles fica no catálogo mas não abre — e sem
mensagem nenhuma, porque `abrir()` simplesmente retorna.

Cruzando o catálogo (38 campanhas) com esses mapas, nove não tinham tela:

| campanha | pipe | dado | situação |
|---|---|---|---|
| `clube_a_vencer` — Clube a vencer / distrato | clube | **pronto** | **corrigida**: só a tela faltava |
| `saldo_confirmar` — Confirmar saldo antes de faturar | saldo | **pronto** | falta modo no `campanhas-saldo` |
| `cobranca_notificacao` | cobranca | precisa_dado | sem fonte |
| `reativacao_win_back` | reativacao | precisa_dado | sem fonte |
| `saldo_envelhece` | saldo | precisa_dado | sem fonte (o modo existe no `campanhas-bulk`) |
| `saldo_avisa_cliente` | saldo | precisa_dado | sem fonte |
| `saldo_aviso_pre_entrega` | saldo | precisa_dado | sem fonte |
| `ia_devolu_o_coordenada_antes_do_despacho` | inteligencia | proposta | proposta da IA, não implementada |
| `ia_saldo_lista_desconto_validada` | inteligencia | proposta | proposta da IA, não implementada |

### `clube_a_vencer`: o back-end estava pronto o tempo todo

`campanhas-preview` e `campanhas-disparar` **já** traziam `clube_a_vencer` nos seus mapas
`MOTOR`, com filtro (`clube_vig_dias` não nulo), formatação de valor (`"Clube vence em Nd"`),
bullet da lista e instrução de tom própria. Faltava a campanha estar em `OPERAVEIS`/`MOTORC` na
tela. Corrigido; a chamada devolve 116 clientes em 23 representantes, R$ 2.095.538 de saldo de
Clube, com as assistentes resolvidas.

**Mas o alcance dela precisa de decisão.** O filtro é só "tem data de Clube", sem horizonte: hoje
os 148 clientes com data vão de **39 a 362 dias** para vencer. Uma campanha chamada "a vencer /
distrato" mandando "sua condição do Clube vence em 362 dias" não faz sentido. Falta combinar o
corte (30/60/90 dias) — é mudança de público, não de código, então ficou como está.

### Fragilidade que isso expõe

Os mapas de códigos na tela são uma segunda fonte de verdade sobre quais campanhas existem, e
ninguém avisa quando as duas divergem. Duas melhorias possíveis: o cartão da campanha sem tela
poderia dizer *"sem tela ainda"* em vez de não responder ao clique; e o `campanhas-listar`
poderia devolver, por campanha, qual fluxo a opera, tirando os mapas do HTML.

---

## 7. Comunicado aos representantes (25/08)

Campanha nova, `rep_comunicado`, no pipe `representantes`. É a primeira **sem gatilho de dado**: não
há recorte de snapshot que defina o público nem texto escrito por IA — o recado é da gestão, muda a
cada envio, e quem recebe é escolhido a dedo na tela.

Isso obrigou uma mudança pequena no catálogo: `campanhas.fonte_msg` só admitia `ia` e `arte`, e
agora admite `manual`. Sem isso seria preciso cadastrar a campanha mentindo que a IA escreve.

### Como funciona

- `campanhas-comunicado` (GET) devolve **a rede inteira** com os contatos de cada representante,
  montados exatamente como no `campanhas-preview` (snap_rep + `rep_contato_extra` + as duas bases do
  codparc do rep: `snap_contato` e `ghl_contato`), com os rótulos `CRM·empresa`/`CRM·casado` que a
  tela usa para deixar vínculo fraco desmarcado.
- Canal interno da casa (`AUTO ATEND.`, `E-COMMERCE MRKT`, `<SEM VENDEDOR>`, as próprias
  assistentes…) é marcado `interno: true` — regra: sem celular **ou** e-mail `@nitron.com.br` /
  `@nitronplast.com.br`. São 12 de 79 linhas; ficam fora da lista, com aviso.
- Tabela `comunicado` guarda os recados anteriores (título, WhatsApp, assunto, corpo) para reuso —
  é o que atende o "vai mudar bastante ao decorrer do tempo".
- Marcadores no texto: `[REP]` vira o nome do representante e `[ASSISTENTE]` o nome da assistente.
- O envio entra na `fila_envio` como qualquer outra campanha, então respeita 1 WhatsApp por
  instância a cada 2 min, e cada rep sai pela instância da assistente dele.

### Decisões embutidas

- **Sem IA.** Num comunicado não existe dado de onde a IA partir; o conteúdo é da gestão. Um
  "ajustar o tom com IA" sobre o texto escrito é possível depois, e seria reescrita, não invenção.
- **Um celular por rep, pré-marcado.** Mandar o mesmo recado para três números do mesmo
  representante é ruído. O primeiro celular de vínculo forte vem marcado; o resto fica visível para
  marcar à mão.
- **Sem instância, não enfileira.** Coerente com o `campanhas-enviar`: melhor não enviar do que
  enviar pelo número errado. Hoje os 67 representantes têm instância, então nenhum cai nessa.
- **O texto vive no estado da tela, não no DOM.** A lista redesenha a cada filtro ou clique num
  rep; se o texto fosse lido do `textarea`, o comunicado seria apagado no meio da escrita.

### Três representantes precisam de atenção no ERP

O celular no Sankhya está no formato antigo (8 dígitos, sem o nono), então a tela não consegue
afirmar que é celular e não pré-marca — aparecem na lista com o número visível para marcar à mão:

| rep | instância | números no Sankhya |
|---|---|---|
| JOSÉ ALVES | Isadora | `6291528624`, `062 99152864` |
| MORAES | Juliete | `556292619843` (o do CRM é vínculo fraco) |
| WALDEMAR | Juliete | `8396015000`, `558393120861` |

É o mesmo problema que fez o José Alves só ser encontrado no CRM por e-mail na conferência de
proprietários: o Sankhya guarda o número sem o nono dígito, o CRM com.
