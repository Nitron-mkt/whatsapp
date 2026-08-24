# Queda de 23/08/2026 — chave de serviço rejeitada

## Sintoma

O Gestor de Campanhas abre, mostra `erro` no status e nenhuma campanha na lista.

## Causa

As Edge Functions recebem a chave de serviço no ambiente. Essa chave deixou de ser
o **JWT legado** e passou a ser uma chave do **formato novo** (`sb_secret_…`, 41
caracteres, sem pontos). O Data API rejeita essa chave:

```
401 {"code":"PGRST303","message":"JWT issued at future"}
```

Medido dentro da própria função:

| | valor |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` · 41 chars · 1 parte |
| `SUPABASE_ANON_KEY` | `sb_publishable_…` · 46 chars |
| chave de serviço → `/rest/v1/campanhas` | **401 PGRST303** (como Bearer e como apikey) |
| chave publicável → `/rest/v1/campanhas` | 200 |

Não é relógio: o banco marcava 11:22 UTC contra 11:22 UTC do header HTTP.
Não é permissão: `set role service_role` no banco lê as 38 campanhas, os 21.014
contatos e os 2.370 clientes do roteiro sem erro.
Não é o painel: o `gestor.html` no ar é byte a byte igual ao do repositório.

O que quebrou foi só a **credencial que as 99 funções usam**. O painel continua
lendo pelo PostgREST com a chave anon legada, que segue válida — é por isso que
algumas telas mostram número e outras mostram zero.

## Quando

Todos os cursores de pipe congelaram em **23/08 11:13–11:18 UTC** (08:13–08:18 de
Brasília, domingo). Nove dos dez pararam numa janela de 5 minutos.

| rotina | última escrita |
| --- | --- |
| enriquecimento do contato no CRM | 23/08 11:14 |
| pipe de recompra | 23/08 11:15 |
| saldo, preparação, entregas | 23/08 11:15 |
| resumo | 23/08 11:18 |

O PostgREST registrou dois `Config reloaded` às 15:34 do mesmo dia — 4h depois da
parada, provavelmente consequência e não causa.

## O que continuou rodando (e não deveria dar conforto)

O agendador disparou 11.755 vezes nas últimas 24h e **nenhuma falhou**, porque ele
só sabe se conseguiu fazer o POST. As funções respondiam `200` com
`{"total":null,"criados":0}` — leitura falhando em silêncio. Um dia inteiro de
sistema parado sem um único alarme. É o achado 03 do diagnóstico, agora com custo
medido.

## Efeito prático

- Nada foi escrito no CRM desde domingo de manhã.
- A fila de envio não drena: `fila-processar` roda a cada minuto e devolve
  `{"emails":0,"whatsapp":0}` porque não consegue ler `fila_envio`. **Se alguém
  enfileirar uma campanha hoje, não sai.**
- Nenhum dado foi perdido: o banco está íntegro e os números estão todos lá,
  parados no retrato de domingo.

## Correção

O caminho que restaura tudo sem tocar em código é fazer o ambiente das funções
voltar a receber o **JWT legado de service_role** — as 99 funções foram escritas
para ele, e o JWT legado de anon continua sendo aceito, o que mostra que a
validação de JWT legado segue ativa no projeto.

Se a decisão for permanecer no formato novo, aí é caso de suporte da Supabase: uma
chave `sb_secret_` respondendo `PGRST303 "JWT issued at future"` com o relógio do
banco correto é comportamento de plataforma, não de configuração do projeto.

Workaround de mesmo dia, se o suporte demorar: guardar o JWT legado num secret com
outro nome (não pode começar com `SUPABASE_`, ex. `SRV_JWT`) e fazer as funções do
caminho do painel lerem `SRV_JWT ?? SUPABASE_SERVICE_ROLE_KEY`. São ~9 funções para
o painel voltar a operar hoje: campanhas-listar, campanhas-preview,
campanhas-disparar, campanhas-roteiro, campanhas-saldo, campanhas-cobranca,
campanhas-artes, fila-enfileirar e fila-processar.

## Já corrigido aqui

`campanhas-listar` fazia `String(e)` no erro, que num erro do PostgREST vira
`[object Object]`. Era por isso que o painel dizia só "erro". Agora devolve
`"JWT issued at future · PGRST303"`, e é assim que este diagnóstico saiu.


## Contorno aplicado em 24/08

O JWT legado de `service_role` foi guardado num secret chamado `SRV_JWT` (não pode
começar com `SUPABASE_`, que é prefixo reservado), e as funções passaram a resolver a
chave assim:

```ts
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
```

O fallback é de propósito: no dia em que a plataforma voltar a injetar uma chave aceita,
basta apagar o secret e nada precisa ser redeployado.

### Já no ar com o contorno

| função | verificado |
| --- | --- |
| `campanhas-listar` | 38 campanhas, 12 ativas |
| `campanhas-preview` | Clube 77 clientes · voucher 526 · giro a vencer 119 · giro vencido 169 · sem comprar 677 |
| `campanhas-disparar` | gera modelo e público |
| `campanhas-roteiro` | 83 reps, 1.844 pontos |
| `fila-enfileirar` | lê a fila (195 enviados, 5 erro) e grava |
| `fila-processar` | lê `fila_config` de novo (antes vinha `null`) |
| `campanhas-enviar` | não usa o banco — só o CRM. Não precisou de ajuste |

### Ainda parado

Tudo o que não está na lista acima continua com a chave recusada. O que mais pesa:

- `campanhas-cron` — o rascunho diário das 08:00 não é gerado
- `master-refresh` — o núcleo não atualiza de madrugada
- `contato-escrever` e os `pipe-*` — o CRM não recebe enriquecimento
- os `*-refresh` — os snapshots do Sankhya congelam no retrato de 23/08
- `campanhas-saldo`, `campanhas-cobranca`, `campanhas-retorno` — as telas de
  Logística e Cobrança do painel continuam zeradas
- `ghl-contatos-sync`, `motor-*`, `campanhas-artes`, `fila-config`

### Vale testar antes de mexer em todas

Se a Supabase aceitar criar um secret com o nome `SUPABASE_SERVICE_ROLE_KEY` (o prefixo é
reservado, mas vale a tentativa), o valor do secret sobrepõe o injetado e as ~90 funções
restantes voltam sem nenhuma alteração de código.

## 24/08 — restauração (continuação)

O `SRV_JWT` criado pelo usuário resolveu o acesso. Cada função precisa ser
reimplantada lendo essa chave, porque o `SUPABASE_SERVICE_ROLE_KEY` injetado
pela plataforma passou a vir com um valor `sb_secret_` que o PostgREST recusa
(`PGRST303 "JWT issued at future"`). Padrão aplicado:

```ts
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
```

### Já restaurado e testado em produção

| Função | Versão | Verificação |
|---|---|---|
| campanhas-listar | 15 | 38 campanhas |
| campanhas-preview | 40 | Clube 77 / voucher 526 / giro 119+169 / sem comprar 677 |
| campanhas-disparar | 48 | rascunhos gerados |
| campanhas-roteiro | 14 | 83 reps, 1.844 pontos |
| campanhas-enviar | 25 | não usa Supabase — sem mudança |
| fila-enfileirar | 14 | 195 enviados |
| fila-processar | 14 | lê `fila_config` de novo |
| campanhas-cobranca | 7 | 200 a cobrar / 201 jurídico / R$ 2,98 mi |
| campanhas-saldo | 7 | 42 saldos no maior rep |
| campanhas-retorno | 5 | 11 grupos → 6 após refresh |
| campanhas-prep | 6 | lista de reps + mensagem com dados reais |
| campanhas-agendar | 6 | 71 grupos / 134 pedidos |
| campanhas-keyaccounts | 10 | — |
| campanhas-cron | 14 | agora devolve 500 quando alguma campanha falha |
| master-refresh | 8 | 21.015 contatos gravados |
| roteiro-refresh | 10 | 3.340 clientes / 447 inadimplentes |
| retorno-refresh | 5 | 6 retornos |
| saldo-refresh | 7 | 463 saldos |
| cobranca-refresh | 7 | 774 CNPJs → 518 grupos |
| prep-refresh | 5 | 329 pedidos |
| prep-pipe-refresh | 4 | 989 pedidos |
| agendar-refresh | 5 | 134 pedidos |
| clube-refresh | 4 | 136 contratos |
| rep-refresh | 4 | 99 reps |
| ka-refresh | 4 | — |
| entregas-refresh | 4 | 2.068 notas |
| parc-matriz-refresh | 4 | 3.735 filiais |
| carteira-refresh | 6 | 9.596 clientes |
| cache-refresh | 12 | 1.050 parceiros / 2.655 contatos / 78 reps / 1.218 giro |
| resumo-refresh | 5 | 120 resumos por lote |
| digital-refresh | 5 | 200 por lote |
| nitron-flag | 6 | 10.413 contatos no CRM |
| pipe-recompra | 11 | 20 cards atualizados |
| pipe-saldo | 6 | 463 no snapshot |
| pipe-clube | 6 | 15 cards atualizados |
| pipe-cobranca | 11 | 518 grupos |
| pipe-preparacao | 6 | 994 no snapshot |
| pipe-entregas | 6 | 2.068 notas |
| pipe-representantes | 5 | — |
| pipe-keyaccounts | 5 | 123 grupos |
| pipe-novos | 6 | 2.413 cards |
| pipe-inativos | 4 | 1.065 inativos / 61 já arquivados |
| contato-escrever | 8 | — |

### O que a queda expôs além da chave

Três defeitos que existiam antes e que fizeram 24h de parada passar sem alarme:

1. **`query()` do Sankhya não conferia o status.** Um erro do ERP virava lista
   vazia; o atualizador então apagava o snapshot inteiro e gravava zero linhas.
   Corrigido nos atualizadores: erro do Sankhya agora estoura.
2. **`delete`/`insert`/`update` sem checagem de erro.** Falha de escrita não
   aparecia em lugar nenhum. Agora estoura.
3. **Nenhuma guarda antes do `delete`.** Cada atualizador agora aborta *antes*
   de apagar quando o Sankhya não devolve nada.

### Correções de conteúdo achadas no caminho

- `campanhas-retorno` e `campanhas-agendar`: o contexto mandado para a IA tinha
  um template quebrado (`Detalhe:\n" + bd.join("\n")}` dentro de template
  literal), então a IA **nunca via a lista de NFs/pedidos**. Corrigido.
- `campanhas-prep`: sem os marcadores `[REP]`/`[LISTA]` explícitos no prompt, a
  IA inventava nome de pessoa e pedidos falsos. Marcadores de volta + trava
  `temMarcadores()` que descarta o texto e usa o modelo fixo se faltar algum.
- Tom de parceria com o representante aplicado em `campanhas-retorno`,
  `campanhas-prep`, `campanhas-agendar` e `campanhas-keyaccounts` (além de
  `campanhas-disparar`, `campanhas-saldo` e `campanhas-cobranca` na semana).

### Segunda leva (mesma correcao, resto do sistema)

| Função | Versão | Verificação |
|---|---|---|
| campanhas-bulk | 5 | — |
| campanhas-artes | 11 | 9 artes vindas do GHL ao vivo |
| campanhas-redes | 8 | 91 redes; roteiro com tom de parceria |
| campanhas-ia-propoe | 4 | — |
| fila-config | 4 | cadência lida (120s / lote 25) |
| contato-escrever | 8 | — |
| contatos-criar | 6 | — |
| rep-contato | 10 | — |
| rep-rastreio | 4 | — |
| motor-buscar | 6 | responde: **parado por saldo** (394 < piso 400) |
| motor-classificar | 4 | sem alvos |
| motor-validar | 6 | sem números pendentes |
| motor-dossie | 5 | sem alvos |
| motor-contatos | 8 | painel responde |
| motor-painel | 4 | 1.406 com dossiê / 886 prontos |
| motor-saude | 4 | — |
| motor-saldo | 4 | — |
| motor-prontos | 4 | — |
| motor-pedir | 5 | — |
| motor-templates | 4 | — |
| ghl-contatos-sync | 14 | 61 contatos / 23 clientes em 3 páginas |
| sankhya-cross | 11 | — |
| cross-sell-abc | 6 | 3.327 clientes, 3.326 com recomendação |
| cep-geocode | 5 | 2.881 CEPs, fila zerada |
| saldo-dedup | 7 | fila vazia |
| entregas-dedup | 5 | — |
| recompra-demote | 5 | — |
| recompra-reap | 4 | — |
| host-upload | 8 | reenvio byte-idêntico do gestor.html (md5 igual) |
| relatorio-coletar | 10 | **93 conversas / 41 de negócio / 635 mensagens em 24/08** |
| relatorio-transcrever | 16 | — |
| relatorio-analisar | 9 | — |
| relatorio-entregar | 9 | — |
| relatorio-ver | 4 | — |

`relatorio-cron` não precisou de mudança: ele chama as outras funções com a
chave **publishable**, que continua válida.

### Regra do roteiro estendida

`campanhas-redes` passou a ler `roteiro_cliente_apto` (a mesma view do roteiro
por prioridade), então o store-check de rede também deixa de fora quem tem
pendência ou está com o giro em dia. O rótulo "em dia (Nd)" na lista virou
"compra recente (Nd)" — dizia "em dia" para cliente que a regra oficial não
considera em dia, e isso contradizia a instrução.

### Ainda pendente

- **Funções de outras empresas do grupo** com a mesma chave antiga (fora do
  escopo Nitron, mas quebradas do mesmo jeito): `copiloto-*`, `emp-diag`,
  `emp-erp-refresh`, `emp-conversas-classificar`, `hyak-contatos-sync`,
  `roga-*`, `constelacao-*`, `produtos-sankhya-sync`, `anuncio-*`, `ml-*`.
  A correção é a mesma linha do `srvKey()`.
- `entregas-nuke` (ferramenta destrutiva de uso manual, sem cron) também
  segue com a chave antiga. Ela falha fechada: sem leitura, não apaga nada.
- **Motor de prospecção parado por crédito**, não pela chave: saldo 394 no
  ScrapeGraphAI contra um piso de 400. Recarregar para o enriquecimento voltar.
- Ticket para o suporte da Supabase: o secret reservado
  `SUPABASE_SERVICE_ROLE_KEY`, descrito como "Legacy service role key", está
  sendo populado com um valor `sb_secret_`. `set role service_role` funciona e o
  relógio do banco está correto — é defeito do lado da plataforma.
- Quando a Supabase corrigir, o `SRV_JWT` pode sair: o `srvKey()` já dá
  preferência a ele mas volta sozinho para o secret padrão se ele for removido.
- Os dois P0 do diagnóstico continuam abertos: revogar INSERT/UPDATE/DELETE do
  `anon` + RLS + login na frente do painel; e os três cron jobs em 401
  (`ml-calc-batch` ×2, `sankhya-cross` — este último já corrigido na chave, mas
  o cron precisa ser reconferido).
