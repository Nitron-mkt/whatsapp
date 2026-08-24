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

## A corrida da troca de instância (24/08)

O bind ser aceito **não** significa que a instância já trocou. No primeiro teste
real do mecanismo a sequência foi esta, e ainda assim o cliente recebeu pelo
número antigo:

| hora (UTC) | evento | status |
|---|---|---|
| 16:37:33.594 | `#contact_instance:Isadora` | `sent` |
| 16:37:35.804 | `[System]: Contact Instance Updated!` | — |
| 16:37:37.546 | texto real | `delivered` — **saiu pela instância anterior** |

O `sleep(1500)` que existia entre o bind e o texto era um chute, e perdia a
corrida. Duas coisas explicam por que isso passou tanto tempo sem aparecer:

1. **A instância não é campo do contato no GHL.** Foram conferidos os 100 custom
   fields da location: nenhum guarda a instância. O ZaptosWPP guarda no banco
   dele, e a tela do CRM mostra cache — foi por isso que a instância "continuou
   Juliete" na tela e só apareceu certa depois de recarregar a página. Não existe
   onde ler a instância atual pela API.
2. **O único sinal observável é a confirmação na conversa.** O app grava
   `[System]: Contact Instance Updated!` (type 2, `source: app`,
   `appName: ZaptosWPP - WhatsAPP like SMS`) quando processa o comando.

### Como ficou

`campanhas-enviar` v24 faz, para todo WhatsApp:

1. manda `#contact_instance:<instancia>`;
2. lê a conversa (o retorno do bind traz o `conversationId`) a cada 1,5s, por até
   25s, procurando a confirmação com `dateAdded` **posterior ao do próprio bind**
   — os dois horários vêm do GHL, então não há desencontro de relógio;
3. **sem confirmação, o texto não sai** (`bind_nao_confirmado: true`);
4. com confirmação, espera ainda 20s de acomodação e só então manda o texto.

Medições de 24/08 que sustentam esses números:

| amostra | confirmação após o bind | texto após a confirmação | resultado |
|---|---|---|---|
| 16:37 (v22) | 2,21s | 1,7s | instância **errada** |
| 16:48 (troca manual na tela) | — | 3,7s | certa |
| 16:56 (v23) | 2,25s | 22,6s | certa |
| 16:57 (sonda, sem texto) | 2,30s | — | — |

A sonda das 16:57 mandou o comando com o contato **já** na instância pedida e o
app confirmou de novo: a confirmação é **incondicional**. Ou seja, ausência de
confirmação significa de verdade que o comando não foi processado — recusar o
envio nesse caso é seguro, não gera recusa falsa na segunda mensagem para o
mesmo contato.

Sobra e sobrará a dúvida do valor exato: 1,7s falha e 22,6s funciona; o meio não
foi medido. Os 20s são o lado seguro da dúvida, e não custam vazão porque a fila
manda 1 mensagem por instância a cada 120s. Os três tempos são ajustáveis por
secret (`BIND_ESPERA_MS`, `BIND_POLL_MS`, `BIND_MARGEM_MS`) e por chamada
(`espera_ms`, `margem_ms`, `exigir_confirmacao`), sem redeploy.

`fila-processar` v16 passou a drenar as instâncias **em paralelo**: em série, 7
instâncias × ~35s no pior caso estouravam o tempo da função e o cron abortaria no
meio, deixando a fila parada sem aviso. Cada linha é de uma instância e de um
contato diferentes, então não há ordem a preservar entre elas.

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
- [ ] Medir o mínimo real da margem de acomodação (hoje 20s por precaução). Dá
      para fazer com envios controlados a um número interno, baixando
      `margem_ms` até falhar.
