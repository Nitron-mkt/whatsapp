-- O registro do dono anterior existe para uma coisa so: poder desfazer o emprestimo.
-- Ele quase nao serviu para isso. A tabela nasceu com um indice unico PARCIAL
-- (unique (contact_id, campanha) where devolvido_em is null), e ON CONFLICT nao
-- consegue apontar para um indice parcial sem repetir o predicado — que o PostgREST
-- nao emite. Resultado: todo upsert do "assumir" voltava erro, o codigo nao olhava
-- esse erro, e a troca de dono acontecia sem nenhuma linha guardada. Foi o que
-- aconteceu em 26/08: 9 contatos trocaram de proprietario e a tabela ficou vazia.
-- Os 9 donos anteriores foram recuperados das respostas salvas do proprio "assumir".
--
-- Aqui o indice parcial sai e entra uma constraint unica de verdade em
-- (contact_id, campanha). Perde-se a possibilidade de guardar varios emprestimos
-- historicos do mesmo contato na mesma campanha — o que interessa e o dono de
-- origem, e esse e o da primeira vez. Em troca o upsert do PostgREST passa a
-- funcionar, e a v3 da funcao registra ANTES de trocar e desfaz o registro se o
-- PUT no GHL falhar.
alter table campanha_dono_emprestado
  drop constraint if exists campanha_dono_emprestado_contato_campanha;

drop index if exists campanha_dono_emprestado_aberto_idx;

alter table campanha_dono_emprestado
  add constraint campanha_dono_emprestado_contato_campanha
  unique (contact_id, campanha);
