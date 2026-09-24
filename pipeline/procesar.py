#!/usr/bin/env python3
"""
Pipeline de procesamiento — Observatorio de Mortalidad del Perú.

Lee la microdata cruda de SINADEF (data/raw/SINADEF_DATOS_ABIERTOS.csv), la
limpia y la agrega a JSON pequeños en data/processed/. NO sube el crudo al repo.

Fuente: "SINADEF DATOS ABIERTOS" (MINSA), CSV separado por comas con columnas
nombradas, cobertura 2017 → fecha actual.

Reglas de calidad:
- Causa básica (subyacente) = último código CIE-10 no vacío de la cadena A→F.
- Solo datos agregados. Se suprimen celdas < 5 en los cruces por departamento.
- Tasas por 100k y estandarizadas por edad SOLO si hay población del INEI del año.
- Nada se inventa: si falta un dato, se marca como null y se documenta.

Uso:  python pipeline/procesar.py
"""
import csv, json, os, sys, math
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from config.grupos_cie10 import (  # noqa: E402
    clasificar, grupo_edad, GRUPOS_EDAD, POB_ESTANDAR_OMS,
    normaliza_departamento, EJES,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "SINADEF_DATOS_ABIERTOS.csv")
OUT = os.path.join(ROOT, "data", "processed")
POB_FILE = os.path.join(ROOT, "pipeline", "config", "poblacion_inei.json")

# columnas del CSV (por nombre)
C_SEXO, C_EDAD, C_TEDAD = "SEXO", "EDAD", "TIEMPO_EDAD"
C_DEP = "DEPARTAMENTO_DOMICILIO"
C_ANIO, C_MES = "ANIO", "MES"
C_CIE = ["CAUSA_A_CIEX", "CAUSA_B_CIEX", "CAUSA_C_CIEX",
         "CAUSA_D_CIEX", "CAUSA_E_CIEX", "CAUSA_F_CIEX"]

SUPPRESS = 5
# grupos con serie mensual (causas externas con patrón estacional relevante)
MONTHLY_GROUPS = {"homicidio", "suicidio", "acc_transito"}
ANIO_MIN, ANIO_MAX = 2017, 2026
ANIO_PARCIAL = 2026  # año en curso, incompleto

csv.field_size_limit(1 << 24)


def edad_en_anios(edad_str, tiempo_str):
    t = (tiempo_str or "").strip().upper()
    if t and not t.startswith("A"):     # meses, días, horas... => menor de 1 año
        return 0
    try:
        e = int(float((edad_str or "").strip()))
    except (ValueError, TypeError):
        return None
    if e < 0 or e > 125:
        return None
    return e


def causa_basica(row):
    """Último código CIE-10 no vacío de la cadena (F→A)."""
    for col in reversed(C_CIE):
        cl = clasificar(row.get(col))
        if cl["grupo"] != "no_codificada":
            return cl
    return clasificar(None)


def sexo_norm(s):
    s = (s or "").strip().upper()
    if s == "MASCULINO":
        return "M"
    if s == "FEMENINO":
        return "F"
    return "I"


def main():
    if not os.path.exists(RAW):
        sys.exit(f"No existe {RAW}. Ejecuta primero: python pipeline/descargar.py")
    os.makedirs(OUT, exist_ok=True)

    total = defaultdict(int)
    total_sexo = defaultdict(lambda: defaultdict(int))
    causa_anio = defaultdict(lambda: defaultdict(int))
    causa_sexo = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    causa_edad = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    piramide = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    dep_grupo = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    dep_total = defaultdict(lambda: defaultdict(int))
    cancer_sub = defaultdict(lambda: defaultdict(int))
    cancer_sub_sexo = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))  # [anio][subtipo][sexo]
    mensual = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    mensual_grupo = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))  # [anio][mes][grupo]
    causa_edad_sexo = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(int))))
    etiquetas = {}
    edad_desc = defaultdict(int)
    n_leidos = 0
    n_fuera_rango = 0

    with open(RAW, encoding="utf-8", errors="replace", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                anio = int((row.get(C_ANIO) or "").strip())
            except (ValueError, TypeError):
                continue
            if anio < ANIO_MIN or anio > ANIO_MAX:
                n_fuera_rango += 1
                continue
            n_leidos += 1

            sx = sexo_norm(row.get(C_SEXO))
            ea = edad_en_anios(row.get(C_EDAD), row.get(C_TEDAD))
            ge = grupo_edad(ea) if ea is not None else None
            dep = normaliza_departamento(row.get(C_DEP))
            cl = causa_basica(row)
            g = cl["grupo"]
            etiquetas[g] = {"etiqueta": cl["etiqueta"], "eje": cl["eje"]}

            total[anio] += 1
            total_sexo[anio][sx] += 1
            causa_anio[anio][g] += 1
            causa_sexo[anio][g][sx] += 1
            dep_total[anio][dep] += 1
            dep_grupo[anio][dep][g] += 1
            if ge:
                causa_edad[anio][g][ge] += 1
                piramide[anio][sx][ge] += 1
                causa_edad_sexo[anio][g][sx][ge] += 1
            else:
                edad_desc[anio] += 1
            if cl["subtipo"]:
                cancer_sub[anio][cl["subtipo"]] += 1
                cancer_sub_sexo[anio][cl["subtipo"]][sx] += 1
            mes = (row.get(C_MES) or "").strip()
            if mes.isdigit():
                mm = mes.zfill(2)
                mensual[anio][mm][sx] += 1
                if g in MONTHLY_GROUPS:
                    mensual_grupo[anio][mm][g] += 1

    anios = list(range(ANIO_MIN, ANIO_MAX + 1))
    anios_completos = [a for a in anios if a != ANIO_PARCIAL]

    pob = None
    if os.path.exists(POB_FILE):
        try:
            pob = json.load(open(POB_FILE, encoding="utf-8"))
        except Exception:
            pob = None

    def pob_anio(a):
        if pob and str(a) in pob.get("nacional_por_anio", {}):
            return pob["nacional_por_anio"][str(a)]
        return None

    def tasa_cruda(n, a):
        p = pob_anio(a)
        return round(n / p * 100000, 2) if p else None

    def pob_edad(a, ge):
        """Población por grupo de edad para el año a. El INEI publica la
        estructura por edad en cortes quinquenales; se toma el más cercano y se
        reescala al total nacional del año a (supuesto documentado)."""
        if not pob:
            return None
        edad = pob.get("nacional_por_edad_sexo", {})
        if not edad:
            return None
        ref = str(a) if str(a) in edad else min(edad, key=lambda y: abs(int(y) - a))
        blk = edad[ref]
        tot = sum(blk.get(sx, {}).get(ge, 0) for sx in ("hombres", "mujeres"))
        if not tot:
            return None
        nac_a, nac_ref = pob_anio(a), pob_anio(int(ref))
        if nac_a and nac_ref and ref != str(a):
            tot = tot * nac_a / nac_ref
        return tot or None

    def tasa_estandarizada(a, dist_edad):
        if not pob or not pob_anio(a):
            return None
        num = 0.0
        for ge in GRUPOS_EDAD:
            pe = pob_edad(a, ge)
            if not pe:
                return None
            num += (dist_edad.get(ge, 0) / pe) * POB_ESTANDAR_OMS[ge]
        return round(num * 100000, 2)

    grupos = sorted(etiquetas.keys())
    series = {}
    for g in grupos:
        s = {"etiqueta": etiquetas[g]["etiqueta"], "eje": etiquetas[g]["eje"],
             "conteo": {}, "tasa_cruda": {}, "tasa_estandarizada": {}}
        for a in anios:
            n = causa_anio[a].get(g, 0)
            s["conteo"][a] = n
            s["tasa_cruda"][a] = tasa_cruda(n, a)
            s["tasa_estandarizada"][a] = tasa_estandarizada(a, causa_edad[a].get(g, {}))
        series[g] = s

    trends = {g: tendencia(series[g], anios_completos) for g in grupos}

    ult_anio = max(mensual) if mensual else ANIO_MAX
    ult_mes = max(mensual[ult_anio]) if mensual.get(ult_anio) else "12"
    meta = {
        "fuente_principal": "SINADEF — DATOS ABIERTOS (MINSA)",
        "url_fuente": "https://www.datosabiertos.gob.pe/dataset/informaci%C3%B3n-de-fallecidos-del-sistema-inform%C3%A1tico-nacional-de-defunciones-sinadef-ministerio",
        "fecha_proceso": datetime.now(timezone.utc).isoformat(),
        "ultimo_anio": ult_anio, "ultimo_mes": int(ult_mes),
        "registros_leidos": n_leidos,
        "registros_fuera_de_rango": n_fuera_rango,
        "anios": anios,
        "anios_completos": anios_completos,
        "anio_parcial": ANIO_PARCIAL,
        "poblacion_disponible": bool(pob),
        "poblacion_fuente": (pob or {}).get("fuentes") if pob else None,
        "quiebres_serie": [
            {"anio": 2017, "nota": "Inicio de SINADEF: subregistro en el arranque"},
            {"anio": 2020, "nota": "Pandemia COVID-19 (exceso de mortalidad)"},
            {"anio": 2021, "nota": "Pandemia COVID-19 (pico de mortalidad)"},
            {"anio": 2022, "nota": "Disrupción temporal de SINADEF"},
            {"anio": ANIO_PARCIAL, "nota": f"Año PARCIAL: datos hasta el mes {int(ult_mes)}"},
        ],
        "notas_calidad": [
            "Causa básica = último código CIE-10 no vacío de la cadena A→F (aprox. a la selección oficial).",
            "Agrupación de causas APROXIMADA (capítulos CIE-10), no es la Lista 10/110 oficial del MINSA.",
            "Causas externas (homicidios, tránsito) reflejan lo REGISTRADO en el certificado; hay subregistro.",
            "Celdas con menos de 5 defunciones suprimidas en cruces por departamento.",
        ],
    }

    def suprimir(n):
        return n if n >= SUPPRESS else None

    datos = {
        "meta": meta,
        "ejes": EJES,
        "etiquetas": etiquetas,
        "total_por_anio": {a: total[a] for a in anios},
        "total_por_anio_sexo": {a: dict(total_sexo[a]) for a in anios},
        "tasa_cruda_total": {a: tasa_cruda(total[a], a) for a in anios},
        "edad_desconocida": {a: edad_desc[a] for a in anios},
        "causas_por_anio": {
            a: sorted(({"grupo": g, "etiqueta": etiquetas[g]["etiqueta"],
                        "eje": etiquetas[g]["eje"], "n": causa_anio[a][g]}
                       for g in causa_anio[a]), key=lambda x: -x["n"])
            for a in anios
        },
        "series": series,
        "tendencias": trends,
        "por_sexo": {g: {a: dict(causa_sexo[a].get(g, {})) for a in anios} for g in grupos},
        "piramide": {
            a: {sx: {ge: piramide[a][sx].get(ge, 0) for ge in GRUPOS_EDAD}
                for sx in ("M", "F")} for a in anios
        },
        "por_departamento": {a: {dep: dep_total[a][dep] for dep in dep_total[a]} for a in anios},
        "tasa_departamento": {
            a: {dep: round(dep_total[a][dep] / pob["por_departamento_anio"][str(a)][dep] * 100000, 1)
                for dep in dep_total[a]
                if pob and dep in pob.get("por_departamento_anio", {}).get(str(a), {})}
            for a in anios
        } if pob else {},
        "departamento_grupo": {
            a: {dep: {g: suprimir(n) for g, n in dep_grupo[a][dep].items() if suprimir(n)}
                for dep in dep_grupo[a]} for a in anios
        },
        "cancer_subtipos": {
            a: dict(sorted(cancer_sub[a].items(), key=lambda x: -x[1])) for a in anios
        },
        "cancer_subtipos_sexo": {
            a: {sub: {"M": cancer_sub_sexo[a][sub].get("M", 0),
                      "F": cancer_sub_sexo[a][sub].get("F", 0)}
                for sub in cancer_sub[a]} for a in anios
        },
        "mensual_sexo": {
            a: {m: {"M": mensual[a][m].get("M", 0), "F": mensual[a][m].get("F", 0),
                    "T": sum(mensual[a][m].values())}
                for m in sorted(mensual[a])} for a in anios
        },
        "causa_edad_sexo": {
            a: {g: {sx: {ge: causa_edad_sexo[a][g][sx][ge] for ge in GRUPOS_EDAD
                         if causa_edad_sexo[a][g][sx].get(ge)}
                    for sx in ("M", "F")}
                for g in causa_edad_sexo[a]} for a in anios
        },
        "mensual_grupo": {
            a: {m: {g: mensual_grupo[a][m].get(g, 0) for g in MONTHLY_GROUPS}
                for m in sorted(mensual_grupo[a])} for a in anios
        },
        "monthly_groups": sorted(MONTHLY_GROUPS),
        "grupos_edad": GRUPOS_EDAD,
    }

    with open(os.path.join(OUT, "datos.json"), "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    kb = os.path.getsize(os.path.join(OUT, "datos.json")) / 1024
    print(f"OK — {n_leidos:,} registros; {len(grupos)} grupos. datos.json = {kb:.0f} KB")
    print(f"población: {'sí' if pob else 'NO'} | último dato: {int(ult_mes):02d}/{ult_anio}")
    print("Años:", {a: total[a] for a in anios})


T95 = {1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
       8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160,
       14: 2.145, 15: 2.131}


def tendencia(serie, anios_completos):
    usa = "tasa_estandarizada" if any(
        serie["tasa_estandarizada"].get(a) for a in anios_completos) else "conteo"
    xs, ys = [], []
    for a in anios_completos:
        v = serie[usa].get(a)
        if v and v > 0:
            xs.append(a)
            ys.append(math.log(v))
    out = {"metrica": usa, "n_anios": len(xs), "semaforo": "sin_datos",
           "pendiente_pct_anual": None, "ic95": None,
           "variacion_periodo_pct": None, "significativa": False}
    if len(xs) < 3:
        return out
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    b = sxy / sxx
    a0 = my - b * mx
    resid = [ys[i] - (a0 + b * xs[i]) for i in range(n)]
    dof = n - 2
    s2 = sum(r * r for r in resid) / dof if dof > 0 else 0
    se = math.sqrt(s2 / sxx) if sxx > 0 else 0
    tc = T95.get(dof, 2.0)
    cambio_anual = (math.exp(b) - 1) * 100
    lo = (math.exp(b - tc * se) - 1) * 100
    hi = (math.exp(b + tc * se) - 1) * 100
    sig = (lo > 0) or (hi < 0)
    sem = "sin_tendencia" if not sig else ("aumento" if cambio_anual > 0 else "descenso")
    v_ini = math.exp(a0 + b * xs[0])
    v_fin = math.exp(a0 + b * xs[-1])
    out.update({
        "pendiente_pct_anual": round(cambio_anual, 2),
        "ic95": [round(lo, 2), round(hi, 2)],
        "variacion_periodo_pct": round((v_fin / v_ini - 1) * 100, 1),
        "significativa": sig, "semaforo": sem,
        "anio_ini": xs[0], "anio_fin": xs[-1],
    })
    return out


if __name__ == "__main__":
    main()
