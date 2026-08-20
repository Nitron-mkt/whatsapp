"""Audita os contatos usados no disparo aos representantes e aponta o que pode
dar erro de comunicacao. Le dados.json (fetch.py).

Reproduz as duas montagens de contato que existem no codigo:
  roteiro  = campanhas-roteiro: snap_rep (celular, fone_parc, email, email_crm)
  completo = campanhas-preview/repContatos: snap_rep (+ email_parc)
             + rep_contato_extra ativo
             + snap_contato e ghl_contato do codparc do rep (repBasesMap)

Normalizacao identica a do front (nf/foneCel de gestor.html):
  fone  -> so digitos, tira zeros a esquerda e o 55; >=11 digitos = celular,
           10 = fixo (o front descarta), <10 = invalido
  email -> minusculas, sem espaco nas pontas
"""
import json, io, re, collections, unicodedata

D = json.load(io.open("dados.json", encoding="utf-8"))

def nf(v):
    d = re.sub(r"\D", "", str(v or ""))
    d = re.sub(r"^0+", "", d)
    if d.startswith("55"): d = d[2:]
    return re.sub(r"^0+", "", d)
def em(v): return str(v or "").strip().lower()
def classe_fone(d):
    """11+ digitos = celular. 10 digitos: se a parte local comeca em 6-9 e celular
    no formato antigo (falta o 9o digito); comecando em 2-5 e fixo de verdade."""
    if len(d) >= 11: return "celular"
    if len(d) == 10: return "celular_sem_9" if d[2] in "6789" else "fixo"
    return "invalido"
def sugere_9(d):
    return d[:2] + "9" + d[2:] if classe_fone(d) == "celular_sem_9" else None
ROTULO = {"celular":"celular", "celular_sem_9":"celular sem o 9º dígito",
          "fixo":"telefone fixo", "invalido":"número inválido"}

cp_por_vend = {r["codvend"]: r["codparc"] for r in D["rep_carteira"] if r["codparc"] is not None}
reps = {}
for s in D["snap_rep"]:
    cp = cp_por_vend.get(s["codvend"])
    if cp is not None:
        reps[s["codvend"]] = {"rep": s["rep"], "codparc": cp, "assistente": s.get("assistente"), "sr": s}
razao = {c["codparc"]: c["razao"] for c in D["ghl_cliente"] if c.get("razao")}
cp_de_rep = {v["codparc"] for v in reps.values()}

STOP = {"REPRESENTACOES","REPRESENTACAO","REPRESENTANTE","COMERCIAL","COMERCIO","LTDA",
        "EIRELI","ME","CIA","DOS","DAS","DE","DA","DO","E"}
def norm(x):
    x = unicodedata.normalize("NFKD", str(x or "")).encode("ascii","ignore").decode()
    return re.sub(r"[^A-Z0-9 ]", " ", x.upper())
def parece_o_rep(rep, outro):
    if not outro: return False
    d = norm(outro)
    return any(t in d for t in norm(rep).split() if len(t) >= 4 and t not in STOP)

# ---- monta os contatos por rep, guardando de onde veio e em qual montagem entra
# ct[(codvend, tipo, valor_normalizado)] = {"bruto":…, "origens":set(), "roteiro":bool}
ct = {}
def add(cv, tipo, bruto, origem, roteiro=False):
    v = nf(bruto) if tipo == "fone" else em(bruto)
    if not v: return
    k = (cv, tipo, v)
    e = ct.setdefault(k, {"bruto": str(bruto).strip(), "origens": set(), "roteiro": False})
    e["origens"].add(origem)
    if roteiro: e["roteiro"] = True

for cv, r in reps.items():
    s = r["sr"]
    add(cv, "fone",  s.get("celular"),   "cadastro do rep (celular)",    roteiro=True)
    add(cv, "fone",  s.get("fone_parc"), "cadastro do rep (fone_parc)",  roteiro=True)
    add(cv, "email", s.get("email"),     "cadastro do rep (email)",      roteiro=True)
    add(cv, "email", s.get("email_crm"), "cadastro do rep (email_crm)",  roteiro=True)
    add(cv, "email", s.get("email_parc"),"cadastro do rep (email_parc)")
for e in D["rep_contato_extra"]:
    if not e.get("ativo") or e["codvend"] not in reps: continue
    add(e["codvend"], "email" if e["tipo"] == "email" else "fone", e["valor"], "adicionado na tela")
por_cp = collections.defaultdict(list)
for c in D["snap_contato"]: por_cp[c["codparc"]].append(("Sankhya", c))
for g in D["ghl_contato"]:
    if "#" in g["ghl_id"]: continue
    por_cp[g["codparc"]].append(("CRM", g))
for cv, r in reps.items():
    for base, c in por_cp.get(r["codparc"], []):
        add(cv, "fone",  c.get("fone"),  f"contato do parceiro do rep ({base})")
        add(cv, "email", c.get("email"), f"contato do parceiro do rep ({base})")

# ---- de quem mais é esse valor (clientes e outros parceiros)
dono = collections.defaultdict(set)          # (tipo, valor) -> {codparc}
for c in D["snap_contato"]:
    if c.get("fone"):  dono[("fone",  nf(c["fone"]))].add(c["codparc"])
    if c.get("email"): dono[("email", em(c["email"]))].add(c["codparc"])
for g in D["ghl_contato"]:
    if "#" in g["ghl_id"]: continue
    if g.get("fone"):  dono[("fone",  nf(g["fone"]))].add(g["codparc"])
    if g.get("email"): dono[("email", em(g["email"]))].add(g["codparc"])

# ---- agrupa por valor para achar colisao entre reps
por_valor = collections.defaultdict(list)
for (cv, tipo, v), e in ct.items(): por_valor[(tipo, v)].append((cv, e))

achados = []   # [gravidade, tipo_achado, canal, valor, quem, detalhe, efeito, acao]
def nome(cv): return reps[cv]["rep"]

# A) mesmo valor em 2+ reps
for (tipo, v), lst in por_valor.items():
    if len(lst) < 2: continue
    quem = sorted(nome(cv) for cv, _ in lst)
    rot = [nome(cv) for cv, e in lst if e["roteiro"]]
    bruto = lst[0][1]["bruto"]
    achados.append([1, "Mesmo contato em mais de um representante",
        "WhatsApp" if tipo == "fone" else "E-mail", bruto, " | ".join(quem),
        "Cadastrado em " + str(len(lst)) + " reps" + (" · no cadastro base de: " + ", ".join(sorted(rot)) if rot else " · só em contato herdado"),
        "Quem atende esse " + ("número" if tipo == "fone" else "e-mail") + " recebe a mensagem de todos esses reps, uma por rep.",
        "Decida de quem é e apague dos outros. Se for uma pessoa que atende vários reps, escolha um único rep para receber."])

# B) contato do rep que tambem esta em outro parceiro. Se o outro parceiro tem o nome
#    do rep, e o mesmo humano cadastrado duas vezes: nao erra destinatario.
for (cv, tipo, v), e in ct.items():
    outros = {cp for cp in dono.get((tipo, v), set()) if cp != reps[cv]["codparc"] and cp not in cp_de_rep}
    if not outros: continue
    nomes = [razao.get(cp) or ("cód. " + str(cp)) for cp in sorted(outros)]
    so_o_proprio = all(parece_o_rep(nome(cv), razao.get(cp)) for cp in outros if razao.get(cp)) \
                   and any(razao.get(cp) for cp in outros)
    rot = " · usado no disparo" if e["roteiro"] else ""
    if so_o_proprio:
        achados.append([3, "Mesmo rep cadastrado em dois códigos",
            "WhatsApp" if tipo == "fone" else "E-mail", e["bruto"], nome(cv),
            "Também está em: " + ", ".join(nomes[:3]) + ("…" if len(outros) > 3 else "") + rot,
            "Nenhum: é a mesma pessoa nos dois cadastros, a mensagem chega em quem deve.",
            "Só limpeza de cadastro, sem urgência para o disparo."])
    else:
        achados.append([2, "Contato do rep que também é de cliente",
            "WhatsApp" if tipo == "fone" else "E-mail", e["bruto"], nome(cv),
            "Também está em: " + ", ".join(nomes[:3]) + ("…" if len(outros) > 3 else "") + rot + " · veio de: " + "; ".join(sorted(e["origens"])),
            "A mensagem escrita para o representante chega em quem atende esse contato do cliente.",
            "Confirme de quem é. Se for do cliente, remova do cadastro/ficha do representante."])

# C) rep sem celular valido. Dois niveis, porque as campanhas nao usam a mesma base:
#    campanhas-roteiro usa so snap_rep; campanhas-preview usa snap_rep + herdados.
for cv, r in reps.items():
    sr = r["sr"]
    base = [str(x).strip() for x in (sr.get("celular"), sr.get("fone_parc")) if x]
    cel_base = [x for x in base if classe_fone(nf(x)) == "celular"]
    todos = [(v, e) for (c2, tipo, v), e in ct.items() if c2 == cv and tipo == "fone"]
    cel_todos = [v for v, e in todos if classe_fone(v) == "celular"]
    emails = [v for (c2, tipo, v), e in ct.items() if c2 == cv and tipo == "email"]
    if cel_base: continue
    tem = ", ".join(x + " (" + ROTULO[classe_fone(nf(x))] + ")" for x in base) or "nenhum telefone no cadastro"
    sug = [s9 for x in base if (s9 := sugere_9(nf(x)))]
    dica = (" Provável correção: " + ", ".join(dict.fromkeys(sug)) + " — confirme com o rep.") if sug else ""
    if not cel_todos:
        achados.append([1, "Representante não recebe WhatsApp em nenhuma campanha",
            "WhatsApp", tem, r["rep"],
            "Nenhum número com 11 dígitos, nem no cadastro nem nos contatos herdados. " +
            ("Tem e-mail." if emails else "E NÃO TEM E-MAIL."),
            "O disparo descarta fixo e número curto: este rep " + ("recebe só por e-mail." if emails else "NÃO RECEBE NADA."),
            "Cadastre o celular do representante no Sankhya (campo CELULAR)." + dica])
    else:
        achados.append([1, "Representante não recebe WhatsApp no Roteiro de visitas",
            "WhatsApp", tem, r["rep"],
            "Sem celular no cadastro do rep. Existe celular nos contatos herdados (" +
            str(len(cel_todos)) + "), que as outras campanhas usam — o Roteiro não.",
            "No disparo do Roteiro este rep recebe só por e-mail.",
            "Cadastre o celular do representante no Sankhya (campo CELULAR)." + dica])

# D) telefone fixo ou invalido no cadastro base do rep
for (cv, tipo, v), e in ct.items():
    if tipo != "fone" or not e["roteiro"]: continue
    cl = classe_fone(v)
    if cl == "celular": continue
    s9 = sugere_9(v)
    achados.append([3, "Número que o disparo descarta", "WhatsApp", e["bruto"], nome(cv),
        ROTULO[cl] + " (" + str(len(v)) + " dígitos) · " + "; ".join(sorted(e["origens"])),
        "O disparo pula este número. Se o rep tiver outro celular, não há prejuízo.",
        ("Provável correção: " + s9 + " — confirme com o rep." if s9 else "Corrija ou troque pelo celular no Sankhya.")])

# E) e-mail interno da Nitron como contato de rep
for (cv, tipo, v), e in ct.items():
    if tipo != "email" or not re.search(r"@(nitron|nitronplast)\.", v): continue
    achados.append([2, "E-mail interno da Nitron no cadastro do rep", "E-mail", e["bruto"], nome(cv),
        "Domínio da própria Nitron · " + "; ".join(sorted(e["origens"])),
        "Mensagem escrita para representante cai na caixa de alguém interno.",
        "Troque pelo e-mail do próprio representante."])

destinos = []
for cv, r in sorted(reps.items(), key=lambda x: x[1]["rep"]):
    sr = r["sr"]
    wpp = next((str(x).strip() for x in (sr.get("celular"), sr.get("fone_parc"))
                if x and classe_fone(nf(x)) == "celular"), None)
    mail = next((str(x).strip() for x in (sr.get("email"), sr.get("email_crm")) if x and em(x)), None)
    probs = [a for a in achados if a[4] == r["rep"] or r["rep"] in a[4].split(" | ")]
    g1 = [a for a in probs if a[0] == 1]
    if not wpp and not mail:  st = "NÃO RECEBE NADA"
    elif not wpp:             st = "Só e-mail (sem celular válido)"
    elif not mail:            st = "Só WhatsApp (sem e-mail)"
    elif g1:                  st = "Recebe, mas há conflito de destinatário"
    else:                     st = "OK"
    destinos.append([r["rep"], wpp or "—", mail or "—", r["assistente"] or "—", st,
                     "; ".join(sorted({a[1] for a in g1})) or ""])

ORD = {1: "1 · Erra o destinatário", 2: "2 · Pode errar o destinatário", 3: "3 · Não atrapalha, mas conserte"}
achados.sort(key=lambda a: (a[0], a[1], a[4]))
json.dump({"achados": achados, "ordem": ORD, "destinos": destinos,
           "tot_reps": len(reps), "tot_contatos": len(ct)},
          io.open("achados.json","w",encoding="utf-8"))
print("reps:", len(reps), "| contatos distintos:", len(ct))
for g in (1,2,3):
    print(f"  {ORD[g]}: {sum(1 for a in achados if a[0]==g)}")
for t, n in collections.Counter(a[1] for a in achados).most_common():
    print(f"     {n:>4}  {t}")
