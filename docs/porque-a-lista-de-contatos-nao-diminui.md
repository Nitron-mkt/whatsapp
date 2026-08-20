# Por que limpar contatos no CRM não faz a lista diminuir

Apuração de 20/08/2026, projeto `integracao-crm-sankhya`.

## Sintoma

A equipe limpou vários contatos que tinham o e-mail do representante. No dia seguinte a
lista de apontamentos estava **maior**, não menor.

## Causa

A marcação "este contato é do representante" não vive no CRM (GoHighLevel). Ela vive na
tabela espelho `ghl_contato`, no Supabase, criada pela função `ghl-contatos-sync`. E nessa
tabela há dois problemas que se somam.

### 1. As linhas `#r` nunca são apagadas

`ghl-contatos-sync` grava as marcações como IDs sintéticos:

- `<contactId>#r<codparc>` — casou pelo e-mail/telefone do rep
- `<contactId>#biz<codparc>` — veio da mesma empresa do rep

A gravação é só `upsert`. O único `delete` da função é:

```ts
if (body.reset) {
  await sb.from("ghl_biz_contato").delete().neq("ghl_id", "__x__");
  await sb.from("ghl_contato").delete().like("ghl_id", "%#biz%");
}
```

Ou seja: apaga `#biz`, **nunca apaga `#r`**. Quando a equipe tira o e-mail do rep de um
contato no CRM, o sync simplesmente para de recriar aquela linha — mas a linha que já
existe continua lá, para sempre. Só sai com `DELETE` manual no banco.

Evidência: 5 linhas `#r` cujo contato-base no CRM já não carrega o e-mail/telefone do rep
continuam marcadas.

### 2. As linhas `#biz` são reconstruídas a partir das `#r` velhas

A função `materializa_rep_biz()` faz, em ordem:

```sql
delete from ghl_contato where ghl_id like '%#biz%';
insert into ghl_contato (...)
select b.ghl_id || '#biz' || r.codparc, ...
from (select distinct codparc, business_id from ghl_contato
      where ghl_id like '%#r%' and business_id is not null) r
join ghl_biz_contato b on b.business_id = r.business_id
```

O `from` são as linhas `#r` **que sobreviveram**. Cada linha `#r` velha que tenha
`business_id` puxa de novo todos os contatos daquela empresa. Média de 1,6 contatos por
rep, chegando a 7. Então a marca velha não só permanece: ela se reproduz.

### 3. O sync nunca termina uma passada

`ghl_sync_state` está com `done = false`, cursor preenchido, e `scanned = 481.679` contra
~6.800 contatos — já passou dezenas de vezes pela base. Cada passada parcial descobre e
adiciona novas linhas `#r`. Nada subtrai.

**Resultado: a contagem só pode subir.** Não é falha da equipe.

## Correção

O ajuste é no pipeline, não no CRM: tratar `#r` como `#biz` já é tratado — reconstruir em
vez de acumular. Opções:

1. Marcar o início da passada e, quando `done`, apagar as linhas `#r` com `atualizado`
   anterior ao início — depois rodar `materializa_rep_biz()`.
2. Ou apagar todas as `#r` e reinserir, como `#biz` faz hoje. Mais simples, e aceitável
   porque a reinserção é a própria passada.

Enquanto isso não entrar, a limpeza manual no CRM não converge.

## Efeito colateral no que a equipe recebia

Sem a separação por dono do contato, a lista misturava três coisas muito diferentes. Dos
129 contatos marcados hoje:

| | Quantidade | É erro? |
|---|---|---|
| O próprio representante | 41 | Não |
| Equipe do escritório do rep (assessores) | 34 | Não — o sync foi feito para isso |
| Contato de cliente na ficha do rep | 38 | **Sim** |
| Cadastro com o nome do rep (duplicado ou família) | 11 | **Verificar** |
| Contato de outro representante | 5 | **Sim, o mais grave** |

75 dos 129 não deviam ser tocados. Mandar os 359 registros brutos para a equipe gerava
retrabalho e desconfiança na lista.
