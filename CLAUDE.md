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
3. **Campanha de cliente não vai para representante.** A aba aberta manda no público
   (`publicoAtivo()`); nenhum representante nasce marcado.
4. **Teto de 2 mensagens por minuto por instância** (`fila_config.wpp_max_min`).
5. **Horários da tela são de São Paulo**, fixo, não do navegador (`hl()`).

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
- **Parâmetro de negócio mora no banco, não em constante.** Janela do Clube a vencer:
  `campanhas.filtros_padrao->>'clube_venc_dias'`. Textos de trava: tabela `fila_trava_motivo`.
  Motivo: mudaram duas vezes num dia, e duplicar em duas funções deixa tela e disparo discordando.

## Segurança — restrições dadas pelo gestor

- **Nunca colar chave de API no chat.**
- **Nunca clicar "Disable JWT-based API keys"** em Settings → API Keys → Legacy: o painel depende
  da anon key legada embutida no HTML.
- Não regenerar nem apagar chaves; não trocar senhas.

## Estado conhecido (28/08/2026)

- **Zaptos da instância "Campanhas Nitron" está RESTRINGIDO pelo WhatsApp.** Sem previsão. A fila de
  Zaptos está desligada por causa disso — é exceção, não hábito.
- 9 das 13 campanhas ativas são só Zaptos; 4 aceitam e-mail. 77 de 79 representantes têm e-mail,
  e 5.969 clientes também.
