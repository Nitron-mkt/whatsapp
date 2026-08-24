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
