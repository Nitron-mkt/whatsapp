# Máquina de Vendas — como começar numa conta nova

> **Para que serve este arquivo:** abrir um chat novo do Claude Code para **outra empresa do grupo**
> (Mundo UD, Teak, Mood Fruits, Hyak) sem ter de recontar tudo. Abra o chat no mesmo repositório e
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
As outras quatro estão cadastradas na tela, marcadas `(a configurar)`, e não têm dado.

```
Sankhya (Oracle, ERP)  ──►  Supabase (Postgres + Edge Functions)  ──►  GHL (CRM)  ──►  ZaptosWPP  ──►  WhatsApp
     dados do negócio          snapshot, regras, fila de envio        contato/mensagem   instância      celular
                                          │
                                          └──►  painel HTML (gestor + agenda)
```

**Projeto Supabase:** `integracao-crm-sankhya` — `bwbeieumxcuomtrvlqxs`
**Painel:** <https://gestordecampanhas.marketing-da5.workers.dev/> · agenda em `/agenda`
**Repositório:** `Nitron-mkt/whatsapp`, branch de trabalho `claude/supabase-access-8190et`

### As cinco empresas (em `app/gestor.html`, `var EMPRESAS`)

| id | nome | CODEMP (Sankhya) | pronto |
|---|---|---|---|
| `nitron` | Grupo Nitron (Plásticos) | 1, 2, 14 | ✅ **sim** |
| `mundo_ud` | Mundo UD | 4 | ❌ |
| `teak` | Teak Brazil | 8, 21 | ❌ |
| `mood` | Mood Fruits | 16, 9 | ❌ |
| `hyak` | Hyak Internacional | 5, 7 | ❌ |

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

Cada empresa é uma **subconta (location) diferente** do mesmo GHL. Já mapeadas na agência:
`Mundo UD` = `uhiDA222WYxSm5q0eUuj` (MOOD FRUITS aparece nesse nome — confirmar), `NTR` =
`rsXZamdWnve5YumHetsU`, e outras. **Confirmar location por empresa antes de qualquer envio** —
mandar para a subconta errada cria contato no CRM errado.

> **Decisão a tomar (não tomada):** transformar `LOC` em cadastro (`empresa_ghl`) ou duplicar as
> funções por empresa. Cadastro é melhor; duplicar é mais rápido e piora a manutenção.

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
