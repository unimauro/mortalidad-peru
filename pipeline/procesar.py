#!/usr/bin/env python3
"""
Pipeline de procesamiento — Observatorio de Mortalidad del Perú.

Lee la microdata cruda de SINADEF (data/raw/fallecidos_sinadef.csv), la limpia
y la agrega a JSON pequeños en data/processed/. NO sube el crudo al repo.

Reglas de calidad:
- Causa básica (subyacente) = último código CIE-10 no vacío de la cadena A→F.
- Solo datos agregados. Se suprimen celdas con < 5 defunciones en los cruces finos.
- Tasas por 100k y estandarizadas por edad SOLO si existe pipeline/config/poblacion_inei.json.
- Nada se inventa: si falta un dato, se marca como null y se documenta.

Uso:  python pipeline/procesar.py
"""
import csv, io, json, os, sys, math
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from config.grupos_cie10 import (  # noqa: E402
    clasificar, grupo_edad, GRUPOS_EDAD, POB_ESTANDAR_OMS,
    normaliza_departamento, EJES,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "fallecidos_sinadef.csv")
OUT = os.path.join(ROOT, "data", "processed")
POB_FILE = os.path.join(ROOT, "pipeline", "config", "poblacion_inei.json")

# índices de columna (0-based) según el diccionario SINADEF
I_SEXO, I_EDAD, I_TEDAD = 2, 3, 4
I_DEP = 10
I_FECHA, I_ANIO, I_MES = 13, 14, 15
I_VIOLENTA = 18
I_CIE = [21, 23, 25, 27, 29, 31]  # CAUSA A..F (CIE-X)
NCOLS = 32
SUPPRESS = 5  # celdas < 5 se suprimen en cruces finos

ANIO_MIN, ANIO_MAX = 2017, 2024
ANIO_PARCIAL = 2024  # último año, incompleto


def registros(path):
    """Generador que reconstruye registros lógicos: una línea nueva empieza con
    'dígitos|'. Las continuaciones (saltos de línea dentro de descripciones) se
    unen al registro anterior. Devuelve la lista de campos ya separada por '|'."""
    buf = None
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
        first = True
        for line in f:
            line = line.rstrip("\n").rstrip("\r")
            head = line.split("|", 1)[0]
            es_nuevo = head.isdigit()
            if es_nuevo:
                if buf is not None:
                    yield buf
                buf = line
            else:
                if buf is None:
                    continue
                buf += " " + line.strip()
        if buf is not None:
            yield buf
    return


def edad_en_anios(edad_str, tiempo_str):
    t = (tiempo_str or "").strip().upper()
    if t and t != "AÑOS":       # meses, días, horas... => menor de 1 año
        return 0
    try:
        e = int(float((edad_str or "").strip()))
    except (ValueError, TypeError):
        return None
    if e < 0 or e > 125:
        return None
    return e


def causa_basica(campos):
    """Último código CIE-10 no vacío de la cadena (F→A). Devuelve clasificación."""
    for idx in reversed(I_CIE):  # F, E, D, C, B, A -> primer válido = más profundo
        if idx < len(campos):
            cl = clasificar(campos[idx])
            if cl["grupo"] != "no_codificada":
                return cl
    return clasificar(None)  # no_codificada


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

    # ---- contadores ----
    total = defaultdict(int)                                   # [anio]
    total_sexo = defaultdict(lambda: defaultdict(int))         # [anio][sexo]
    causa_anio = defaultdict(lambda: defaultdict(int))         # [anio][grupo]
    causa_sexo = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))  # [anio][grupo][sexo]
    causa_edad = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))  # [anio][grupo][gedad]
    piramide = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))    # [anio][sexo][gedad]
    dep_grupo = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))   # [anio][dep][grupo]
    dep_total = defaultdict(lambda: defaultdict(int))          # [anio][dep]
    cancer_sub = defaultdict(lambda: defaultdict(int))         # [anio][subtipo]
    mensual = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))     # [anio][mes][sexo]
    causa_edad_sexo = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(int))))  # [anio][grupo][sexo][gedad]
    etiquetas = {}                                            # grupo -> {etiqueta, eje}
    edad_desc = defaultdict(int)                              # [anio] edad desconocida
    n_leidos = 0
    n_fuera_rango = 0

    for campos in registros(RAW):
        parts = campos.split("|")
        if len(parts) < NCOLS:
            continue
        n_leidos += 1
        try:
            anio = int(parts[I_ANIO].strip())
        except (ValueError, IndexError):
            continue
        if anio < ANIO_MIN or anio > ANIO_MAX:
            n_fuera_rango += 1
            continue

        sx = sexo_norm(parts[I_SEXO])
        ea = edad_en_anios(parts[I_EDAD], parts[I_TEDAD])
        ge = grupo_edad(ea) if ea is not None else None
        dep = normaliza_departamento(parts[I_DEP])
        cl = causa_basica(parts)
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
        mes = parts[I_MES].strip().zfill(2) if parts[I_MES].strip().isdigit() else None
        if mes:
            mensual[anio][mes][sx] += 1

    anios = list(range(ANIO_MIN, ANIO_MAX + 1))
    anios_completos = [a for a in anios if a != ANIO_PARCIAL]

    # ---- población (opcional) ----
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
        """Población nacional por grupo de edad (ambos sexos) para el año a.
        El INEI solo publica la estructura por edad en cortes quinquenales
        (2020 en esta serie), así que se toma el año de referencia disponible y
        se REESCALA su distribución por edad al total nacional del año a. Es un
        supuesto documentado (estructura etaria ~constante, total correcto)."""
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
            tot = tot * nac_a / nac_ref   # reescala al total del año a
        return tot or None

    def tasa_estandarizada(a, dist_edad):
        """Método directo con población estándar OMS. dist_edad = {gedad: nº}."""
        if not pob:
            return None
        num = 0.0
        for ge in GRUPOS_EDAD:
            pe = pob_edad(a, ge)
            if not pe:
                return None
            tasa_esp = dist_edad.get(ge, 0) / pe
            num += tasa_esp * POB_ESTANDAR_OMS[ge]
        return round(num * 100000, 2)

    # ---- series por grupo (conteo, tasa cruda, tasa estandarizada) ----
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

    # ---- tendencias (Fase 3) ----
    trends = {g: tendencia(series[g], anios_completos) for g in grupos}

    # ---- ensamblar salida ----
    meta = {
        "fuente_principal": "SINADEF — Información de Fallecidos (MINSA), datosabiertos.gob.pe",
        "url_fuente": "https://www.datosabiertos.gob.pe/dataset/informaci%C3%B3n-de-fallecidos-del-sistema-inform%C3%A1tico-nacional-de-defunciones-sinadef-ministerio",
        "fecha_proceso": datetime.now(timezone.utc).isoformat(),
        "registros_leidos": n_leidos,
        "registros_fuera_de_rango": n_fuera_rango,
        "anios": anios,
        "anios_completos": anios_completos,
        "anio_parcial": ANIO_PARCIAL,
        "poblacion_disponible": bool(pob),
        "poblacion_fuente": (pob or {}).get("fuentes") if pob else None,
        "quiebres_serie": [
            {"anio": 2017, "nota": "Inicio de SINADEF: subregistro alto en el arranque"},
            {"anio": 2020, "nota": "Pandemia COVID-19 (exceso de mortalidad)"},
            {"anio": 2021, "nota": "Pandemia COVID-19 (pico de mortalidad)"},
            {"anio": 2022, "nota": "Disrupción/cierre temporal de SINADEF"},
            {"anio": 2024, "nota": "Año PARCIAL: microdata oficial llega hasta 2024-05-05"},
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
        "por_sexo": {
            g: {a: dict(causa_sexo[a].get(g, {})) for a in anios} for g in grupos
        },
        "piramide": {
            a: {sx: {ge: piramide[a][sx].get(ge, 0) for ge in GRUPOS_EDAD}
                for sx in ("M", "F")} for a in anios
        },
        "por_departamento": {
            a: {dep: dep_total[a][dep] for dep in dep_total[a]} for a in anios
        },
        "tasa_departamento": {
            a: {dep: round(dep_total[a][dep] / pob["por_departamento_anio"][str(a)][dep] * 100000, 1)
                for dep in dep_total[a]
                if pob and dep in pob.get("por_departamento_anio", {}).get(str(a), {})}
            for a in anios
        } if pob else {},
        "departamento_grupo": {
            a: {dep: {g: suprimir(n) for g, n in dep_grupo[a][dep].items()
                      if suprimir(n)} for dep in dep_grupo[a]} for a in anios
        },
        "cancer_subtipos": {
            a: dict(sorted(cancer_sub[a].items(), key=lambda x: -x[1])) for a in anios
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
        "grupos_edad": GRUPOS_EDAD,
    }

    # ---- escribir ----
    with open(os.path.join(OUT, "datos.json"), "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    kb = os.path.getsize(os.path.join(OUT, "datos.json")) / 1024
    print(f"OK — {n_leidos:,} registros procesados; {len(grupos)} grupos de causa.")
    print(f"datos.json = {kb:.0f} KB  | población: {'sí' if pob else 'NO (solo conteos)'}")
    print("Años:", total.__len__(), {a: total[a] for a in anios})


# t crítico (dos colas, 95%) por grados de libertad
T95 = {1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
       8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160,
       14: 2.145, 15: 2.131}


def tendencia(serie, anios_completos):
    """Regresión log-lineal de la tasa estandarizada (o del conteo si no hay
    población) sobre los años completos. Devuelve variación anual %, acumulada,
    pendiente con IC 95% y semáforo (solo si es estadísticamente significativa)."""
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
    b = sxy / sxx                      # pendiente en log
    a0 = my - b * mx
    resid = [ys[i] - (a0 + b * xs[i]) for i in range(n)]
    dof = n - 2
    s2 = sum(r * r for r in resid) / dof if dof > 0 else 0
    se = math.sqrt(s2 / sxx) if sxx > 0 else 0
    tc = T95.get(dof, 2.0)
    cambio_anual = (math.exp(b) - 1) * 100
    lo = (math.exp(b - tc * se) - 1) * 100
    hi = (math.exp(b + tc * se) - 1) * 100
    sig = (lo > 0) or (hi < 0)         # IC excluye 0
    if not sig:
        sem = "sin_tendencia"
    elif cambio_anual > 0:
        sem = "aumento"
    else:
        sem = "descenso"
    v_ini = math.exp(a0 + b * xs[0])
    v_fin = math.exp(a0 + b * xs[-1])
    out.update({
        "pendiente_pct_anual": round(cambio_anual, 2),
        "ic95": [round(lo, 2), round(hi, 2)],
        "variacion_periodo_pct": round((v_fin / v_ini - 1) * 100, 1),
        "significativa": sig,
        "semaforo": sem,
        "anio_ini": xs[0], "anio_fin": xs[-1],
    })
    return out


if __name__ == "__main__":
    main()
