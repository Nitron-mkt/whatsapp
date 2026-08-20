import json, io, os, urllib.request, urllib.parse
BASE = "https://bwbeieumxcuomtrvlqxs.supabase.co/rest/v1/"
KEY = io.open("anon.key").read().strip()
def get(tab, select, extra=""):
    out, f = [], 0
    while True:
        u = f"{BASE}{tab}?select={urllib.parse.quote(select)}{extra}"
        r = urllib.request.Request(u, headers={"apikey":KEY,"Authorization":"Bearer "+KEY,
                                              "Range-Unit":"items","Range":f"{f}-{f+999}"})
        d = json.loads(urllib.request.urlopen(r).read())
        out += d
        if len(d) < 1000: break
        f += 1000
    return out
dados = {
 "snap_rep":    get("snap_rep","codvend,rep"),
 "rep_carteira":get("rep_carteira","codvend,codparc"),
 "ghl_contato": get("ghl_contato","ghl_id,codparc,nome,fone,email,business_id,atualizado"),
 "ghl_cliente": get("ghl_cliente","codparc,razao"),
}
for k,v in dados.items(): print(f"{k:14} {len(v)}")
json.dump(dados, io.open("dados.json","w",encoding="utf-8"))
