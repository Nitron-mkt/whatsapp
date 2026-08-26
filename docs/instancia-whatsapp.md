# Instância de WhatsApp — como a mensagem sai pelo número certo

## O mecanismo

O CRM (GoHighLevel) não fala WhatsApp nativamente. Um recurso externo liga cada
**usuário do GHL** a um **número de WhatsApp**. O envio vai pelo canal de SMS,
mas o cliente recebe no WhatsApp e responde no WhatsApp — e a resposta volta
para o CRM.

Quem decide por qual número sai é um comando enviado **antes** da mensagem:

```
1º SMS:  #contact_instance:Juliete     <- amarra o contato à instância
         (espera 1,5s)
2º SMS:  o texto real da campanha
```

Na volta, cada resposta chega com `Instance Source: Juliete` no corpo — é assim
que o `relatorio-coletar` sabe qual assistente atendeu (`assistFrom()`).

Isso acontece em `campanhas-enviar`, função `enviarMsg()`.

## O cadastro é a fonte de verdade

Duas tabelas, definidas pela gestão — **não** derivadas do Sankhya:

- **`instancia_ghl`** — `instancia` (o token exato do `#contact_instance`),
  `usuario_ghl` (usuário correspondente no GHL), `escopo`, `ativa`.
- **`instancia_alias`** — variações normalizadas (minúsculo, sem acento,
  primeira palavra) que caem em cada instância.

Instâncias de representante:

| Instância | Usuário no GHL |
|---|---|
| Beatriz | Beatriz Farias |
| Isadora | Isadora Shizuka |
| Mônica | Mônica C Gomes |
| Camyla | Camyla Castro |
| Valeria | Valeria Oliveira |
| Estevany | Estevany Caroline |
| Juliete | Juliete Silva |

## Como a instância é resolvida

`cache-refresh?parte=rep` lê do Sankhya o **apelido do gerente** de cada
representante (`TGFVEN` via `CODGER`), guarda o valor cru em
`snap_rep.assistente_raw` e resolve contra o cadastro:

```
apelido do gerente  ->  normaliza (sem acento, 1ª palavra, minúsculo)
                    ->  instancia_alias  ->  token válido e ativo
                    ->  snap_rep.assistente
```

Não resolveu → `assistente = NULL`. Todas as telas do painel já leem
`snap_rep.assistente`, então herdam a resolução sem mudança.

## As travas

Antes, sem instância a mensagem **saía sem amarrar** — pela última instância a
que aquele contato ficou preso, de outro assunto ou de outro mês. Era a origem
da comunicação desconexa. Agora:

1. **`campanhas-enviar`** recusa WhatsApp sem instância, com formato inválido,
   ou com token fora do cadastro (cache de 5 min de `instancia_ghl`).
   E-mail não usa instância, então passa direto.
2. **`fila-processar`** confere o token contra `instancia_ghl` antes de enviar e
   marca a linha como `erro` com o motivo, em vez de mandar errado.

Antes a fila só bloqueava instância **nula** — `"<sem"` e `"Monica"` (sem
circunflexo) eram strings verdadeiras e passavam.

## Situação em 24/08

71 dos 78 representantes resolvem para uma instância válida:

| Instância | Reps | Clientes na carteira |
|---|---|---|
| Juliete | 25 | 2.449 |
| Beatriz | 23 | 2.181 |
| Isadora | 19 | 1.779 |
| Estevany | 2 | 182 |
| Valeria | 1 | 135 |
| Mônica | 1 | 83 |
| Camyla | 0 | 0 |

Os 7 que não resolvem são canais internos, não representantes de campo — o
gerente no Sankhya é `<SEM VENDEDOR>` ou a própria conta:

| codvend | Rep | Gerente no Sankhya | Clientes |
|---|---|---|---|
| 67 | AUTO ATEND. | `<SEM VENDEDOR>` | 2.203 |
| 137 | E-COMMERCE MRKT | `E-COMMERCE MRKT` | 153 |
| 0 | `<SEM VENDEDOR>` | `<SEM VENDEDOR>` | 88 |
| 109 | CRISTIANE COMP | `<SEM VENDEDOR>` | 26 |
| 200 | ISADORA | `<SEM VENDEDOR>` | 1 |
| 217 | PRG VENDEDOR | `PRG GERENTE` | 0 |
| 214 | MARCELO CARVALH | `MARCELO CARVALH` | 0 |

## A instância de saída segue o usuário, não o contato (24/08)

**Esta é a causa raiz.** O `#contact_instance:<token>` é processado pelo
ZaptosWPP (ele confirma sempre, veja abaixo) e governa a atribuição do que
**entra** — é o que produz o `Instance Source:` na resposta do cliente. Mas ele
**não** decide por qual número a mensagem **sai**. A saída segue o **usuário GHL
remetente**, e numa mensagem de API o remetente é o `assignedTo` do contato.

A prova está no `userId` das mensagens da mesma conversa, no mesmo dia:

| hora (UTC) | origem | `userId` | quem é | chegou por |
|---|---|---|---|---|
| 16:37 | API (nossa função) | `SajXOmyjd7MdoMLmbQ8D` | Juliete Silva | **Juliete** |
| 16:38 | tela do CRM | `Yoq6cL8mRr3ICN4EK3st` | Leonardo Lucas | **Isadora** |
| 16:56 | API, esperando 22,6s | `SajXOmyjd7MdoMLmbQ8D` | Juliete Silva | **Juliete** |
| 17:0x | tela, sem mandar código | `Yoq6cL8mRr3ICN4EK3st` | Leonardo Lucas | **Isadora** |
| 17:16 | API, `assignedTo` → Isadora | `WlHZT90d36qnnXFbKzbl` | Isadora Shizuka | (confirmar) |

O contato de teste tinha `assignedTo = SajXOmyjd7MdoMLmbQ8D` — Juliete. Trocando
para o usuário da Isadora, o `userId` da mensagem de API passou a ser dela sem
mais nenhuma mudança. É essa a alavanca.

Duas coisas que enganaram no caminho:

- **Dois aplicativos distintos deram o mesmo `userId`.** O nosso token
  (`appId 6a6c7ab7…`) e o MCP da Anthropic (`appId 6a3e39da…`) saíram os dois como
  Juliete. Isso parecia dizer "o token é da Juliete", e não é: os dois herdaram o
  `assignedTo` do contato.
- **A tela do CRM funcionava sem mandar código nenhum.** Não é que a troca tenha
  "pegado depois"; é que na tela o remetente é o usuário logado.

A API **não** permite escolher o remetente: em `POST /conversations/messages` o
campo `userId` só vale para `type: InternalComment`. Existe `fromNumber`
("sender number for outbound messages"), que seria a alternativa sem tocar no
CRM, mas exigiria os números de WhatsApp de cada instância — que não estão no GHL
(não há custom value nem custom field com esse mapa; conferidos os dois).

Por isso `instancia_ghl` ganhou a coluna `usuario_ghl_id`:

| instância | usuário GHL | id |
|---|---|---|
| Beatriz | Beatriz Farias | `qZXd7wbATAFdznMpRPze` |
| Isadora | Isadora Shizuka | `WlHZT90d36qnnXFbKzbl` |
| Mônica | Mônica C Gomes | `tIpN9i0amyRc6TKnnwRS` |
| Camyla | Camyla Castro | `CPmJ2iQ1eFHwS15bIxNJ` |
| Valeria | Valeria Oliveira | `ld8s0Lx1egaZb6itl5xO` |
| Estevany | Estevany Caroline | `HQiOwWgtXPZFrOymkYpt` |
| Juliete | Juliete Silva | `SajXOmyjd7MdoMLmbQ8D` |

### Caminho descartado: esperar mais tempo

A primeira hipótese foi corrida de tempo, e estava **errada** — fica registrada
para ninguém tentar de novo. O `sleep(1500)` entre o bind e o texto era chute, o
`campanhas-enviar` v23/v24 passou a esperar a confirmação do app e mais 20s de
margem, e a mensagem **continuou saindo pela instância antiga**. O que se
aprendeu de útil no caminho:

- A instância não é campo do contato no GHL (conferidos os 100 custom fields da
  location). O ZaptosWPP guarda no banco dele e a tela mostra cache — foi por isso
  que a instância "continuou a antiga" na tela até recarregar a página.
- O app grava `[System]: Contact Instance Updated!` na conversa 2,2–2,3s depois do
  comando, com constância (4 amostras), e **incondicionalmente**: uma sonda com o
  contato já na instância pedida também recebeu confirmação. Isso serve como sinal
  de que o comando foi processado — só não é sinal de roteamento de saída.
- A espera de 25s + margem de 20s do v24 é, portanto, custo sem benefício para a
  saída. Com o roteamento por `assignedTo` no lugar, a margem deve voltar para
  algo pequeno (o bind continua útil para o `Instance Source:` do retorno).

`fila-processar` v16 drena as instâncias **em paralelo**, o que segue valendo:
em série, 7 instâncias × ~35s estouravam o tempo da função e o cron abortaria no
meio, deixando a fila parada sem aviso.

## Beatriz desligada (25/08) — o ERP mudou, o CRM não

A Beatriz saiu da empresa e a carteira dela foi dividida. Puxado direto do Sankhya
(`TGFVEN` com `CODGER` → `APELIDO` do gerente), o organograma hoje não tem Beatriz em
lugar nenhum, e os 23 representantes que eram dela ficaram assim:

| nova responsável | representantes |
|---|---|
| **Isadora** (9) | FABIO, FABIOLA, JOSÉ ALVES, JOSÉ FERNANDO, MARCOS AURELIO, NELSON, PAULO DRESCH, SEBASTIAO, WILSON |
| **Juliete** (14) | ARNESTO, CARLOS ALFAYA, CASSIO, EDMILSON, FIGUEROA, GIOVANE, GOIANDY, HELENA SANTOS S, JOÃO CARLOS, LUCIO, LUIZ CASTRO, MAURO, REGINALDO, WALDEMAR |

O problema é que **o número de saída segue o proprietário do contato no CRM**, e lá 17
desses contatos continuavam com a Beatriz. Ou seja: a mensagem sairia por um número que
ninguém mais atende, e as respostas cairiam numa caixa sem dono.

Ação imediata tomada: `instancia_ghl` marca `Beatriz` como `ativa = false` — não apagada,
para o `Instance Source: Beatriz` das conversas antigas continuar reconhecível. Com ela
fora do cadastro ativo, o `campanhas-enviar` recusa qualquer envio que tente sair por ela,
e a tela do comunicado passa a mostrar esses representantes como **"sem instância — não
sai"**, com a etiqueta *"→ atribuir a Isadora/Juliete no CRM"* tirada do organograma.

Estado: 44 representantes saem (Juliete 25 · Isadora 18 · Camyla 1); **22 bloqueados** até
que o contato tenha proprietária ativa no CRM — 8 para Isadora e 14 para Juliete. Cinco
deles já estavam sem proprietário antes do desligamento (ANNA CAROLINA, DENIZE,
MARIA JULIA, ROBERTO, RONALDO JR).

Isso é a mesma lição do caso da instância: o organograma do ERP é a fonte de quem atende,
mas quem decide o número é o CRM, e nada mantém os dois em acordo. Enquanto não houver essa
costura, todo remanejamento de assistente exige a troca correspondente no CRM.

## A rede inteira, e o "quem atende" vindo do ERP por ID (25/08)

A tela de METAS POR REPRESENTANTE do Sankhya mostra a assistente como o **gerente** do
representante (`TGFVEN.CODGER`), que é o mesmo dado que a gente já lia. Não existe tabela de
metas com campo de proprietária: `AD_TGFMETPARC` é meta por parceiro e `AD_METCUST` não tem
esse campo. O que a tela mostra, portanto, já estava ao alcance — o que faltava era **alcance**
e **precisão**.

**Alcance.** O `snap_rep` é montado a partir de quem tem carteira e cobria 67 reps. O ERP tem
**98 ativos** (`TIPVEND='R' AND ATIVO='S'`), todos sob Isadora (51) ou Juliete (47) — só a
HELENA (cód. 68) está sem gerente, sem carteira e sem parceiro, resíduo. Os 31 que faltavam são
representantes novos, ainda sem cliente. O comunicado passou a ler `rep_carteira`, que o
`rep-refresh` monta com a rede inteira, e agora lista os 98.

**Precisão.** `rep_carteira` traz `assist_idcrm` = `AD_IDCRM` do gerente no Sankhya, que é o
**id do usuário da assistente no GoHighLevel**. Ou seja: "quem atende" vem do ERP por ID, sem
casar nome de pessoa. É o fim de duas classes de erro que já custaram tempo aqui — o `Monica`
sem acento que não amarrava, e a quebra silenciosa quando a Beatriz saiu e o nome dela
simplesmente desapareceu do organograma. `rep-refresh` v3 passou a trazer também
`AD_CELULAR` e `EMAIL` do próprio rep (93 dos 98 têm celular), que é o que permite falar com o
rep novo que ainda não tem parceiro cadastrado.

### As 18 atribuições feitas no CRM

Com a autorização da gestão, os contatos sem proprietária ativa foram atribuídos à assistente
que o ERP indica: **8 para Isadora** (ANNA CAROLINA, FABIO, FABIOLA, MARCOS AURELIO,
OSCAR PIMENTEL, PAULO DRESCH, SÉRGIO, WILSON) e **10 para Juliete** (ARNESTO, CARLOS ALFAYA,
CASSIO, DENIZE, GOIANDY, LUIZ CASTRO, MARIA JULIA, MAURO, REGINALDO, RONALDO JR).

Treze ficaram de fora **de propósito**, com motivo registrado:

| motivo | representantes |
|---|---|
| sem contato no CRM (rep novo) | ADEMIR V., DEBORA, JOSÉ ALVES, JUCIARA, MICHELLA, PH, PLINIO, WLADMIR PENEDO |
| mais de um contato no mesmo telefone | EDMILSON, ROBERTO, WALDEMAR |
| telefone compartilhado com outro rep | ELIEL, GIOVANE |

O caso ELIEL/GIOVANE é de dado, não de sistema: **os dois têm o mesmo celular** no cadastro
(`+55 92 99989-3723`), então caem no mesmo contato do CRM e é impossível roteá-los para
assistentes diferentes. O ELIEL não tem `AD_CELULAR` próprio; o número dele veio da base do
parceiro. Enquanto os dois compartilharem o número, um dos dois vai receber pelo número da
assistente do outro.

Resultado na tela: de 44 representantes roteáveis para **78** (Juliete 41 · Isadora 36 ·
Camyla 1), com 10 ainda bloqueados — os 13 acima menos os que não tinham telefone algum.

### Cadastrar número na própria campanha

Cada linha aberta ganhou **+ telefone** e **+ e-mail**, no mesmo endpoint que as outras telas já
usam (`rep-contato` → `rep_contato_extra`). O número cadastrado ali vale em **todas** as
campanhas, não só no comunicado, e entra já marcado no envio.

### Segurança: mais uma chave chumbada

`rep-contato` tinha o mesmo problema do `fila-enfileirar`: um JWT de `service_role` escrito no
fonte como fallback do `srvKey()`. Removido (v3). São dois achados em dois dias, os dois em
funções que **não** passaram pela restauração da queda de 23/08 — vale varrer as demais.

## Todas as campanhas passam a ler a mesma instância (26/08)

O Comunicado já roteava certo — pelo proprietário do contato no CRM. As outras nove telas ainda
liam `snap_rep.assistente`: o nome da assistente vindo do organograma do Sankhya, **casado por
nome**. Isso erra duas vezes de uma vez — diz quem *deveria* atender, quando o que decide o número
de saída é quem *é dono* do contato, e depende de o nome bater (foi o que quebrou quando a Beatriz
saiu e o que fazia `Monica` sem acento não amarrar).

Em vez de reescrever oito funções, a verdade foi para um lugar só e o dado passou a chegar certo:

| peça | o que faz |
| --- | --- |
| `rep_carteira.instancia_crm` + `instancia_crm_em` | o dono no CRM, gravado; o horário existe para distinguir "nunca li o CRM" de "li e este rep não tem proprietária" |
| view `rep_instancia` | `instancia_erp` (organograma, por `assist_idcrm` = ID do usuário no GHL), `instancia_crm`, `instancia` (a que vale) e `divergente` |
| `rep-instancia-sync` | lê o CRM (uma busca por lote de telefones), grava `instancia_crm` e reaplica em `snap_rep.assistente`; cron diário 06:10, depois do `rep-refresh` das 05:55 |
| gatilho `trg_snap_rep_instancia` | qualquer gravação em `snap_rep` recebe a instância efetiva; `assistente_raw` continua com o nome cru do ERP |

Com isso as telas antigas ficaram certas sem mudar de código, e as duas que já tinham motivo para
mudar passaram a ler a view direto: `campanhas-roteiro` (v14) e `campanhas-retorno` (v4), que agora
também devolvem `instancia_erp` e `divergente`.

### A trava que fecha a porta: `campanhas-enviar` v25

Roteamento certo na tela não garante saída certa — o CRM pode mudar entre montar a lista e enviar.
Então, antes de soltar o texto, a função lê o `assignedTo` do contato e compara com a instância
pedida:

- **dono é outra instância ativa** → o WhatsApp **não sai**, e o motivo diz de quem é o contato.
- **dono não é nenhuma instância do cadastro** → segue como antes; não há o que comparar, e recusar
  quebraria as campanhas de cliente.
- **`usar_dono: true`** → em vez de recusar, manda pela dona de fato, e o nome dela substitui o da
  outra no texto (senão a mensagem sai de um número e assinada por outra pessoa).

A `fila-processar` (v17) usa `usar_dono` só nas linhas de **cliente**: ali o que importa é o cliente
receber de quem o atende. Nas de **representante** a divergência continua sendo recusada de
propósito — ela significa que o CRM está desalinhado do organograma, e isso é para a gestão ver, não
para o código encobrir.

`lookup: true` faz o caminho inteiro sem enviar nada, devolvendo `dono_crm` e `dono_divergente` —
serve para conferir antes de disparar. Foi assim que se confirmou, ao vivo, o contato do Leonardo:

```
pedindo Isadora → {"dono_crm":"Juliete","dono_divergente":true}
pedindo Juliete → {"dono_crm":"Juliete","dono_divergente":false}
```

Ou seja: aquele contato é da Juliete no CRM, e por isso as duas tentativas de 24/08 chegaram por ela
por mais que o `#contact_instance` fosse aceito. Hoje o envio pararia antes, com o motivo escrito.

### Como está a rede (leitura de 26/08)

98 reps ativos · **83 com proprietária no CRM** (Juliete 44 · Isadora 38 · Camyla 1) · 8 sem contato
no CRM · 7 com dono fora do cadastro · **4 divergentes**:

| rep | organograma | CRM (vale) |
| --- | --- | --- |
| MARCELO BEZERRA | Isadora | Juliete |
| MARCIO VIEIRA B | Isadora | Juliete |
| NELSON | Isadora | Camyla |
| TIAGO SANTOS | Isadora | Juliete |

A tela do gestor mostra isso em cada linha de representante: a instância que vale, `⚠ organograma:`
quando as duas discordam e `→ atribuir a … no CRM` quando ninguém do cadastro é dono — e nesse caso
a linha já avisa que o WhatsApp não sai.

## Pendente

- [ ] **Instância própria para comunicação direta ao cliente.** Quando existir,
      cadastrar em `instancia_ghl` com `escopo = 'cliente'` e apontar para ela
      os 7 canais internos acima (2.471 clientes) e a prospecção. Até lá esses
      envios de WhatsApp são **recusados** em vez de sair pela instância errada.
- [ ] Dois `"Isadora"` chumbados no código, que passam a valer como instância de
      cliente quando a de cima existir: prospecção (`app/gestor.html`) e a
      entrega do relatório diário (`relatorio-entregar`).
- [ ] `Camyla` está cadastrada mas nenhum representante aponta para ela no
      organograma do Sankhya. Se ela deve ter carteira, o `CODGER` dos reps dela
      precisa ser ajustado no ERP.
- [ ] `usuario_ghl` está cadastrado e ainda não é usado. Serve se um dia quisermos
      também **atribuir** o contato/oportunidade à assistente no GHL
      (`assignedTo`), não só mandar por ela.
- [x] **Decidido em 26/08: rotear PELO dono, nunca mudar o dono.** Escrever
      `assignedTo` era a alavanca tecnicamente validada, mas é exatamente o
      workflow que a gestão tirou do CRM — trocar o proprietário tira a
      visibilidade do contato das outras assistentes. Então a campanha manda por
      quem já é dono, e avisa quando isso discorda do organograma.
- [ ] Baixar `BIND_MARGEM_MS` de 20s: a espera não influi na saída (ficou de um
      diagnóstico errado) e hoje custa 20s por mensagem.
- [ ] O dono dos contatos de **cliente** não está no banco (`ghl_contato` não tem
      coluna de proprietário), então ali a fila resolve na hora, por contato, com
      `usar_dono`. Um `dono_crm` em `ghl_contato` deixaria a tela mostrar antes
      do disparo por quem cada cliente vai receber.
- [ ] 7 reps têm contato no CRM com dono **fora** do cadastro de instâncias — não
      dá para saber por qual número sairia. Vale listar quem são e decidir se o
      contato passa para uma das duas assistentes.
