# Campanha Gestor de Carteira — arquivo e validação

Documentos entregues pelo gestor em 03/09/2026, arquivados aqui como recebidos.

| arquivo | o que é | md5 |
|---|---|---|
| `apresentacao-online-2.pptx` | apresentação final aos representantes (11 slides + notas do apresentador) | `53cf2e8e5b767f7e043750924f3126cb` |
| `regulamento-final-rev5.docx` | regulamento + Termo de Adesão + Anexo I (plano de reativação) | `bad0eb2f159f2658b2aca132d421bed2` |
| `apresentacao.txt` / `regulamento.txt` | texto extraído dos dois, para busca e diff em git | — |

**A mecânica, em uma linha:** o representante recebe a Tabela Gestor (prazo médio 45 dias, 60 no
N/NE, pedido mínimo R$ 3.500) e, para mantê-la, precisa positivar **50% da carteira congelada** e
atingir **90% da meta**, as duas juntas, em cada ciclo de 4 meses. Ciclo 1 = 01/09 a 31/12/2026 e é
o único confirmado.

---

## 1. Backtest da régua — o achado que decide a campanha

Apliquei a definição do próprio regulamento ao ciclo imediatamente anterior (01/05 a 31/08/2026),
com a carteira congelada em 01/05/2026 (clientes PJ faturados nos 12 meses anteriores, consolidados
por CNPJ raiz, rep = titular do cadastro), positivação = ao menos um pedido faturado ≥ R$ 3.500 no
ciclo, e **Key Account excluído do numerador e do denominador** como manda o item 6.

| | com Key Account | **sem Key Account (regra do regulamento)** |
|---|---|---|
| representantes | 92 | 90 |
| clientes nas carteiras | 3.169 | 2.777 |
| positivados | 661 (20,9%) | **437 (15,7%)** |
| reps com carteira ≥ 15 clientes | 46 | 45 |
| **bateriam os 50%** | 1 | **0** |
| bateriam 40% | 3 | 2 |
| bateriam 30% | 11 | 5 |
| positivação mediana | 19,2% | **16,1%** |
| melhor representante | 58,8% | 40,4% |

**Nenhum dos 45 representantes com carteira medível teria mantido a Tabela Gestor.** 34 dos 45
precisam **dobrar ou mais** a positivação; a mediana precisa somar 10 clientes e o conjunto precisa
somar 876. Isso contradiz a premissa do próprio regulamento — "ela permanece enquanto o resultado
permanecer" — porque, na régua atual, ela não permanece para ninguém.

Ressalvas honestas: é um retrato *sem* a campanha existir, e a Tabela Gestor existe justamente para
mudar comportamento; a meta (a segunda condição) não é reproduzível para trás porque não há
histórico de meta por ciclo. Ainda assim, 16% → 50% em um ciclo é um salto de 3x.

Se o objetivo é uma régua exigente mas alcançável, a leitura do dado sugere **30% no Ciclo 1**
(5 reps entram, 11 com KA) com degrau para 40–50% nos ciclos de 2027 — que é exatamente o que o
item 4 já prevê fazer com o dado do Ciclo 1.

## 2. Contradições entre os dois documentos

| # | onde | o que está escrito | o que o regulamento diz | gravidade |
|---|---|---|---|---|
| 1 | notas dos slides 5 e 6 | "o caminho mais rápido para os **45%**" / "não é **45%** no abstrato" | 50% (itens 3 e Termo de Adesão) | **alta** — é o texto que o apresentador lê em voz alta |
| 2 | slide 3 | "Vale para **qualquer cliente seu** — ativo, inativo ou novo" | item 2: "Clientes Key Account **não podem receber** a Tabela Gestor"; item 6: não integram a carteira | **alta** — a apresentação promete o que o regulamento proíbe, e a nota do slide 11 já prevê a pergunta |
| 3 | slide 9 | Permanência: "**4 ciclos**" | item 8: "até 4 ciclos, **condicionada**" — do 5º em diante exige Clube ou compra nos 3 ciclos | média |
| 4 | slide 5 | "NÃO CONTA: pedido abaixo de R$ 3.500" | item 7: pedidos do mesmo cliente **em 7 dias são consolidados** antes do mínimo | média — é a pergunta nº 1 prevista na nota do slide 11 e não está em nenhum slide |
| 5 | slide 6 | "tem 53 inativos **na carteira** para buscar" | item 6: inativo **não** integra a carteira congelada (entra no numerador, não no denominador) | média — a confusão é exatamente o ponto que a campanha precisa deixar claro |
| 6 | slide 3 | "Prazo médio 45 dias / 60 no N/NE" | item 2: **somente** as 13 condições pré-aprovadas são admitidas, "ainda que o prazo médio coincida" | média — o rep sai achando que qualquer condição que dê média 45 vale |
| 7 | — | não aparece em slide nenhum | item 1: rep com **menos de 15 clientes** é avaliado por acordo individual — são **45 dos 90 reps**, metade da força | média |
| 8 | — | não aparece em slide nenhum | item 11: a **campanha Nitron UP encerra em 01/09/2026** | baixa, mas será perguntado |
| 9 | slide 6 | exemplo: 45 clientes, 17 positivados (38%) | é o **2º melhor** dos 45 reps; a mediana real é 16% | baixa — mas apresenta o melhor caso como típico |

O que **confere**: as datas (15/01 apuração, 31/01 decisão), os três números do slide 11, a tabela
comparativa das três tabelas, a aritmética das 13 condições de pagamento (as 6 de 45 dias e as 7 de
60 dias fecham todas na média certa), a conta do slide 6 (23 − 17 = 6) e a afirmação do slide 2 —
**48,4%** dos 2.903 clientes PJ faturados nos últimos 12 meses compraram em uma **única** ocasião.

## 3. O que a Nitron prometeu e ainda não existe

O item 10 promete apuração **automática, extraída do Sankhya, sem cálculo manual**, com painel
mensal por representante. Hoje:

- **Não há foto da carteira de 01/09/2026.** O item 6 congela a carteira nessa data e dá 30 dias ao
  rep para contestar — o prazo já está correndo desde anteontem. Ainda é reconstituível a partir do
  Sankhya (foi o que fiz no backtest), mas quanto mais tarde, mais o cadastro se move debaixo da foto.
- **`rep_carteira` já usa as palavras da campanha com outra conta.** A tabela tem `clientes`,
  `positivaram`, `sem_positivar`, `reativar`, `meta`, `perc` — mas `clientes` é a base inteira do rep
  (869 para DENIZE), não a carteira de 12 meses do regulamento (263). Publicar o painel da campanha
  sobre essa tabela mostraria número diferente do apurado.
- **Consolidação por CNPJ raiz não é o que o pipeline faz.** O regulamento consolida matriz e filiais
  por raiz de CNPJ; nossas funções agrupam por `parc_matriz`, que é o vínculo cadastral do Sankhya.
  Os dois discordam sempre que o cadastro não amarrou a filial.
- **Key Account não tem marca na apuração.** A lista existe (`ka_grupo`, 128 grupos / 1.221 CNPJs),
  mas nenhuma função de campanha a usa como exclusão — e ela muda os 20,9% para 15,7%.
- **Dois códigos de vendedor não são representantes de rua** e entram na conta se ninguém os tirar:
  `67` AUTO ATEND. (363 clientes, 1,1% de positivação) e `116` DENIZE, que é agência de
  representantes.
