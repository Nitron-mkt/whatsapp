# Máquina de Vendas — como começar numa conta nova

> **Para que serve este arquivo:** abrir um chat novo do Claude Code para **outra empresa do grupo**
> (Mundo UD, Mood Fruits, Hyak, Roga Village) sem ter de recontar tudo. Abra o chat no mesmo
> repositório e mande:
>
> ```
> Leia docs/nova-conta-como-comecar.md e vamos configurar a empresa <NOME>.
> ```
>
> Este documento é o **estado real em 26/08/2026**, conferido no código, no banco e nas APIs — não é
> plano. Onde algo está pendente ou quebrado, está escrito que está.

---

## 0. A regra da casa: um cérebro, dados isolados

A **inteligência é uma só** e vale para todas as contas do grupo: as mesmas Edge Functions, as
mesmas travas, o mesmo aprendizado. O que é isolado é o **dado**.

Em termos práticos:

- **Quando o assunto é uma empresa, só aparece dado dela.** O painel da Teak mostra Teak; o da
  Nitron mostra Nitron. Nunca "substituir" o dado de uma empresa pelo de outra, nunca somar as duas
  numa mesma tela.
- **Um chat por conta.** Cada conversa de configuração trata de uma empresa. Não misture.
- **Melhoria de mecanismo é para todos; dado nunca.** Se você conserta uma trava, ela passa a valer
  para as cinco. Se você mexe em dado, mexe no de uma.

Como as tabelas são compartilhadas e discriminadas pela coluna `empresa`, esse isolamento depende
de **toda leitura ter o filtro**. Isso não é confiável na base da memória — em 26/08 quatro funções
da Nitron estavam lendo linha da Teak, e uma ia sair num rascunho no dia seguinte. Por isso existe:

```bash
python3 scripts/conferir_isolamento.py     # sai com erro se achar leitura sem filtro
```

**Rode antes de qualquer deploy.** Ele percorre todas as Edge Functions, acha leitura das tabelas
multi-empresa e cobra o `.eq("empresa", ...)`. Sabe ignorar `insert`/`upsert` (ali a empresa vai
dentro da linha) e alteração de uma linha já identificada por `id`. O `deno check` não acha nada
disso, e nenhum teste de unidade acha.

---

## 1. O que existe hoje

Uma máquina de campanhas que roda **duas empresas** pelo ERP: o Grupo Nitron (Plásticos) e a Teak
Brazil. A **Roga Village** é o terceiro caso e não segue esse molde — o ERP dela só tem compra, e o
painel dela lê o CRM (§9). As outras três estão no cadastro sem `ghl_location` e sem CODEMP, e não
têm dado.

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
| `roga` | Roga Village | 12 | **CRM, não ERP** (§9) | a definir | ❌ |
| `mundo_ud` | Mundo UD | — | — | — | ❌ |
| `mood` | Mood Fruits | — | — | — | ❌ |
| `hyak` | Hyak Internacional | — | — | — | ❌ |

> A tabela `empresa` **já existia** antes desta sessão: é o cadastro do Motor de prospecção, com
> chave `codigo` (maiúscula) e colunas `ghl_location`, `linha_negocio`, `descricao_ia`. Não está nas
> migrações antigas e nenhuma view a lia. Ela foi **estendida**, não duplicada — havia também
> `CONSTELACAO` e `ROGA` cadastradas, que o painel nunca listou.

As locations do GHL foram conferidas uma a uma na API em 26/08/2026: `nitron` =
`rZ8y7lzqV7fzxsartaX2`, `teak` = `DRhJc78pTfF9dlaH5NK9`, `roga` = `uqZMP3rxrdHqMHPQYRAp`,
`mundo_ud` = `b461C1a4cou5XvykmQ1l`, `mood` = `uhiDA222WYxSm5q0eUuj`, `hyak` =
`NBJY3ZnA7qSrYyEi0wl7`. **Uma versão anterior deste documento trocava duas:** dizia que `Mundo UD`
era `uhiDA222WYxSm5q0eUuj`, que é a `MOOD FRUITS`. Mandar por esse id criaria contato na subconta
errada.

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

> **Quem dispara sozinho:** só o `campanhas-cron` (todo dia útil às 08:00 BRT), e ele varre
> **apenas a Nitron** — filtro explícito desde 26/08. Antes ele lia `campanhas` só por
> `ativa = true`: as campanhas da Teak entraram nessa varredura no minuto em que existiram, e não
> dispararam apenas porque nasceram sem `cadencia`. Bastava alguém preencher esse campo para uma
> campanha da Teak sair sozinha no dia seguinte. **Empresa nova não ganha agendador de graça** — é
> uma decisão, não um efeito colateral.

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
- `app/teak.html` — Teak, versão de página inteira. **Não é o gestor com outra cor**: é um funil +
  caixa de entrada, organizado nos 4 pipelines que a própria Teak desenhou no CRM.
- O **mesmo conteúdo da Teak também vive dentro do `gestor.html`**, no filtro de empresa: escolher
  "Teak Brazil" abre o painel dela (`renderTeak`), ao lado do da Roga Village (`renderCRM`). É o
  caminho normal de uso — o gestor é a porta de entrada e o filtro é onde se troca de conta.

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

### 5.9 Filtrar as views não basta

Quando uma tabela vira multi-empresa, o instinto é ajustar as views — e é o que eu fiz primeiro.
Mas **toda função que lê a tabela direto continua sendo um ponto de vazamento**, e são muitas: de
149 tabelas do banco, 13 têm coluna `empresa`; as outras 136 são da Nitron e não têm noção de
empresa nenhuma. Em 26/08 quatro funções da Nitron liam linha da Teak (`campanhas-disparar` em três
pontos, `campanhas-retorno` em dois, `campanhas-roteiro` em dois), e `rep_sem_comprar` — que roda
sexta — ia gerar rascunho com cliente da Teak na lista de um rep da Nitron. É por isso que existe
o `scripts/conferir_isolamento.py` da seção 0: essa classe de defeito não aparece em teste.

### 5.10 Parâmetro que a assinatura recebe e o corpo ignora

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
| 3 | `ghl-contatos-sync` ainda tem chave de serviço **chumbada no fonte** — tirar. Em 26/08 o `campanhas-cron` tinha o mesmo problema e foi corrigido; vale varrer as outras |
| 17 | **O repo não tem todas as funções que estão no ar.** `campanhas-cron` estava deployado e ausente do repositório — foi trazido em 26/08. Fazer o inventário completo de deployado × repo |
| 4 | `BIND_MARGEM_MS` em 20s por mensagem (sobra de diagnóstico descartado) |
| ~~5~~ | ~~`LOC` chumbado em 5 funções~~ — **fechada em 26/08**: sai do cadastro `empresa` |
| 6 | P0: revogar escrita do `anon` + RLS + login no painel (ver 6) |
| 7 | Cron `ml-calc-batch` devolvendo 401 |
| 8 | Worker do Cloudflare **atrás do repo**: `/logistica`, `/cobranca` e `/teak` dão 404 embora estejam no mapa de `deploy/worker/gestor-worker.js`. Falta `wrangler deploy` |
| 9 | Workflow de resposta no GHL (o GHL **não tem** endpoint de criação de workflow); paliativo é o cron `campanha-dono-varrer-5min` |
| 10 | 8 representantes com problema de dado (telefone compartilhado, duplicados, sem contato no CRM) |
| 11 | 3 clientes com **dois e-mails colados** num campo do Sankhya |
| 12 | Ticket no Supabase sobre `SUPABASE_SERVICE_ROLE_KEY` vir como `sb_secret_` |
| ~~13~~ | ~~`gestor.html` publicado diverge do repo~~ — **fechada em 26/08**: o publicado era o mais NOVO (tinha o painel da Roga Village, que le o funil do CRM ao vivo, e nao estava no repo). O repo adotou o publicado como base e o painel da Teak foi enxertado nele |
| ~~14~~ | ~~Sem cron de refresh para a Teak~~ — **fechada em 26/08**: `cache-refresh-teak-3h` (5 */3) e `ghl-leads-refresh-teak-2h` (38 */2), em `supabase/cron/teak.sql` |
| 15 | `crm-resposta-roteia` ainda usa `GHL_TOKEN` direto (é da Nitron; parametrizar quando outra empresa precisar) |
| 16 | Teak: 8 contatos **sem dono** no CRM e 498 com problema de telefone — lista em `teak_lead_dado` |
| 18 | **13 leituras sem filtro de empresa**, apontadas por `scripts/conferir_isolamento.py`. Nenhuma causa dano hoje (a Teak tem 0 linhas em `fila_envio`), mas é o que bloqueia a Teak de enviar: `fila-processar` (5), `fila-enfileirar` (2), `agenda-api` (4), `crm-resposta-roteia` (1), `instancia_ghl` em `fila-processar` (1) |
| 19 | `fila_config` tem **uma linha só** (`id=1`): uma cadência para todas as empresas. A Teak precisa da dela |
| 20 | `fila-processar` marca como **erro** toda linha de WhatsApp sem instância. A Teak não tem instância (canal nativo do GHL), então a fila **rejeitaria 100% dos envios dela**. Precisa entender `empresa.canal_wpp` |
| 21 | `campanhas-disparar` só sabe montar público de **carteira** (clube, voucher, giro, motor). Não sabe montar público de **lead** — a Teak precisa do equivalente |
| 22 | `instancia_alias` não tem coluna `empresa` |

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

### 9.11 Sankhya no CRM da Roga: conferido, não existe

Pergunta do gestor em 27/08: *"acho que os dados do Sankhya nem estão no CRM"*. Estava certo.
Conferido campo a campo na API — os sete campos criados em 19/08 para receber o ERP:

| campo | contatos |
|---|---|
| CODPARC (Sankhya) | 0 |
| Ultima Estadia | 0 |
| Estadias (total) | 0 |
| Estado do Ciclo | 0 |
| Canal Preferido | 0 |
| Valor Vencido | 0 |
| Ficha Roga (IA) | 0 |

**Zero em todos.** Nunca houve importação, e não havia o que importar. O assunto ERP está encerrado
para a Roga: `empresa.universo` dela agora é **`crm`** (migração `20260827_roga_universo_crm.sql`),
um terceiro valor ao lado de `clube` e `faturamento` — os dois anteriores pressupõem CODEMP e nota
de venda, que a Roga não tem. Deixá-la como `clube` fazia o cadastro afirmar algo falso, e cadastro
que mente é pior que cadastro vazio, porque alguém confia nele.

A tela mostra isso com número, não com promessa — e só **afirma** que está vazio quando as sete
consultas responderam. `erp_medidos` existe para separar "medido e vazio" de "não medido": somar
`(n||0)` daria zero nos dois casos, e a tela usaria esse zero para afirmar algo que poderia ser
falso. Confirmado na prática ao rodar contra a Teak, onde esses campos não existem: veio
`erp_medidos: 0/7` e a tela corretamente **não** afirmou nada.

### 9.12 Os sinais que o CRM realmente alimenta

Medido em 27/08. Só vale puxar o que tem conteúdo:

| campo | contatos | serve para |
|---|---|---|
| `Segmento` | 750 | qualificar o B2B importado |
| `Objetivo do Lead` | **255** (210 com telefone) | **definir público por intenção** |
| `Observacao do Lead` | 56 | contexto — **sai em inglês**, ver ressalva |
| `O que precisa?` | 45 | Evento Social / Vivencial / Business Club / Lazer |
| `Resumo do Lead` | 24 | personalizar mensagem (estruturado, em português) |
| `Informacoes Gerais` | 8 | proposta de jornada corporativa |
| `Interesse`, `Origem Inteligente` | **0** | criados e nunca alimentados — não puxar |

`Objetivo do Lead` é o campo mais valioso da conta: o agente de IA já classificou a intenção
("Eventos Corporativos: empresa/equipe/reunião", "Restaurante: almoço/day use"). É o que transforma
10 mil contatos numa lista de 210 com quem dá para falar.

Três armadilhas achadas no caminho:

1. **O resumo da IA sai em inglês** ("*Karina Mota sought information on how to participate...*").
   Usado como merge tag numa mensagem em português, sai torto. O `Resumo do Lead` — estruturado e em
   português ("Período: 1 de julho | Pessoas: 2 | Interesse: Restaurante") — é a alternativa segura.
2. **Há ruído entrando como lead.** Um contato com `Observacao` preenchida é uma conversa sobre
   impressora 3D, sem relação com a Roga: o bot capturou uma thread aleatória do Instagram. Filtrar
   por `Objetivo do Lead` preenchido elimina boa parte.
3. **O celular pode não estar no campo `phone`.** Um contato tem `phone: +558896481767` (fixo) e o
   celular certo em `additionalPhones: +5588996481767`. Quem montar a fila tem de olhar os dois,
   senão manda WhatsApp para telefone fixo.

### 9.13 As campanhas que a tela propõe — derivadas, não escritas

A seção "Campanhas que dá para montar com este dado" **não é uma lista fixa**: sai de
`campanhasRoga()`, que lê o funil e os sinais da resposta ao vivo. Se o funil mudar, a lista muda
junto — uma lista escrita à mão envelheceria em uma semana e viraria mentira na tela. Cada cartão
carrega o que **impede** disparar, porque público sem canal não é campanha, é intenção.

Com o retrato de 27/08 a tela propõe seis, em ordem de temperatura:

| campanha | alvo | canal | por que |
|---|---|---|---|
| Retomar reserva parada | 36 | WhatsApp | pediu reserva e ninguém respondeu; os estágios seguintes estão zerados |
| Qualificar lead de evento corporativo | 33 | WhatsApp | pediu proposta pelo site; é o pipeline de ticket alto |
| Follow-up por objetivo declarado | 210 | WhatsApp | intenção já classificada pela IA — dá para segmentar a mensagem |
| Prospecção B2B para eventos | 750 | E-mail | base fria com Razão Social e Segmento; é a única grande com e-mail |
| Reativar oportunidade perdida | 22 | WhatsApp | mais perdidas que ganhas em Hospedagem, e sem motivo registrado |
| Captação para o Business Club | 45 | WhatsApp | pipeline zerado, mas 4 formulários no ar e a maior venda veio de um quiz |

As três primeiras aparecem marcadas como quentes. A trava de dono aparece em **todas** as de
WhatsApp, e de propósito: quem lê um cartão isolado precisa ver que sem `assignedTo` a mensagem não
sai. Dos 255 com objetivo, **195 estão sem dono**.

### 9.14 O merge com a Teak, e a regra do md5 provando seu valor

Ao publicar as campanhas, o md5 do painel no ar **não era mais o que eu havia subido**: outra sessão
publicou o painel da Teak Brazil em cima. A regra da §2.4 (conferir o md5 **antes** de subir) é o
que impediu a sobrescrita — sem ela, o painel da Teak teria sido apagado sem ninguém notar. Vale
notar que o histórico da branch da Teak tem um commit chamado *"recupera o painel Roga Village"*: a
colisão já havia acontecido na direção oposta.

O caminho foi merge, não sobrescrita: `origin/claude/teak-brazil-setup-qs6hf1` integrada, conflitos
resolvidos preservando os dois painéis, e as campanhas reaplicadas por cima. E a Teak trouxe a
**fundação multiempresa** que a §9.5 apontava como pré-requisito — coluna `empresa` em `snap_*`,
`instancia_ghl`, `fila_envio` e `campanhas`, e o fim do `const LOC` chumbado nas 5 funções.

Por isso a `roga-crm` foi realinhada (v3): resolve a empresa por **`painel_id`** e tira o nome do
secret de **`empresa.ghl_token_env`**, em vez da convenção `GHL_TOKEN_<EMPRESA>` que eu havia
inventado. Duas convenções para a mesma coisa divergem sempre — e a delas é melhor, porque o
cadastro manda, não o código. Provado ponta a ponta: `?empresa=teak` roda completo pelo cadastro.
