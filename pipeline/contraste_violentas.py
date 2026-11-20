#!/usr/bin/env python3
"""Contraste de suicidios y homicidios: SINADEF (dos lecturas) vs OMS vs CEIC-INEI.

Genera data/processed/contraste_violentas.json. Solo biblioteca estándar.

Fuentes (todas descargadas, ninguna cifra tecleada a mano salvo las del mapa viral,
que se transcriben de la imagen para poder verificarlas):
  - SINADEF Datos Abiertos (data/raw/SINADEF_DATOS_ABIERTOS.csv)
      a) código CIE-10 en cualquier posición de la cadena A-F
      b) campo MUERTE_VIOLENTA del certificado
  - OMS, Global Health Observatory (API OData): SDGSUICIDE, VIOLENCE_HOMICIDERATE
  - Banco Mundial SH.STA.SUIC.P5 (copia de una edición anterior de la estimación OMS)
  - CEIC-INEI homicidios (pipeline/config/fuentes_criminalidad.json)
  - INEI población (pipeline/config/poblacion_inei.json)

Uso:  python pipeline/contraste_violentas.py
"""
import csv, json, collections, datetime, pathlib, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "contraste"
OUT = ROOT / "data" / "processed" / "contraste_violentas.json"

PAISES = {
    "ARG": "Argentina", "BOL": "Bolivia", "BRA": "Brasil", "CHL": "Chile", "COL": "Colombia",
    "CRI": "Costa Rica", "CUB": "Cuba", "DOM": "Rep. Dominicana", "ECU": "Ecuador",
    "SLV": "El Salvador", "GTM": "Guatemala", "HTI": "Haití", "HND": "Honduras",
    "MEX": "México", "NIC": "Nicaragua", "PAN": "Panamá", "PRY": "Paraguay", "PER": "Perú",
    "URY": "Uruguay", "VEN": "Venezuela",
}
# Cifras tal como aparecen en la imagen viral ("Suicide rates per 100,000 people",
# The World in Maps, "Source: WHO"). Solo países cuya etiqueta es inequívoca.
MAPA_VIRAL = {"MEX": 7, "CUB": 13.8, "COL": 5, "VEN": 8.6, "ECU": 7.6, "PER": 1.5, "BRA": 7.6,
              "BOL": 4.2, "PRY": 6.4, "CHL": 7.7, "ARG": 7.9, "URY": 24.8, "CRI": 8.1, "PAN": 3.3}

GHO = "https://ghoapi.azureedge.net/api/{}"
WB = ("https://api.worldbank.org/v2/country/{}/indicator/SH.STA.SUIC.P5"
      "?format=json&date=2000:2023&per_page=2000")


def bajar(url, nombre):
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / nombre
    if not p.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "observatorio-mortalidad/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            p.write_bytes(r.read())
    return json.loads(p.read_text(encoding="utf-8"))


def oms(indicador):
    """{iso3: {anio: {v, lo, hi}}} para ambos sexos, todas las edades."""
    out = collections.defaultdict(dict)
    for x in bajar(GHO.format(indicador), indicador + ".json")["value"]:
        if x["SpatialDim"] not in PAISES or x["Dim1"] != "SEX_BTSX":
            continue
        if x.get("Dim2") not in (None, "AGEGROUP_YEARSALL"):
            continue
        if x["NumericValue"] is None:
            continue
        out[x["SpatialDim"]][str(x["TimeDim"])] = {
            "v": round(x["NumericValue"], 2),
            "lo": None if x["Low"] is None else round(x["Low"], 2),
            "hi": None if x["High"] is None else round(x["High"], 2),
        }
    return out


def banco_mundial():
    j = bajar(WB.format(";".join(PAISES)), "WB_SH.STA.SUIC.P5.json")
    out = collections.defaultdict(dict)
    for x in j[1]:
        if x["value"] is not None:
            out[x["countryiso3code"]][x["date"]] = round(x["value"], 2)
    return out, j[0].get("lastupdated")


def grupo_cie(c):
    c = (c or "").strip().upper().replace(".", "")
    if len(c) < 3 or not c[0].isalpha() or not c[1:3].isdigit():
        return None
    l, n = c[0], int(c[1:3])
    if l == "X" and 60 <= n <= 84:
        return "suicidio"
    if (l == "X" and n >= 85) or (l == "Y" and n <= 9):
        return "homicidio"
    if l == "Y" and 10 <= n <= 34:
        return "indeterminada"
    return None


def sinadef():
    cie = collections.defaultdict(collections.Counter)
    campo = collections.defaultdict(collections.Counter)
    total = collections.Counter()
    sin_codigo = collections.Counter()
    ult = ""
    cols = ["CAUSA_%s_CIEX" % k for k in "ABCDEF"]
    with open(RAW / "SINADEF_DATOS_ABIERTOS.csv", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            a = row["ANIO"]
            total[a] += 1
            ult = max(ult, row["FECHA"])
            campo[a][row["MUERTE_VIOLENTA"].strip().upper()] += 1
            codigos = [row[c].strip().upper() for c in cols]
            if not any(len(c) >= 3 and c[0].isalpha() and c[1:3].isdigit() for c in codigos):
                sin_codigo[a] += 1
            for g in {grupo_cie(c) for c in codigos} - {None}:
                cie[a][g] += 1
    return cie, campo, total, sin_codigo, ult


def main():
    pob = json.loads((ROOT / "pipeline/config/poblacion_inei.json").read_text())["nacional_por_anio"]
    ceic = json.loads((ROOT / "pipeline/config/fuentes_criminalidad.json").read_text())["homicidios"]
    cie, campo, total, sin_codigo, ult = sinadef()
    anio_parcial = ult[:4]
    anios = [a for a in sorted(total) if a != anio_parcial]
    tasa = lambda n, a: round(n / pob[a] * 1e5, 2)

    o_sui, o_hom = oms("SDGSUICIDE"), oms("VIOLENCE_HOMICIDERATE")
    wb, wb_fecha = banco_mundial()

    peru = []
    for a in anios:
        c = campo[a]
        peru.append({
            "anio": int(a), "poblacion": pob[a], "defunciones_sinadef": total[a],
            "pct_sin_codigo_cie": round(sin_codigo[a] / total[a] * 100, 1),
            "violenta_no_se_conoce": c["NO SE CONOCE"],
            "suicidio": {
                "sinadef_cie_n": cie[a]["suicidio"], "sinadef_cie_tasa": tasa(cie[a]["suicidio"], a),
                "sinadef_campo_n": c["SUICIDIO"], "sinadef_campo_tasa": tasa(c["SUICIDIO"], a),
                "techo_n": c["SUICIDIO"] + c["NO SE CONOCE"],
                "techo_tasa": tasa(c["SUICIDIO"] + c["NO SE CONOCE"], a),
                "oms": o_sui["PER"].get(a), "oms_edicion_anterior": wb["PER"].get(a),
            },
            "homicidio": {
                "sinadef_cie_n": cie[a]["homicidio"], "sinadef_cie_tasa": tasa(cie[a]["homicidio"], a),
                "sinadef_campo_n": c["HOMICIDIO"], "sinadef_campo_tasa": tasa(c["HOMICIDIO"], a),
                "ceic_n": ceic["serie"].get(a), "ceic_tasa": ceic["tasa_100k"].get(a),
                "oms": o_hom["PER"].get(a),
            },
        })

    a_sui = max(o_sui["PER"])                       # último año OMS suicidio
    a_hom = max(o_hom["PER"])                       # último año OMS homicidio
    a_mapa = max(wb["PER"])                         # año de la edición anterior
    latam = []
    for iso, nombre in PAISES.items():
        latam.append({
            "iso3": iso, "pais": nombre,
            "mapa_viral": MAPA_VIRAL.get(iso),
            "oms_edicion_anterior": wb[iso].get(a_mapa),
            "oms_vigente_mismo_anio": o_sui[iso].get(a_mapa),
            "oms_vigente_ultimo": o_sui[iso].get(a_sui),
            "homicidio_oms": o_hom[iso].get(a_hom),
        })

    # series largas por país y año (para el selector de año)
    series = {}
    for iso in PAISES:
        series[iso] = {
            "vig": {a: [x["v"], x["lo"], x["hi"]] for a, x in sorted(o_sui[iso].items())},
            "ant": dict(sorted(wb[iso].items())),
            "hom": {a: x["v"] for a, x in sorted(o_hom[iso].items())},
        }

    coinc = [(x["iso3"], x["mapa_viral"], x["oms_edicion_anterior"]) for x in latam
             if x["mapa_viral"] is not None and x["oms_edicion_anterior"] is not None]
    n_ok = sum(1 for _, m, w in coinc if abs(m - w) <= 0.06 or round(w) == m)

    out = {
        "meta": {
            "generado": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "sinadef_ultima_defuncion": ult, "anios": [int(a) for a in anios],
            "anio_oms_suicidio": int(a_sui), "anio_oms_homicidio": int(a_hom),
            "anio_mapa": int(a_mapa), "banco_mundial_actualizado": wb_fecha,
            "mapa_coincidencias": {"paises_comparados": len(coinc), "coinciden": n_ok},
            "fuentes": {
                "sinadef": "https://www.datosabiertos.gob.pe/dataset/informaci%C3%B3n-de-fallecidos-del-sistema-inform%C3%A1tico-nacional-de-defunciones-sinadef-ministerio",
                "oms_suicidio": "https://www.who.int/data/gho/data/indicators/indicator-details/GHO/crude-suicide-rates-(per-100-000-population)",
                "oms_homicidio": "https://www.who.int/data/gho/data/indicators/indicator-details/GHO/estimates-of-rates-of-homicides-per-100-000-population",
                "oms_api": "https://ghoapi.azureedge.net/api/SDGSUICIDE",
                "banco_mundial": "https://data.worldbank.org/indicator/SH.STA.SUIC.P5",
                "ceic": ceic.get("url", "").split(" | ")[0],
            },
            "notas": [
                "Tasas crudas por 100 mil habitantes, ambos sexos. Población: INEI (base Censo 2017).",
                "SINADEF 'CIE-10': certificados con código X60-X84 (suicidio) o X85-Y09 (homicidio) en cualquier posición de la cadena de causas A-F.",
                "SINADEF 'campo': casilla MUERTE_VIOLENTA del certificado (SUICIDIO / HOMICIDIO).",
                "'Techo' = suicidios del campo + muertes violentas marcadas 'NO SE CONOCE'. Es una cota superior de lo certificado, no una estimación: no todas esas muertes son suicidios.",
                "OMS: estimación modelada con intervalo de incertidumbre; no es un conteo.",
                "La 'edición anterior' de la OMS es la que hoy sigue publicando el Banco Mundial (SH.STA.SUIC.P5).",
                "Se excluye el año en curso (parcial).",
            ],
        },
        "peru": peru,
        "latam": latam,
        "series": series,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("OK", OUT, "| mapa:", n_ok, "de", len(coinc), "coinciden con la edición anterior OMS")
    for p in peru:
        s, h = p["suicidio"], p["homicidio"]
        print(p["anio"], "SUI cie", s["sinadef_cie_tasa"], "campo", s["sinadef_campo_tasa"],
              "techo", s["techo_tasa"], "OMS", (s["oms"] or {}).get("v"), "OMSant", s["oms_edicion_anterior"],
              "| HOM cie", h["sinadef_cie_tasa"], "campo", h["sinadef_campo_tasa"],
              "CEIC", h["ceic_tasa"], "OMS", (h["oms"] or {}).get("v"))


if __name__ == "__main__":
    main()
