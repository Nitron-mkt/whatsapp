# Máquina de Vendas — como começar numa conta nova

> **Para que serve este arquivo:** abrir um chat novo do Claude Code para **outra empresa do grupo**
> (Mundo UD, Mood Fruits, Hyak) sem ter de recontar tudo. Abra o chat no mesmo repositório e mande:
>
> ```
> Leia docs/nova-conta-como-comecar.md e vamos configurar a empresa <NOME>.
> ```
>
> Este documento é o **estado real em 26/08/2026**, conferido no código, no banco e nas APIs — não é
> plano. Onde algo está pendente ou quebrado, está escrito que está.

---

## 1. O que existe hoje

Uma máquina de campanhas que roda **duas empresas**: o Grupo Nitron (Plásticos) e a Teak Brazil.
As outras três estão no cadastro sem `ghl_location` e sem CODEMP, e não têm dado.

```
Sankhya (Oracle, ERP)  ──┐
                         ├──►  Supabase (Postgres + Edge Functions)  ──►  GHL  ──►  WhatsApp
GHL (contatos do CRM) ───┘        snapshot, regras, fila de envio        CRM       (ver 2.5)
                                          │
                                          └──►  painel HTML (um por empresa)
```

**Projeto Supabase:** `integracao-crm-sankhya` — `bwbeieumxcuomtrvlqxs`
**Painéis:** <https://gestordecampanhas.marketing-da5.workers.dev/> (Nitron) · `/agenda`
· Teak: `/functions/v1/gestor/teak` (a rota `/teak` do Worker depende de `wrangler deploy`, ver 7)
**Repositório:** `Nitron-mkt/whatsapp`

### As empresas (tabela `empresa`, coluna `painel_id`)

| painel_id | nome | CODEMP | universo | canal WhatsApp | pronto |
|---|---|---|---|---|---|
| `nitron` | Grupo Nitron (Plásticos) | 1, 2, 14 | clube | ZaptosWPP | ✅ |
| `teak` | Teak Brazil | 8, 21 | faturamento | nativo do GHL | ✅ |
| `mundo_ud` | Mundo UD | — | — | — | ❌ |
| `mood` | Mood Fruits | — | — | — | ❌ |
| `hyak` | Hyak Internacional | — | — | — | ❌ |

> A tabela `empresa` **já existia** antes desta sessão: é o cadastro do Motor de prospecção, com
> chave `codigo` (maiúscula) e colunas `ghl_location`, `linha_negocio`, `descricao_ia`. Não está nas
> migrações antigas e nenhuma view a lia. Ela foi **estendida**, não duplicada — havia também
> `CONSTELACAO` e `ROGA` cadastradas, que o painel nunca listou.

---

## 2. Como as peças se ligam

### 2.1 O cadastro `empresa` é a fonte de verdade

Tudo que era chumbado no fonte virou coluna. Antes de qualquer coisa, leia esta linha:

| coluna | para que |
|---|---|
| `painel_id` | chave minúscula usada pelo painel e pela coluna `empresa` das tabelas de dado |
| `codemp` | CODEMP do Sankhya, texto separado por vírgula (`"8,21"`) |
| `ghl_location` | subconta do GHL. **Sem isso, toda função recusa** |
| `ghl_token_env` | nome do secret com o token do GHL **desta** subconta |
| `campos` | jsonb com os ids de campo personalizado do GHL, que são **por location** |
| `universo` | `clube` ou `faturamento` — quem entra no snapshot (ver 2.2) |
| `canal_wpp` | `zaptos` ou `ghl_nativo` — por onde o WhatsApp sai (ver 2.5) |
| `marca` | nome que aparece no texto (`{{location.name}}`) e no assunto do e-mail |
| `teste_contact_id` | contato desta location para o modo `b.test` |
| `painel` | arquivo HTML que atende a empresa |
| `fonte_publico` | `sankhya`, `crm`, ou os dois |

### 2.2 Dados do ERP: Sankhya → snapshot

`cache-refresh?empresa=<painel_id>` consulta o Oracle via `DbExplorerSP.executeQuery` (login por
`MobileLoginSP.login`, resposta em **ISO-8859-1** — decodificar, senão os acentos viram lixo) e grava
`snap_parceiro`, `snap_contato`, `snap_rep`, `snap_giro`. Todas têm coluna `empresa`, e a troca
apaga **só as linhas daquela empresa**.

**O universo muda por empresa, e essa é a parte que engana:**

- `clube` (Nitron): `AD_PARCEIRO` onde `CONTRATO<>0 OR PERCCAMPANHA>0` — 1050 parceiros.
  Esse universo **não tem CODEMP nenhum**: é cadastro de contrato/voucher, não movimento.
- `faturamento` (Teak): quem comprou no CODEMP da empresa nos últimos 12 meses.

Era por isso que "trocar o CODEMP" nunca ia funcionar: o CODEMP só filtra faturamento e
inadimplência. Ver a seção 3.

### 2.3 Dados do CRM: GHL → snapshot de lead

`ghl-leads-refresh?empresa=<painel_id>` espelha os contatos da subconta em `snap_lead`, e os
pipelines em `snap_pipeline`. Existe porque **nem toda empresa tem o público no ERP**: na Teak são
13 clientes no Sankhya contra 2931 contatos no CRM.

Mesma regra dos `snap_*`: a campanha **nunca** fala com o GHL para montar público, lê o snapshot; e
aborta **antes** de apagar se a API não devolver nada — senão um 403 zeraria o público e a tela
mostraria "0 leads" como se fosse verdade.

### 2.4 Regras: views

Quem entra em cada campanha é uma **view**, não código espalhado. As views são **por empresa**.

Nitron: `voucher_cli`, `rep_carteira`, `rep_instancia`, `roteiro_cliente_apto`, `agenda_*`,
`fila_trava*`, `fila_conferencia`, `clube_grupo`, `giro_rep_bucket`.

Teak: `teak_lead` (base), `teak_lead_aguardando`, `teak_lead_qualificado`, `teak_lead_proposta`,
`teak_lead_feira`, `teak_lead_dormente`, `teak_lead_dado`, `teak_rep_candidato`,
`teak_cliente_recompra`, `teak_cliente_ativar`, `teak_espera`.

> **As views da Nitron têm `where empresa = 'nitron'` escrito na mão.** Não é enfeite:
> `giro_rep_bucket` e `agenda_espera` liam `snap_giro` sem filtro nenhum. E CODVEND/CODPARC são
> **globais** no Sankhya — a Teak usa os CODVEND 67, 109, 153 e 214, que também existem na Nitron —
> então sem filtro o join de `vw_rep_contato_rastreio` duplicaria contato.

### 2.5 Envio: a fila, e o canal que muda por empresa

```
painel ──► fila-enfileirar (POST) ──► fila_envio (status pendente)
                                              │
                        cron fila-processar-1min (1×/min)
                                              │
                                              ▼
                                     campanhas-enviar  ──► GHL ──► WhatsApp
```

`campanhas-enviar` é a **única porta** para o WhatsApp. Toda trava vive nela. Mas o caminho depende
de `empresa.canal_wpp`:

**`zaptos` (Nitron).** Manda `type: "SMS"` com o texto `#contact_instance:<instancia>`, espera o app
confirmar a troca na conversa, e só então manda o texto. Várias instâncias, uma por assistente.

> A regra mais importante desse canal: o número de saída é o do **`assignedTo` do contato** no GHL.
> `#contact_instance` governa só a atribuição de **entrada**. **`fromNumber` NÃO funciona** —
> testado em 26/08. Não tente de novo. É por isso que existe `campanha-dono`, que empresta o contato
> e registra o dono anterior para poder devolver.

**`ghl_nativo` (Teak).** Manda `type: "WhatsApp"` direto. É a **WhatsApp Business Cloud API da
Meta**, pelo próprio GHL: as mensagens têm `messageType TYPE_WHATSAPP` e `altId` no formato
`wamid.HBg...`. Não existe instância, não existe bind, não existe trava de proprietário — a location
tem **um número** e é por ele que sai.

> Em troca vale um limite que a Nitron não tem: a Meta só aceita **texto livre dentro de 24h** desde
> a última mensagem do cliente. Fora disso é preciso **template aprovado**. Quando o GHL recusa por
> isso, o motivo vai no `recusado` — não vira "enviado".

`fila_config` manda no ritmo: `wpp_ativo`, `email_ativo`, `wpp_intervalo_seg`, `wpp_burst`,
`wpp_burst_min_seg`/`max_seg` (espera **sorteada** entre as mensagens de uma rajada — cadência de
metrônomo é um dos sinais que derruba número), `email_lote`.

### 2.6 Os painéis

**Um painel por empresa quando o processo é diferente.** São SPAs de arquivo único, sem build, no
Storage (bucket `app`), servidas pela função `gestor` por caminho.

- `app/gestor.html` — Nitron. "Escolher campanha → montar fila → disparar", para 17 mil clientes com
  Clube, saldo e voucher.
- `app/agenda.html` — agenda de campanhas da Nitron.
- `app/teak.html` — Teak. **Não é o gestor com outra cor**: é um funil + caixa de entrada,
  organizado nos 4 pipelines que a própria Teak desenhou no CRM.

```bash
# publicar (o path vai na QUERY, o corpo é o HTML CRU — não JSON)
curl -X POST "https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/host-upload?path=teak.html" \
  -H "Authorization: Bearer <ANON>" -H "Content-Type: text/plain" \
  --data-binary @app/teak.html
```

**Sempre confira o md5 publicado ANTES de subir** — já houve perda de trabalho de outra pessoa por
sobrescrita:

```bash
md5sum app/teak.html && curl -s ".../functions/v1/gestor/teak" | md5sum   # depois: iguais
```

> Em 26/08 o `gestor.html` **publicado diverge do que está no repo**. Não sei qual é o mais novo e
> não sobrescrevi. Antes de publicar o da Nitron, resolva isso.

---

## 3. O que o roteiro antigo mandava fazer — e por que teria derrubado a Nitron

A versão anterior deste arquivo dizia, no passo 2: *"rodar `cache-refresh` com os CODEMP dela"*.
Feito ao pé da letra, isso **apagaria o snapshot da Nitron**.

Medido em 26/08 antes de mexer em nada:

- nenhuma tabela `snap_*` tinha coluna de empresa (a PK era `codparc`);
- `trocar()` fazia `delete()` da tabela inteira antes de inserir;
- com CODEMP 8,21 o `snap_giro` cairia de **1175 linhas para 2**, e o `snap_contato` de 2613 para
  ~1050 — porque o CODEMP só filtra faturamento/inadimplência, e o universo `AD_PARCEIRO` não tem
  CODEMP nenhum.

Isso está resolvido (`empresa` em todas as tabelas, `delete().eq("empresa", …)`), mas fica
registrado: **a suposição "é só trocar o CODEMP" era falsa**, e é o tipo de coisa que só aparece
lendo o código antes de rodar.

Outras três suposições que também caíram, cada uma custando uma volta:

1. **O `GHL_TOKEN` não serve para todas as empresas.** Ele é escopado a **uma location**. Chamando
   `/contacts/search` com o locationId da Teak: `403 "The token does not have access to this
   location"`. Por isso `empresa.ghl_token_env`. (O `GHL_TOKEN_TEAK` já existia nos secrets.)
2. **Os ids de campo personalizado são por location.** "Codigo Parceiro" é `HaDWHgnJSjDDdPF7XFDH` na
   Nitron e `5ZfLRhefBnUyAys0BOGU` na Teak. Mandar o id errado faz o GHL aceitar **calado** e gravar
   no campo errado.
3. **Nem toda empresa usa ZaptosWPP.** Ver 2.5.

> **Pegadinha do GHL que continua valendo:** o `fieldKey` é derivado do nome e a derivação é
> **perdida** — `% do Saldo Atendível` virou `contact._do_saldo_atendivel`, `Positivação` virou
> `contact.positivao`. **Nomeie campo sem `%` e sem acento.**

---

## 4. Roteiro para ligar uma empresa nova

Na ordem. Não pule o 8.

1. **Location do GHL.** Ache o id (`list_locations` no MCP do GHL, ou o painel da agência) e grave em
   `empresa.ghl_location`.
2. **Token.** O token do GHL é por location. Confirme que existe um secret para esta subconta e
   grave o **nome** dele em `empresa.ghl_token_env`. Teste com
   `campanhas-enviar {"diag":true,"empresa":"<id>"}`: se vier 200 e o `location` certo, o token
   serve.
3. **CODEMP e universo.** Grave `codemp` e escolha `universo`:
   - a empresa tem programa de Clube/voucher (`AD_PARCEIRO` com contrato ou `PERCCAMPANHA`)? → `clube`
   - não tem? → `faturamento`
   Confira antes, no Sankhya: `select count(*) from AD_PARCEIRO where CODPARC in (<quem compra dela>)`.
   Se der zero, é `faturamento` — e campanha de voucher teria público **zero**.
4. **Snapshot do ERP.** `cache-refresh?empresa=<id>&parte=parc`, depois `cont`, `rep`, `giro`.
   Compare com a contagem que você tirou direto do Sankhya. Se não bater, pare.
5. **Snapshot do CRM**, se a empresa tiver público lá: `ghl-leads-refresh?empresa=<id>`. Confira
   `paginacao_incompleta: false` e que `leads` == `total_informado_pelo_ghl`.
6. **Canal de WhatsApp.** Abra uma conversa de WhatsApp da empresa no GHL e olhe uma mensagem:
   - `messageType TYPE_WHATSAPP` + `altId` `wamid...` → `ghl_nativo`
   - mensagem de sistema do ZaptosWPP na conversa → `zaptos`, e aí cadastre as instâncias em
     `instancia_ghl` (com `empresa`), senão o WhatsApp é **recusado** (é proposital).
7. **Campos personalizados.** Crie no GHL o que faltar (sem `%` e sem acento) e grave os ids em
   `empresa.campos`. Campo que a empresa não tem é simplesmente ignorado — não é erro.
8. **Views, catálogo e painel.** Não copie os da Nitron sem olhar: veja a seção 4.1.
9. **Teste com UM destinatário seu**, e confira no GHL que a mensagem foi **entregue** — não que foi
   "aceita". Ver seção 5.

### 4.1 O que NÃO copiar da Nitron

A Nitron vende carteira; nem toda empresa do grupo vende. Antes de duplicar campanha, pergunte:

- **Tem Clube/voucher?** Se não, as campanhas `clube_*` e `voucher_*` têm público zero. Na Teak,
  dos 13 clientes faturados em 12 meses, **nenhum** está no universo de voucher.
- **Tem rede de representantes?** Se não, `rep_*` e `campanhas-comunicado` não se aplicam. A Teak é
  **uma pessoa** (Marcelo Carvalho, dono dos 2931 contatos do CRM e CODVEND 214 no Sankhya).
- **O que move a empresa é recompra ou o lead andar no funil?** Na Teak é o funil — por isso o
  painel dela é organizado nos pipelines do CRM, e não nos pipes da Nitron.
- **A empresa já desenhou o processo dela em algum lugar?** A Teak tinha **4 pipelines prontos** no
  GHL (Novos Clientes, Ciclo de Recompra, Key Accounts, Recrutamento de Força de Vendas). Foi o
  achado mais útil do levantamento: a estrutura da empresa já estava descrita no CRM dela.

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

**No canal `ghl_nativo` o mesmo erro aparece do outro lado**: fora da janela de 24h a Meta recusa
texto livre. Isso agora vira `recusado` com o motivo escrito, e não "enviado".

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

> As **merge tags** ficam no código (`TAG`) e só os **ids** vêm do cadastro. A tag é contrato do
> template; o id é por location. São coisas diferentes com ciclos de vida diferentes.

### 5.4 `ON CONFLICT` não aponta para índice parcial

Um `unique (...) where devolvido_em is null` fez todo upsert do PostgREST falhar, o código não olhou
o erro, e nove contatos trocaram de proprietário **sem registro para desfazer**. Se for usar
`onConflict`, a constraint tem de ser **unique de verdade**, e **olhe o erro do upsert**.

### 5.5 `create or replace view` não reordena coluna

Coluna nova em view existente só entra **no fim** do select. Não tente inserir no meio. E se a view
que depende dela foi criada como `select *, algo`, a coluna nova **empurra o nome** e o Postgres
recusa (`cannot change name of view column`): ali é `drop` + `create`, na ordem certa.

### 5.6 Cadência é quantizada pelo cron

O cron roda 1×/min, então o espaçamento real é múltiplo de 60s acima de `wpp_intervalo_seg`
(120 → 120s; 140 → 180s). Para mais de uma por minuto, use `wpp_burst`.

### 5.7 Contar e listar são perguntas diferentes

O resumo da fila contava as **últimas 200 linhas** e a tela mostrava esse número como se fosse o
total da campanha — daí "cada tela mostra um valor diferente". Corrigido em 26/08 (`count exact`).
Ao fazer tela nova: **se o número é um total, conte no banco.**

### 5.8 Vazio não é a mesma coisa que não carregado

Uma lista vazia porque a ingestão falhou parece uma lista vazia porque não há ninguém. O painel da
Teak diz qual dos dois é, e `ghl-leads-refresh` devolve `paginacao_incompleta` comparando com o
total que o próprio GHL informa.

### 5.9 Parâmetro que a assinatura recebe e o corpo ignora

`function ghl(tok, ...)` recebendo o token e o header continuando com `Deno.env.get("GHL_TOKEN")`:
compila, passa no `deno check`, e só quebra na location de outra empresa. Achado em duas funções ao
ler o arquivo inteiro antes do deploy.

---

## 6. Regras de segurança em vigor (não violar)

- **Nunca** clicar em "Disable JWT-based API keys" no Supabase → Settings → API Keys → Legacy. O
  painel depende da chave anon legada embutida no HTML.
- **Não** regenerar nem apagar chave de API; **não** trocar senha.
- **Nunca** colar chave de serviço em chat. Ela dá acesso total ao banco.
- O `anon` está **embutido no HTML público** do painel. Por isso escrita em `fila_envio` passa por
  Edge Function (`fila-acao`), e não por PostgREST direto.
- **P0 aberto:** o `anon` ainda tem INSERT/UPDATE/DELETE em tabelas e não há login na frente do
  painel. Quem for mexer em permissão, comece por aqui. **Novo nesta lista:** o `anon` também lê a
  tabela `empresa`, o que expõe `ghl_location` e os ids de campo (não expõe token — `ghl_token_env`
  guarda só o *nome* do secret). Entre no mesmo pacote de RLS.

---

## 7. Pendências conhecidas

| # | pendência |
|---|---|
| 1 | Pós-checagem de entrega: ler a resposta do ZaptosWPP na conversa e marcar erro em vez de `enviado` |
| 2 | Pré-checagem: não gastar linha se a instância estiver desconectada |
| 3 | `ghl-contatos-sync` ainda tem chave de serviço **chumbada no fonte** — tirar |
| 4 | `BIND_MARGEM_MS` em 20s por mensagem (sobra de diagnóstico descartado) |
| ~~5~~ | ~~`LOC` chumbado em 5 funções~~ — **fechada em 26/08**: sai do cadastro `empresa` |
| 6 | P0: revogar escrita do `anon` + RLS + login no painel (ver 6) |
| 7 | Cron `ml-calc-batch` devolvendo 401 |
| 8 | Worker do Cloudflare **atrás do repo**: `/logistica`, `/cobranca` e `/teak` dão 404 embora estejam no mapa de `deploy/worker/gestor-worker.js`. Falta `wrangler deploy` |
| 9 | Workflow de resposta no GHL (o GHL **não tem** endpoint de criação de workflow); paliativo é o cron `campanha-dono-varrer-5min` |
| 10 | 8 representantes com problema de dado (telefone compartilhado, duplicados, sem contato no CRM) |
| 11 | 3 clientes com **dois e-mails colados** num campo do Sankhya |
| 12 | Ticket no Supabase sobre `SUPABASE_SERVICE_ROLE_KEY` vir como `sb_secret_` |
| 13 | `gestor.html` publicado **diverge** do repo. Resolver antes de publicar o painel da Nitron |
| ~~14~~ | ~~Sem cron de refresh para a Teak~~ — **fechada em 26/08**: `cache-refresh-teak-3h` (5 */3) e `ghl-leads-refresh-teak-2h` (38 */2), em `supabase/cron/teak.sql` |
| 15 | `crm-resposta-roteia` ainda usa `GHL_TOKEN` direto (é da Nitron; parametrizar quando outra empresa precisar) |
| 16 | Teak: 8 contatos **sem dono** no CRM e 498 com problema de telefone — lista em `teak_lead_dado` |

---

## 8. Como trabalhar (o que funcionou aqui)

- **Meça antes de escrever código.** Todo achado que mudou o plano — o snapshot que seria apagado, o
  token que dá 403, o canal de WhatsApp diferente — veio de uma consulta ou de uma chamada de API
  feita **antes**, não de ler o código e supor.
- **Leia o arquivo inteiro antes de fazer deploy.** Três defeitos que passariam no `deno check`
  foram achados assim (seção 5.9).
- **Conserte o dado, não oito funções.** Quando as campanhas antigas estavam com instância errada, a
  correção foi um *trigger* na origem, não editar cada função.
- **Uma fonte de verdade por assunto.** `empresa` para location/CODEMP/campos; `rep_instancia` para
  instância; `TAG` para merge tag; `fila_trava_catalogo` para motivo de falha. Duas listas do mesmo
  assunto divergem — sempre. Foi por isso que a tabela `empresa` que já existia foi **estendida** em
  vez de duplicada.
- **Prévia tem de usar o caminho do envio.** Prévia com regra própria mente, e mentiu.
- **Toda trava recusa alto.** Sem instância, dono divergente, troca não confirmada, sem location, sem
  token: **não manda**. Mensagem pelo número errado é pior do que mensagem não enviada.
- **Mas trava tem de recusar pelo motivo certo.** A trava de instância aplicada à Teak recusaria
  100% dos envios por falta de algo que naquele canal não existe. Trava correta pelo motivo errado
  ainda é um defeito.
- **Antes de mexer no painel publicado, confira o md5.**
- Comentário no código explica **por que**, com o caso real que motivou. É o que evitou refazer erro.
