#!/usr/bin/env python3
"""
Confere que nenhuma Edge Function le uma tabela MULTI-EMPRESA sem filtrar a empresa.

POR QUE ISTO EXISTE
-------------------
A maquina e uma so (a inteligencia e compartilhada entre as contas do grupo), mas o DADO de
cada empresa e isolado. Como as tabelas sao compartilhadas e discriminadas por uma coluna
`empresa`, o isolamento depende de TODA leitura ter o filtro. Em 26/08 quatro funcoes da Nitron
estavam lendo linha da Teak por falta desse filtro, e uma delas ia sair num rascunho no dia
seguinte: CODVEND e CODPARC sao GLOBAIS no Sankhya, entao o CODVEND 214 da Teak e o mesmo 214 da
Nitron.

O `deno check` nao acha isso. Nenhum teste de unidade acha. Este script acha.

COMO USAR
---------
    python3 scripts/conferir_isolamento.py          # confere
    python3 scripts/conferir_isolamento.py --lista  # so lista as leituras encontradas

Sai com codigo 1 se achar leitura sem filtro. Rode ANTES de fazer deploy.
"""
import re
import sys
import pathlib

# As tabelas que tem coluna `empresa`. Toda leitura de uma destas precisa do filtro.
# Se voce adicionar a coluna `empresa` a uma tabela nova, ela entra AQUI tambem.
MULTI_EMPRESA = [
    "snap_parceiro", "snap_contato", "snap_rep", "snap_giro",
    "snap_lead", "snap_pipeline",
    "campanhas", "fila_envio", "instancia_ghl",
]

# Leituras que sao deliberadamente globais, com o motivo. Isenta so o que foi PENSADO para ser
# global — nao serve para calar um achado incomodo.
ISENTO = {
    # (arquivo, trecho identificador): motivo
    ("ghl-leads-refresh", 'from("snap_lead").delete()'):
        "delete da PROPRIA empresa, o .eq(empresa) vem no encadeamento seguinte",
    ("ghl-leads-refresh", 'from("snap_pipeline").delete()'):
        "idem",
}

RAIZ = pathlib.Path(__file__).resolve().parent.parent
FUNCS = RAIZ / "supabase" / "functions"

# `.eq("empresa", ...)` ou `empresa=eq.` (PostgREST via fetch) na MESMA sentenca
TEM_FILTRO = re.compile(r'\.eq\(\s*["\']empresa["\']|empresa=eq\.')
# INSERT/UPSERT nao filtram nada: a empresa vai DENTRO da linha inserida. Conferir isso e outra
# pergunta (o insert estampa a empresa?), e quem responde e o proprio codigo que monta a linha.
ESCRITA_CEGA = re.compile(r'\.(insert|upsert)\s*\(')
# Alteracao de UMA linha ja identificada (`.eq("id", ...)`) nao vaza: quem escolheu a linha foi o
# select que veio antes, e e ELE que precisa do filtro. Marcar isso aqui evita 9 falsos positivos
# e mantem o olho no que importa.
POR_ID = re.compile(r'\.eq\(\s*["\']id["\']\s*,')


def sem_comentario(txt: str) -> str:
    """Tira comentario de linha, para nao acusar exemplo escrito em comentario."""
    return "\n".join(l for l in txt.splitlines() if not l.lstrip().startswith("//"))


def sentencas(txt: str):
    """
    Quebra o arquivo em sentencas por `;`, guardando a linha onde cada uma comeca.

    Sentenca e nao linha de proposito: o encadeamento do PostgREST quebra em varias linhas
    (`from("campanhas")` numa, `.eq("empresa", x)` na seguinte), e olhar linha por linha acusava
    filtro que existe uma linha abaixo.
    """
    linha = 1
    buf, ini = [], 1
    for ch in txt:
        buf.append(ch)
        if ch == "\n":
            linha += 1
        if ch == ";":
            yield ini, "".join(buf)
            buf, ini = [], linha
    if buf:
        yield ini, "".join(buf)


def main() -> int:
    so_lista = "--lista" in sys.argv
    achados, total, escritas, por_id = [], 0, 0, 0

    for arq in sorted(FUNCS.glob("*/index.ts")):
        nome = arq.parent.name
        txt = sem_comentario(arq.read_text(encoding="utf-8"))
        for linha, st in sentencas(txt):
            for tab in MULTI_EMPRESA:
                if not re.search(r'from\(\s*["\']%s["\']\s*\)' % re.escape(tab), st):
                    continue
                total += 1
                if ESCRITA_CEGA.search(st):
                    escritas += 1
                    continue
                if TEM_FILTRO.search(st):
                    continue
                if POR_ID.search(st):
                    por_id += 1
                    continue
                if any(k[0] == nome and k[1] in st for k in ISENTO):
                    continue
                achados.append((nome, linha, tab, " ".join(st.split())[:150]))

    print("leituras de tabela multi-empresa: %d  (insert/upsert: %d, alteracao por id: %d)"
          % (total, escritas, por_id))
    if so_lista:
        return 0
    if not achados:
        print("OK — toda leitura filtra a empresa.")
        return 0

    print("\nSEM FILTRO DE EMPRESA (%d):\n" % len(achados))
    for nome, linha, tab, st in achados:
        print("  %s:~%d  [%s]" % (nome, linha, tab))
        print("      %s" % st)
    print("\nCada uma e um ponto onde dado de uma empresa pode aparecer na outra.")
    print("Ou adicione .eq(\"empresa\", ...), ou registre em ISENTO com o motivo.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
