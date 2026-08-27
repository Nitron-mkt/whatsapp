# Máquina de Vendas — como começar numa conta nova

> **Para que serve este arquivo:** abrir um chat novo do Claude Code para **outra empresa do grupo**
> (Mundo UD, Teak, Mood Fruits, Hyak, Roga Village) sem ter de recontar tudo. Abra o chat no mesmo repositório e
> mande:
>
> ```
> Leia docs/nova-conta-como-comecar.md e vamos configurar a empresa <NOME>.
> ```
>
> Este documento é o **estado real em 26/08/2026**, conferido no código e no banco — não é plano.
> Onde algo está pendente ou quebrado, está escrito que está.

---

## 1. O que existe hoje

Uma máquina de campanhas que roda **uma empresa só**: o Grupo Nitron (Plásticos).
As outras cinco estão cadastradas na tela, marcadas `(a configurar)`, e não têm dado.

```
Sankhya (Oracle, ERP)  ──►  Supabase (Postgres + Edge Functions)  ──►  GHL (CRM)  ──►  ZaptosWPP  ──►  WhatsApp
     dados do negócio          snapshot, regras, fila de envio        contato/mensagem   instância      celular
                                          │
                                          └──►  painel HTML (gestor + agenda)
```

**Projeto Supabase:** `integracao-crm-sankhya` — `bwbeieumxcuomtrvlqxs`
**Painel:** <https://gestordecampanhas.marketing-da5.workers.dev/> · agenda em `/agenda`
**Repositório:** `Nitron-mkt/whatsapp`, branch de trabalho `claude/supabase-access-8190et`

### As seis empresas (em `app/gestor.html`, `var EMPRESAS`)

| id | nome | CODEMP (Sankhya) | location do GHL | pronto |
|---|---|---|---|---|
| `nitron` | Grupo Nitron (Plásticos) | 1, 2, 14 | `rZ8y7lzqV7fzxsartaX2` | ✅ **sim** |
| `mundo_ud` | Mundo UD | 4 | `b461C1a4cou5XvykmQ1l` | ❌ |
| `teak` | Teak Brazil | 8, 21 | `DRhJc78pTfF9dlaH5NK9` | ❌ |
| `mood` | Mood Fruits | 16, 9 | `uhiDA222WYxSm5q0eUuj` | ❌ |
| `hyak` | Hyak Internacional | 5, 7 | `NBJY3ZnA7qSrYyEi0wl7` | ❌ |
| `roga` | Roga Village | 12 | `uqZMP3rxrdHqMHPQYRAp` | ❌ (ver §9) |

As locations foram conferidas uma a uma na API do GHL em 26/08/2026. **A versão anterior deste
documento trocava duas:** dizia que `Mundo UD` era `uhiDA222WYxSm5q0eUuj`, que na verdade é a
`MOOD FRUITS BRASIL COMERCIO EXPORTACAO LTDA`. Mandar por esse id criaria contato na subconta errada
— exatamente o que a §3.1 manda evitar.

---

## 2. Como as peças se ligam

### 2.1 Dados: Sankhya → snapshot

`cache-refresh` consulta o Oracle do Sankhya via `DbExplorerSP.executeQuery` (login por
`MobileLoginSP.login`, resposta em **ISO-8859-1** — decodificar, senão os acentos viram lixo) e grava
tabelas `snap_*` no Postgres. As campanhas **nunca** leem o Sankhya direto: leem o snapshot.

Roda de 3 em 3 horas (cron `cache-refresh-3h`).

### 2.2 Regras: views

Quem entra em cada campanha é uma **view**, não código espalhado. Exemplos:

- `voucher_cli` / `voucher_cli_todos` — quem tem voucher, com `perc_voucher`, `perc_adic`, `dtvalidade`
- `rep_carteira` — carteira de cada representante
- `rep_instancia` — **fonte única** de qual assistente/instância atende cada representante
- `roteiro_cliente_apto` — quem entra no roteiro de visitas (com as exclusões documentadas na migração)
- `agenda_catalogo` / `agenda_realizado` / `agenda_espera` — a agenda
- `fila_trava_catalogo` / `fila_trava` / `fila_trava_resumo` — **por que uma mensagem não saiu**
- `fila_conferencia` — clientes × destinos × linhas (os três números que pareciam se contradizer)

### 2.3 Envio: a fila

```
painel ──► fila-enfileirar (POST) ──► tabela fila_envio (status pendente)
                                              │
                        cron fila-processar-1min (1×/min)
                                              │
                                              ▼
                                     campanhas-enviar  ──► GHL ──► ZaptosWPP
```

- `fila_config` manda no ritmo: `wpp_ativo`, `email_ativo`, `wpp_intervalo_seg`, `wpp_burst`,
  `wpp_burst_min_seg`/`max_seg` (espera **sorteada** entre as mensagens de uma rajada — cadência de
  metrônomo é um dos sinais que derruba número), `email_lote`.
- `campanhas-enviar` é a **única porta** para o WhatsApp. Toda trava vive nela.
- `fila-acao` cancela / reenviar / parar / retomar.

### 2.4 O painel

`app/gestor.html` e `app/agenda.html` são **SPAs de arquivo único**, sem build. Vão para o Storage
(bucket `app`) e a função `gestor` serve por caminho.

```bash
# publicar (o path vai na QUERY, o corpo é o HTML CRU — não JSON)
curl -X POST "https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/host-upload?path=gestor.html" \
  -H "Authorization: Bearer <ANON>" -H "Content-Type: text/plain" \
  --data-binary @app/gestor.html
```

**Sempre confira o md5 publicado ANTES de subir** — já houve perda de trabalho de outra pessoa por
sobrescrita:

```bash
curl -s "https://gestordecampanhas.marketing-da5.workers.dev/" | md5sum   # deve bater com a sua base
md5sum app/gestor.html && curl -s "https://gestordecampanhas.marketing-da5.workers.dev/" | md5sum  # depois: iguais
```

---

## 3. O que está PRESO à conta Nitron (a lista de trabalho)

Isto é o que precisa de ajuste para outra empresa. Foi levantado no código, não de memória.

### 3.1 `locationId` do GHL, chumbado em 5 funções

```
const LOC = "rZ8y7lzqV7fzxsartaX2";   // Nitron
```

Está em: `campanhas-enviar`, `campanha-dono`, `campanhas-comunicado`, `rep-instancia-sync`,
`rep-instancia-atribuir`.

Cada empresa é uma **subconta (location) diferente** do mesmo GHL. A tabela da §1 tem o id de cada
uma, conferido na API. **Confirmar location por empresa antes de qualquer envio** — mandar para a
subconta errada cria contato no CRM errado.

> **Decisão a tomar (parcialmente resolvida):** a tabela de cadastro que esta seção propunha criar
> **já existe** — é a `public.empresa` no Supabase, com `codigo`, `codemp`, `ghl_location`,
> `linha_negocio`, `descricao_ia` e `ativa`, e já traz as seis empresas. O que falta não é criar o
> cadastro: é fazer as 5 funções **lerem** dele em vez do `const LOC`. Enquanto isso não acontecer,
> `LOC` continua sendo a Nitron em toda chamada, venha de onde vier o pedido.

### 3.2 IDs de campo personalizado do GHL — são por location

```
FID_CODPARC      = "HaDWHgnJSjDDdPF7XFDH"   // CODPARC do Sankhya no contato
voucher_pct      = "II773kLNc7R4Pw278zcf"   // contact.voucher_positivacao
voucher_adic     = "h6yFBPOnoe4af0BDWNIB"   // contact.adicional_positivacao
voucher_total    = "8YX7LVJcbwiqD8dHwUSe"   // contact.total_pontos
voucher_validade = "sQsGU460EXuId97hpKEi"   // contact.voucher_validade
```

Em `campanhas-enviar`, tabela `CAMPO` (id + merge tag juntos, de propósito). Numa location nova esses
ids **não existem**: criar os campos e refazer o de-para.

**Pegadinha do GHL:** o `fieldKey` é derivado do nome e a derivação é **perdida** — `% do Saldo
Atendível` virou `contact._do_saldo_atendivel`, `Positivação` virou `contact.positivao`. **Nomeie
campo sem `%` e sem acento.**

### 3.3 CODEMP no SQL do Sankhya

`cache-refresh` tem `CODEMP IN (1,2,14)` em quatro pontos. Trocar pelos CODEMP da empresa
(tabela na seção 1).

### 3.4 Cadastro de instâncias de WhatsApp

Tabela `instancia_ghl`: `instancia` (nome no ZaptosWPP), `usuario_ghl_id` (usuário do GHL),
`escopo` (`rep` ou `cliente`), `ativa`.

**A regra mais importante de todo o sistema:**

> O número de saída do WhatsApp é o do **`assignedTo` do contato** no GHL.
> `#contact_instance:<token>` governa só a atribuição de **entrada**.
> **`fromNumber` NÃO funciona** — testado em 26/08: mandei com `fromNumber: +5511913243207` e a
> mensagem saiu pela dona do contato (`userId` da Juliete). Não tente de novo.

Consequência: para mandar por um número, o contato tem de ser **daquele usuário**. É o que
`campanha-dono` faz — empresta o contato e **registra o dono anterior** para poder devolver.

### 3.5 Segredos do projeto (Edge Functions)

| segredo | para que |
|---|---|
| `SRV_JWT` | chave de serviço. **Necessário:** a plataforma injeta em `SUPABASE_SERVICE_ROLE_KEY` um valor `sb_secret_` que o PostgREST recusa com **PGRST303**. Todas as funções usam `Deno.env.get("SRV_JWT") \|\| Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` |
| `GHL_TOKEN` | API do GHL |
| credenciais Sankhya | login do `MobileLoginSP` |

---

## 4. Roteiro para ligar uma empresa nova

Na ordem. Não pule o 6.

1. **Confirmar a location do GHL** da empresa e anotar o id.
2. **CODEMP**: rodar `cache-refresh` com os CODEMP dela e conferir se o snapshot veio com volume
   plausível (comparar contagem de parceiros com o Sankhya).
3. **Campos personalizados no GHL**: criar CODPARC e os do voucher na location nova, sem `%` e sem
   acento no nome, e anotar os ids.
4. **Instâncias**: cadastrar em `instancia_ghl` as instâncias do ZaptosWPP dessa empresa, com
   `usuario_ghl_id` e `escopo`. Sem isso o WhatsApp é **recusado** (é proposital).
5. **Marcar `pronto:true`** na `var EMPRESAS` do painel.
6. **Teste com UM destinatário seu**, e conferir no GHL que a mensagem foi **entregue** — não que foi
   "aceita". Ver seção 5.

---

## 5. Erros que já custaram caro (leia antes de disparar)

### 5.1 "Aceito" não é "entregue"

Em 26/08 oito mensagens foram marcadas `enviado` e **nenhuma chegou**: a instância "Campanhas Nitron"
estava desconectada. O GHL aceitou o POST (`status: sent`) e o ZaptosWPP respondeu **na própria
conversa**:

```
[System]: Campanhas Nitron - The instance is disconnected.
```

`campanhas-enviar` marcava `ok` no 2xx do GHL. **Ainda falta** a pós-checagem que lê essa resposta
do sistema e marca erro (pendência aberta). Até existir: depois do primeiro envio de um lote,
**abrir a conversa no GHL e conferir**.

E cuidado: em modo rajada (`wpp_burst > 1`) o `fila-processar` manda `exigir_confirmacao: false`,
que desliga a única checagem que poderia ter travado o lote na primeira linha.

### 5.2 A aba manda no público

O botão "Criar fila e enviar" juntava o que estava marcado nas **duas** abas, e todo representante
nascia com o checkbox **marcado**. Resultado: uma campanha só para clientes saiu também para 89
representantes. Corrigido em 26/08 (`publicoAtivo()` lê a aba; rep não nasce marcado; a tela diz o
que vai sair antes do clique). **Se você duplicar o painel para outra empresa, não reintroduza o
`checked`.**

### 5.3 Tag do template que o de-para não conhece sai VAZIA

Quem troca as `{{...}}` do template do GHL **somos nós** (baixamos o HTML e renderizamos), não o GHL.
Tag fora do mapa de `preencher()` sai em branco — o e-mail do voucher ia sair com
"desconto total de&nbsp;&nbsp;%". Use o modo **"com nossos dados"** da prévia da arte: ele passa pelo
mesmo caminho do envio e lista em vermelho as variáveis que sairiam vazias.

### 5.4 `ON CONFLICT` não aponta para índice parcial

Um `unique (...) where devolvido_em is null` fez todo upsert do PostgREST falhar, o código não olhou
o erro, e nove contatos trocaram de proprietário **sem registro para desfazer**. Se for usar
`onConflict`, a constraint tem de ser **unique de verdade**, e **olhe o erro do upsert**.

### 5.5 `create or replace view` não reordena coluna

Coluna nova em view existente só entra **no fim** do select. Não tente inserir no meio.

### 5.6 Cadência é quantizada pelo cron

O cron roda 1×/min, então o espaçamento real é múltiplo de 60s acima de `wpp_intervalo_seg`
(120 → 120s; 140 → 180s). Para mais de uma por minuto, use `wpp_burst`.

### 5.7 Contar e listar são perguntas diferentes

O resumo da fila contava as **últimas 200 linhas** e a tela mostrava esse número como se fosse o
total da campanha — daí "cada tela mostra um valor diferente". Corrigido em 26/08 (`count exact`).
Ao fazer tela nova: **se o número é um total, conte no banco.**

---

## 6. Regras de segurança em vigor (não violar)

- **Nunca** clicar em "Disable JWT-based API keys" no Supabase → Settings → API Keys → Legacy. O
  painel depende da chave anon legada embutida no HTML.
- **Não** regenerar nem apagar chave de API; **não** trocar senha.
- **Nunca** colar chave de serviço em chat. Ela dá acesso total ao banco.
- O `anon` está **embutido no HTML público** do painel. Por isso escrita em `fila_envio` passa por
  Edge Function (`fila-acao`), e não por PostgREST direto.
- **P0 aberto:** o `anon` ainda tem INSERT/UPDATE/DELETE em tabelas e não há login na frente do
  painel. Quem for mexer em permissão, comece por aqui.

---

## 7. Pendências conhecidas (herdadas)

| # | pendência |
|---|---|
| 1 | Pós-checagem de entrega: ler a resposta do ZaptosWPP na conversa e marcar erro em vez de `enviado` |
| 2 | Pré-checagem: não gastar linha se a instância estiver desconectada |
| 3 | `ghl-contatos-sync` ainda tem chave de serviço **chumbada no fonte** — tirar |
| 4 | `BIND_MARGEM_MS` em 20s por mensagem (sobra de diagnóstico descartado) |
| 5 | `LOC` chumbado em 5 funções (seção 3.1) |
| 6 | P0: revogar escrita do `anon` + RLS + login no painel |
| 7 | Cron `ml-calc-batch` devolvendo 401 |
| 8 | Worker do Cloudflare: `/logistica` e `/cobranca` dão 404 |
| 9 | Workflow de resposta no GHL (o GHL **não tem** endpoint de criação de workflow — só `GET /workflows/` e `add-contact-to-workflow`); paliativo é o cron `campanha-dono-varrer-5min` |
| 10 | 8 representantes com problema de dado (telefone compartilhado, duplicados, sem contato no CRM) |
| 11 | 3 clientes com **dois e-mails colados** num campo do Sankhya |
| 12 | Ticket no Supabase sobre `SUPABASE_SERVICE_ROLE_KEY` vir como `sb_secret_` |

---

## 8. Como trabalhar (o que funcionou aqui)

- **Conserte o dado, não oito funções.** Quando as campanhas antigas estavam com instância errada, a
  correção foi um *trigger* na origem, não editar cada função.
- **Uma fonte de verdade por assunto.** `rep_instancia` para instância; `CAMPO` para campo do CRM;
  `fila_trava_catalogo` para motivo de falha. Duas listas do mesmo assunto divergem — sempre.
- **Prévia tem de usar o caminho do envio.** Prévia com regra própria mente, e mentiu.
- **Toda trava recusa alto.** Sem instância, dono divergente, troca não confirmada: **não manda**.
  Mensagem pelo número errado é pior do que mensagem não enviada.
- **Antes de mexer no painel publicado, confira o md5.**
- Comentário no código explica **por que**, com o caso real que motivou. É o que evitou refazer erro.

---

## 9. Roga Village — o levantamento de 26/08/2026

Esta empresa **não segue o roteiro da §4**, e é importante entender por quê antes de tentar ligá-la.
Tudo abaixo foi medido no Sankhya e na API do GHL na data, não é suposição.

**Identificação (confirmada em três fontes independentes):** `CODEMP 12` no Sankhya (ROGA VILLAGE
HOTEIS E EVENTOS LTDA, CNPJ 43.647.356/0001-24), location `uqZMP3rxrdHqMHPQYRAp` no GHL, e a linha
`ROGA` da tabela `public.empresa`, que já trazia exatamente esses dois valores.

### 9.1 O ERP dela não tem venda — tem contas a pagar

A Roga tem 976 notas nos últimos 12 meses, o que à primeira vista parece uma base pronta. Não é.
Abrindo por tipo de operação, **nenhuma é de venda**:

| TOP | operação | TIPMOV | notas |
|---|---|---|---|
| 2106 | Compra Servicos (Red) | C | 580 |
| 2001 | Pedido Compra Consumo | O | 160 |
| 2101 | Compra Consumo | C | 152 |
| 2102 | Compra Serviço | C | 62 |
| 2104 | Compra Energia Eletrica | C | 9 |
| 3132 | Pedido de Venda B2B | P | 8 (R$ 114 no total) |

Os 298 "parceiros" com movimento são **fornecedores do hotel** — quem vende energia, serviço e
consumo *para* a Roga. A qualidade de contato deles é ótima (296 com telefone, 297 com e-mail), e é
justamente isso que torna o erro fácil de cometer: é uma lista limpa, grande e **completamente
errada** para campanha. Disparar para ela é mandar oferta de hospedagem para a distribuidora de
energia.

Consequência prática: `cache-refresh` filtra `TIPMOV='V'` e o universo dele é `AD_PARCEIRO` com
contrato de clube ou percentual de campanha. Rodar com `CODEMP 12` devolve **zero linha** — e o
`trocar()` aborta antes de apagar o snapshot (a trava da v5 funcionando como projetado). Trocar o
CODEMP, que é o passo 2 da §4, **não resolve nada aqui**.

### 9.2 Onde o dado realmente está: no CRM, não no ERP

Na Nitron o público nasce no Sankhya e é empurrado para o GHL. **Na Roga é o contrário.** A location
tem **10.069 contatos** e está viva: no dia do levantamento entraram leads às 12h54, 14h35, 16h38,
20h02 e 20h27, vindos do site `rogavillage.com.br`, do formulário "Solicitacao de proposta" e do
Instagram, com tags (`reserva-roga`) e oportunidade aberta em pipeline.

Cinco pipelines em uso: **Eventos Corporativos** (11/2025), **Hospedagem Lazer** (03/2026), e
**Eventos Sociais**, **Business Club** e **Retorno do Hospede** (todos 19/08/2026).

O PMS existe no Sankhya como um módulo `AD_HOT*` (`AD_HOTUH` tem as 18 unidades habitacionais), mas
está **vazio de operação**: 4 reservas, 0 hóspedes em `AD_HOTRESHOSP`, 0 eventos, 0 web check-in.
Cuidado com `AD_HOTPERM`, que tem 391 linhas e parece movimento: é tabela de **permissão de tela**
(`NUPERM, CODUSU, TELA, TIPO`), não de hospedagem.

### 9.3 O passo 3 da §4 já foi feito — e está vazio

Em 19/08/2026, na mesma hora em que a linha `ROGA` da tabela `empresa` foi atualizada, alguém criou
na location a estrutura de campos da Máquina de Vendas:

| campo | fieldKey | id |
|---|---|---|
| CODPARC (Sankhya) | `contact.codparc_sankhya` | `2YDgTx29anFercto5VRu` |
| Ultima Estadia | `contact.ultima_estadia` | `YfH5514OxuVPeBOloOlV` |
| Estadias (total) | `contact.estadias_total` | `n7HGqjaGRnjNdxR5FdC1` |
| Estado do Ciclo | `contact.estado_do_ciclo` | `RnRQa6dlqOLTJAx7wkE5` |
| Canal Preferido | `contact.canal_preferido` | `JcNu14is9AQR9UztegY9` |
| Valor Vencido | `contact.valor_vencido` | `jA3zKeCbo2GLOUcVRHs1` |
| Ficha Roga (IA) | `contact.ficha_roga_ia` | `kZEoIWNYUvy1Tbd4vABr` |

Quem fez conhecia a pegadinha da §3.2: nenhum nome tem `%` ou acento, e os `fieldKey` saíram todos
limpos. O pipeline **Retorno do Hospede** espelha estágio a estágio o placeholder do Estado do Ciclo
(`HOSPEDE_ATIVO / A_VOLTAR / DORMENTE / PERDIDO / SO_EVENTO`).

**Só que os campos estão 100% vazios:** zero contatos com CODPARC preenchido, zero com Estado do
Ciclo. E não é descuido — os placeholders (`codigo do parceiro no ERP`, `resumo do ERP para a IA`)
mostram que foram desenhados para receber estadia e consumo **do Sankhya**, que é exatamente o dado
que a §9.1 mostra não existir lá. O preparo parou onde tinha de parar.

### 9.4 Não há instância de WhatsApp, e o cadastro não sabe separar empresa

A location tem 10 usuários, todos pessoas (equipe da Roga, dois da agência, um da Nitron). **Não
existe usuário de campanhas** equivalente ao "Nitron Campanhas" da §3.4, então o passo 4 da §4 não
tem o que cadastrar hoje.

E há uma trava a respeitar antes de cadastrar: **`instancia_ghl` não tem coluna de empresa.** O
painel escolhe a instância de cliente com

```
instancia_ghl?ativa=eq.true&escopo=eq.cliente&select=instancia&order=instancia&limit=1
```

— a **primeira em ordem alfabética**, sem filtrar empresa. Cadastrar hoje uma instância de cliente da
Roga com nome que venha antes de "Campanhas Nitron" faria **a Nitron passar a disparar pelo número da
Roga**, silenciosamente. Antes de cadastrar instância da Roga, `instancia_ghl` precisa de coluna de
empresa e a consulta precisa filtrar por ela.

### 9.5 Por que `pronto` continua `false`

O seletor de empresa do painel é, hoje, uma casca: `trocarEmpresa()` só mostra ou esconde o catálogo.
As consultas (`campanhas-listar`, `rep_instancia`, `instancia_ghl`) **não recebem empresa nenhuma**, e
as tabelas que elas leem — `campanhas`, `fila_envio`, `snap_parceiro`, `instancia_ghl` — **não têm
coluna de empresa**. Só a `public.empresa` tem o cadastro; o resto do banco é mono-empresa.

Marcar `pronto:true` na Roga sem isso não mostraria a Roga: mostraria **os dados da Nitron sob o nome
Roga Village**, com envio saindo pelo `LOC` da Nitron (§3.1). Por isso ela entrou na `var EMPRESAS`
com `pronto:false`, como as outras quatro.

### 9.6 O que fazer para ligar a Roga, na ordem

O roteiro da §4 assume Sankhya → GHL. Para a Roga a ordem é outra:

1. **Isolar empresa no banco** antes de qualquer envio: coluna de empresa em `instancia_ghl`,
   `campanhas` e `fila_envio`, e filtro por empresa nas consultas do painel. É pré-requisito das
   duas travas acima, não melhoria.
2. **Trocar o `const LOC` por leitura da `public.empresa`** nas 5 funções (§3.1) — o cadastro já
   existe e já tem a location da Roga.
3. **Decidir a fonte do público**, que é a pergunta de negócio de verdade: os 10.069 contatos do
   próprio GHL (disponível hoje) ou o PMS `AD_HOT*` depois que entrar em operação (não é hoje). Se
   for o GHL, a Máquina de Vendas da Roga não precisa de `cache-refresh` nem de `snap_*` — precisa de
   uma leitura da própria location. Isso é decisão de arquitetura, e é do gestor.
4. **Criar a instância de WhatsApp** da Roga no ZaptosWPP com usuário próprio no GHL, e só então
   cadastrar em `instancia_ghl` (já com a coluna do passo 1).
5. Só depois: `pronto:true` e o teste com **um** destinatário, conferindo entrega no GHL (§5.1).

### 9.7 O mapa do CRM da Roga (medido em 26/08/2026)

Levantado com a decisão já tomada de trabalhar em duas fases: **GHL agora, PMS quando existir.**
Isto é o retrato da fase 1 — o que dá para acionar hoje.

**A base inteira: 10.069 contatos.**

| corte | contatos | % | leitura |
|---|---|---|---|
| com telefone | 8.391 | 83% | **o canal da Roga é WhatsApp** |
| com e-mail | 1.098 | 11% | e-mail não sustenta campanha aqui |
| em DND | 0 | 0% | ninguém pediu para sair — e também **não há higiene de opt-out ainda** |
| com alguma tag | 1.080 | 11% | **89% da base não está segmentada** |

O número que importa não é 10.069, é **1.080**: o resto é massa sem qualificação nenhuma. Vale a
regra da §5.7 — se o número vai virar público de campanha, conte no destino, não no total da tela.

**Os segmentos que existem hoje:**

| tag | contatos | o que é |
|---|---|---|
| `contato-empresas` | 585 | importação CSV B2B, com Razao Social, Segmento, Departamento e CEP preenchidos |
| `agencias` | 165 | importação CSV de agências (Segmento = "Agência") |
| `mailling_paulinho` | 82 | mailing importado |
| `reserva-roga` | 33 | lead de reserva vindo do site |
| `cubo` | 19 | tipo de unidade habitacional |
| `proposta-roga` | 14 | proposta enviada |
| `business-clube` / `treinamentos` | 1 cada | praticamente vazias |
| `network` / `listafrianitron` | 0 | tag criada e nunca usada |

**Os pipelines:**

| pipeline | criado | oportunidades | ganhas |
|---|---|---|---|
| Hospedagem Lazer | 03/2026 | 61 | 3 |
| Eventos Corporativos | 11/2025 | 35 | — |
| Eventos Sociais | 19/08/2026 | 0 | — |
| Business Club | 19/08/2026 | 0 | — |
| Retorno do Hospede | 19/08/2026 | 0 | — |

Os três de 19/08 são do mesmo preparo da §9.3 e nunca foram usados. E note o tamanho do funil: **96
oportunidades e 3 ganhas** para um hotel que opera todo dia. A reserva de verdade (balcão, telefone,
OTA) **não está passando pelo CRM** — o que reforça que a fase 2 (PMS) é o que fecha o ciclo, e que
a fase 1 trabalha demanda nova, não recompra de hóspede.

> **Higienizar antes de disparar.** Há contatos de teste com tag de produção: `teste@teste.com.br`
> (tag `proposta-roga`), `contato.teste@rogavillage.com.br` (tag `treinamentos`), e telefones
> claramente falsos (`+5511789456123`, `+5511988887777`). Existe até uma tag `reserva-teste`. Numa
> base de 33 leads de reserva, um teste é 3% do disparo. Filtrar isso é pré-requisito do primeiro
> envio, não capricho.

### 9.8 A tela da Roga é outra coisa — e por quê

Decidido em 27/08 com o gestor: a Roga **não vai esperar o ERP**. A tela dela lê o CRM.

Isso não é um ajuste de configuração, é outra arquitetura. Nas cinco empresas de ERP o caminho é
`Sankhya → snap_* → view → fila`. Na Roga não há o que sincronizar: o passo 2 da §4 (trocar o CODEMP
do `cache-refresh`) devolveria zero linha, e o `trocar()` abortaria — corretamente. Então:

**`supabase/functions/roga-crm`** lê o GHL ao vivo e devolve funil, base e públicos. Duas decisões
que valem para quem copiar isto para outra empresa:

- **A location não é chumbada.** Vem de `public.empresa.ghl_location` pelo `?empresa=`. As outras 5
  funções têm `const LOC` no fonte (pendência 5); o cadastro que resolveria isso já existia e só não
  era lido. Esta lê. Serve para qualquer empresa da tabela — `?empresa=NITRON` funciona.
- **Total e distribuição vêm de fontes diferentes, de propósito.** O total de cada pipeline sai do
  `meta.total` do GHL; a distribuição por estágio sai da leitura paginada.

  Essa separação não é preciosismo — **foi um bug real, pego no teste.** A primeira versão agregava
  tudo da paginação. Rodando contra a Nitron (que tem +11 mil oportunidades), a leitura estourou o
  teto e a tela reportou `Entregas: 3.832`. O número certo é **11.441**. Pior: `Clube —
  Acompanhamento` aparecia com **0**, e tem 16 — eu quase registrei aqui que o pipeline estava
  vazio. Subcontagem de 3× que passaria por dado bom. É a §5.7 outra vez, e agora tem freio: quando
  a soma dos estágios não fecha com o total do GHL, o campo `distribuicao_parcial` marca, e a tela
  escreve em vermelho que a distribuição está incompleta **e os totais não**.

**No painel** (`app/gestor.html`), a empresa marcada `fonte:"crm"` não recebe mais o aviso genérico
de "falta sincronizar". Recebe o painel do CRM, nesta ordem deliberada:

1. **As travas primeiro.** Antes de qualquer número bonito. Quem abre a tela precisa ver o que
   impede disparar antes de se animar com 10 mil contatos.
2. **O funil ao vivo**, estágio a estágio. Estágio vazio fica **apagado, não sumido** — "ninguém
   passa por aqui" é o diagnóstico principal desta conta, e esconder a coluna esconderia o buraco.
3. **Os públicos por tag**, com as tags vazias visíveis e marcadas "tag criada, ninguém alimenta".

### 9.9 O que o CRM da Roga está dizendo (medido em 26–27/08)

**O funil existe no papel e não é percorrido.** As 61 oportunidades de Hospedagem Lazer estão em
**dois** estágios: 36 na entrada (Solicitação de Reserva) e 25 no último (Pós Vendas). Os cinco do
meio — Primeiro Contato, Cotação Enviada, Follow up, Reserva Confirmada, Hospedado — estão **zerados**.
Em Eventos Corporativos, 33 das 36 estão em Lead Novo. Ou seja: o lead entra e para, ou é despejado
no fim. Ninguém trabalha o meio.

E o fim é ruim: em Hospedagem, **22 perdidas contra 3 ganhas**. Os três pipelines criados em 19/08
(Eventos Sociais, Business Club, Retorno do Hóspede) continuam com zero.

**Há um agente de IA atendendo, e ele funciona.** Os contatos trazem `Observacao do Lead` com resumo
de conversa escrito por IA ("*buscava organizar um jantar romântico surpresa... encaminhando os dados
para a equipe especializada*") e `Objetivo do Lead` preenchido ("Restaurante: almoço/day use"). As
tags `stop bot` e `transferência humana` são desse fluxo. O gargalo **não é captação**: é o que
acontece depois que o bot entrega o lead qualificado.

**Só 94 dos 10.069 contatos têm dono** (0,9%) — e os que têm são justamente os que o bot transferiu.
Isso é a trava dura, não um detalhe de higiene: o número de saída do WhatsApp é o do `assignedTo`
(§3.4, e `fromNumber` já foi testado e não funciona). **Sem dono, a mensagem não sai.** Qualquer
campanha da Roga precisa resolver propriedade antes de resolver conteúdo.

**Entrada:** site `rogavillage.com.br`, formulário "Solicitacao de proposta", Instagram, e um quiz
hospedado em `api.hyaksales.com.br` — infraestrutura da Hyak servindo a Roga. São 12 formulários,
sendo 4 variações de Roga Business Club. A maior venda registrada (R$ 81.315) veio do quiz, com
origem "Captacao de Membros".

### 9.10 O token: o que falta para a tela acender

A função está no ar e testada, mas para a Roga responde **403**: o `GHL_TOKEN` dos segredos é da
subconta da **Nitron**, não da agência — não enxerga outra location. Por isso a função aceita
`GHL_TOKEN_<EMPRESA>` com fallback para o global, e a tela, em vez de quebrar, mostra exatamente o
que fazer.

Para acender: gerar um **Private Integration token na subconta Roga Village** (escopos
`opportunities.readonly`, `contacts.readonly`, `locations/customFields.readonly`) e gravar como
segredo `GHL_TOKEN_ROGA` nas Edge Functions. Nada mais precisa mudar — nem a função, nem o painel.
