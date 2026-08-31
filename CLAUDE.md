# Máquina de Vendas Nitron — o que qualquer sessão precisa saber antes de mexer

Projeto Supabase `integracao-crm-sankhya` (`bwbeieumxcuomtrvlqxs`).
Painel do gestor: https://gestordecampanhas.marketing-da5.workers.dev/ (arquivo `app/gestor.html`).

## Vocabulário — não é preferência, é precisão

**O canal de saída chama-se ZAPTOS, não WhatsApp.** A Nitron não usa o WhatsApp Business
diretamente: manda pelo ZaptosWPP, acoplado ao GHL. Ao falar de mandar comunicação — no chat, nos
rótulos da tela, nos textos que a operação lê — o canal é **Zaptos**.

Continua sendo "WhatsApp" só onde é verdade que se fala da plataforma ou do aparelho de quem
recebe, e trocar seria mentira:

| diz WhatsApp | por que |
|---|---|
| "número fixo — sem WhatsApp" | é o app do destinatário que não existe num fixo |
| "template aprovado pela Meta para WhatsApp frio" | quem aprova template é a Meta |
| "a Teak usa o WhatsApp nativo do GHL" | outro canal, não o Zaptos |
| "revalidar WhatsApp/e-mail/Instagram do contato" | são os canais do contato |

Os valores internos seguem `whatsapp` (coluna `fila_envio.canal`, `fila_config.wpp_ativo`,
`wpp_max_min`). **Não renomeie isso**: são dados e chaves de configuração, com histórico gravado —
renomear exigiria migrar linhas e funções sem ganho para quem lê a tela.

## Regras permanentes da operação (o gestor pediu, valem até ele desdizer)

1. **A chave de e-mail (`fila_config.email_ativo`) NUNCA é desligada.** Nem "por segurança", nem
   durante investigação, nem ao parar uma campanha de Zaptos.
2. **Não desligar a chave de Zaptos (`wpp_ativo`) por hábito.** Ela não é ferramenta de
   diagnóstico. Quando algo precisa parar, pare *o que está errado* — a campanha, a instância —
   não a fila inteira.
3. **NÃO travar campanha no painel.** Dito em 28/08: não cancelar linha, não desligar chave, não
   marcar campanha como inativa por conta própria. Achou problema? **Reporta e deixa correndo** —
   quem decide parar é o gestor. Continuam automáticos e permitidos apenas: a trava de duplicidade
   no enfileirar e a pausa da instância que cai (o GHL aceita e o Zaptos não entrega — sem isso a
   linha viraria "enviado" mentindo).
4. **Campanha de cliente não vai para representante.** A aba aberta manda no público
   (`publicoAtivo()`); nenhum representante nasce marcado.
5. **Teto de 2 mensagens por minuto por instância** (`fila_config.wpp_max_min`).
6. **Horários da tela são de São Paulo**, fixo, não do navegador (`hl()`).

## Coisas que já custaram caro — não redescubra

- **"Aceito pelo GHL" ≠ "entregue".** O GHL responde `status: sent` e o ZaptosWPP escreve
  `[System]: <instância> - The instance is disconnected.` na conversa 2–8s depois. Esse é o
  **único** sinal observável: não há campo no CRM nem status de contato. `campanhas-enviar` espera
  ~12s e checa (`ENTREGA_CHECK_MS`); em 26/08, sem isso, 8 mensagens viraram "enviado" sem chegar.
- **O número de saída é o `assignedTo` do contato.** `fromNumber` **não funciona** (testado 26/08).
  `#contact_instance:<token>` governa só a entrada. Sem dono, a mensagem não sai.
- **`SUPABASE_SERVICE_ROLE_KEY` vem com valor `sb_secret_`** que o PostgREST recusa (PGRST303).
  Toda função usa `const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";`
- **Publicar o painel:** `POST host-upload?path=gestor.html` com o **HTML cru no corpo** e o caminho
  na query — não JSON. **Confira o md5 publicado antes de subir:** há outro chat editando o mesmo
  arquivo, e sobrescrever o trabalho dele já aconteceu.
- **Contato de teste em `rep_contato_extra` sai caro.** Números e e-mails internos foram cadastrados
  a mão (`rotulo='manual'`) em 11–24/08 e ficaram ativos: toda campanha ao rep mandava também para
  eles. Em 27/08, 6 dos 10 Zaptos e 4 dos 11 e-mails do Clube a vencer foram para contato interno.
  Regra que os identifica: **o mesmo valor em mais de um rep não é contato daquele rep.** Todos os
  manuais estão desligados desde 28/08.
- **Todo cliente citado ao representante leva o CNPJ, em linha própria.** Pedido do gestor em
  28/08: por nome fantasia ou razão social o rep não acha o cliente no sistema dele; pelo CNPJ acha.
  Vale nas cinco listas (Clube, voucher, giro, motor e roteiro de visitas). O documento vem de
  `contato_enriquecido.cnpj` / `roteiro_cliente_apto.cnpj` — 14 dígitos crus, alguns cadastros são
  CPF e um cliente do Uruguai tem RUT de 12; `fmtDoc()` rotula cada caso e omite a linha quando não
  há documento. Duas regras que a consolidação por rede impôs: **nome e CNPJ são sempre da mesma
  loja** (a lista agrupa por matriz, mas em 5 dos 13 grupos do giro vencido a matriz não está na
  lista — usar o codparc da matriz dava nome de uma loja com o documento de outra), e quando a linha
  resume mais de uma loja o texto marca `(desta loja)`. No Clube o CNPJ é o da **matriz do
  contrato**, e esse sufixo só aparece nos 18 dos 68 grupos que de fato têm mais de uma loja —
  dizê-lo nos outros 50 mandaria o rep procurar uma rede que não existe.
- **A fila barra duplicidade** (`fila-enfileirar` v18): mesmo `(campanha, canal, destino)` no mesmo
  pedido, ou já pendente/entregue nas últimas `ANTI_DUP_HORAS` (12). O destino é normalizado —
  `11970399053` e `+5511970399053` são o mesmo WhatsApp. Antes, três cliques mandavam três vezes.
- **Parâmetro de negócio mora no banco, não em constante.** Janela do Clube a vencer:
  `campanhas.filtros_padrao->>'clube_venc_dias'`. Textos de trava: tabela `fila_trava_motivo`.
  Motivo: mudaram duas vezes num dia, e duplicar em duas funções deixa tela e disparo discordando.

## Roteiro de visitas — regras que vieram da operação

- **Uma semana, no máximo** (`DIAS_SEMANA = 5`). **4 a 6 visitas/dia** — `MIN_VIS_DIA = 4` é piso:
  dia com menos de 4 não vira dia. Rota de 20 dias ninguém executa; viagem por 2 clientes também não.
- **O dia se enche pelos MAIS PRÓXIMOS, não pelos mais valiosos.** A prioridade decide *para onde ir*
  (a semente/região); chegando lá, visita-se quem está ao lado. Preencher por prioridade dava dias
  cheios e horríveis: 6 visitas espalhadas em 150km. Depois da mudança, raio médio em SP caiu de
  ~135km para 4–6km.
- **Rep sem cluster de 4 não recebe rota** (`rota_possivel:false` + `aviso`, mensagem vazia). São 32
  dos 84 reps — a carteira apta existe mas está espalhada. Para eles visita não é o instrumento.
  O painel mostra o motivo e **não** oferece caixa de texto nem botão de envio.
- **Os números da rota moram no banco**, não em constante: `campanhas.filtros_padrao` de
  `rep_roteiro_visitas` → `roteiro_max_km` (raio do dia, **100**), `roteiro_min_dia` (4),
  `roteiro_vis_dia` (6), `roteiro_dias_semana` (5), `roteiro_raio_semana_km` (300). Ajustar por
  UPDATE, sem deploy. O raio já mudou de 150 → 100 e o piso nasceu inexistente: é parâmetro de
  operação. Corte 150→100km custou 1.236→1.127 pontos com dia viável e 52→50 reps.
- **DENIZE (codvend 116) é agência de representantes, não rep de rua.** O objetivo com ela é
  levantar informação de cliente sem compra e repassar — não montar rota. Deixar como está; não
  "consertar" as contas dela que ficam fora da região.
- **A semana mora numa região só**: mesma UF e dentro de `RAIO_SEMANA_KM` da âncora, e cada dia
  começa onde o anterior terminou. Segunda em SP, terça no RJ e quarta em SP de novo não é rota.
- **A âncora é o centro da melhor semana, não o maior cliente.** Escolher pelo faturamento dava
  semana de 9 visitas para quem tem carteira espalhada (DENIZE: 181 contas em 19 UFs).
- **Quem entra é quem fechou o PRÓPRIO ciclo** (`dias >= contato_enriquecido.giro`, 30 a 90 dias
  conforme o cliente) — não um limite fixo. Fora: pedido em aberto (`saldo_entregar > 0`),
  inadimplente, título vencido e **bloqueado no Sankhya** (`parc_bloqueado`, de `TGFPAR.BLOQUEAR`).
- **`roteiro_cliente.uf` é o CODUF numérico do Sankhya** (1=SP, 2=MG, 7=RJ, 9=PA…), não a sigla.
- O filtro mora na **view** `roteiro_cliente_apto`, não na função, para tela e disparo contarem a
  mesma audiência.
- **Tom ao representante:** ele já atende esses clientes e conhece a praça melhor que nós. A
  mensagem se apresenta como sugestão montada de fora, diz que ele pode ignorar, e oferece apoio.
  Nunca cobra visita, prazo ou resultado.

## Segurança — restrições dadas pelo gestor

- **Nunca colar chave de API no chat.**
- **Nunca clicar "Disable JWT-based API keys"** em Settings → API Keys → Legacy: o painel depende
  da anon key legada embutida no HTML.
- Não regenerar nem apagar chaves; não trocar senhas.

## Estado conhecido (28/08/2026)

- **Zaptos da instância "Campanhas Nitron" está RESTRINGIDO pelo WhatsApp.** Sem previsão. A fila
  segue LIGADA; a restrição está registrada como pausa dessa instância (`instancia_ghl.pausada_em`).
  As outras seis instâncias trabalham normalmente.
- **Clube a vencer / distrato está em STAND BY** (`ativa=false`) desde 28/08, por decisão do gestor.
- **Reativação 180 dias** só volta quando o gestor mandar; as 43 linhas restantes estão canceladas.
- 9 das 13 campanhas ativas são só Zaptos; 4 aceitam e-mail. 77 de 79 representantes têm e-mail,
  e 5.969 clientes também.
