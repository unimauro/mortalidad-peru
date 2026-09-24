"""
Agrupación de causas de muerte a partir de códigos CIE-10.

IMPORTANTE (regla de calidad del proyecto):
- Esta es una AGRUPACIÓN APROXIMADA, construida a partir de los capítulos y
  rangos estándar de la CIE-10. NO es la Lista 10/110 oficial del MINSA/CDC-Perú.
  Se documenta aquí de forma explícita y se etiqueta como tal en el sitio.
- Los rangos de causas externas (homicidios X85–Y09, suicidios X60–X84,
  tránsito V01–V99, etc.) son los rangos habituales de la CIE-10. En certificados
  de defunción las causas externas suelen estar sub-registradas o mal codificadas;
  el dato "fino" de homicidios (Ministerio Público/INEI) y de tránsito (MTC/PNP)
  se cruza aparte. Aquí se reporta lo REGISTRADO en el certificado.

Causa básica (subyacente): se toma el ÚLTIMO código CIE-10 no vacío de la cadena
de causas A→F del certificado (regla manual estándar: la causa básica está en la
última línea completada de la Parte I). Es una aproximación a la selección oficial
(que usa tablas de decisión / software ACME/SMRT).
"""

# Cada grupo: (clave, etiqueta, eje). El orden importa: la clasificación se hace
# recorriendo REGLAS y devolviendo el primer match, así que los grupos más
# específicos (COVID, tipos de cáncer) deben verificarse antes que los generales.

EJES = {
    "metabolico": "Metabólico / cardiovascular",
    "criminalidad": "Criminalidad",
    "accidentes": "Accidentes",
    "cancer": "Cáncer",
    "transmisible": "Transmisibles",
    "otras": "Otras causas",
    "mal_definida": "Mal definidas",
}


def _code3(cie):
    """Normaliza un código CIE-10 a su forma de 3 caracteres: LETRA + 2 dígitos.
    Devuelve (letra, numero_int) o None si no es válido/está sin registro."""
    if not cie:
        return None
    c = cie.strip().upper()
    if c in ("", "SIN REGISTRO", "NO REGISTRA", "-", "NAN"):
        return None
    letra = c[0]
    if not letra.isalpha():
        return None
    # extraer los dígitos que siguen a la letra (p.ej. I219 -> 21)
    digs = ""
    for ch in c[1:]:
        if ch.isdigit():
            digs += ch
        else:
            break
    if not digs:
        return None
    try:
        num = int(digs[:2])  # dos primeros dígitos = subcategoría de 3 caracteres
    except ValueError:
        return None
    return (letra, num)


def _in(letra, num, L, lo, hi):
    return letra == L and lo <= num <= hi


# ----------------------------------------------------------------------------
# TIPOS DE CÁNCER (se evalúan primero, dentro del capítulo C00–D48)
# ----------------------------------------------------------------------------
def _tipo_cancer(letra, num):
    if letra != "C":
        return None
    if num in (16,):                return "Cáncer de estómago"
    if 18 <= num <= 21:             return "Cáncer colorrectal"
    if num == 22:                   return "Cáncer de hígado"
    if num == 25:                   return "Cáncer de páncreas"
    if 33 <= num <= 34:             return "Cáncer de pulmón/bronquios"
    if num == 50:                   return "Cáncer de mama"
    if num == 53:                   return "Cáncer de cuello uterino"
    if num == 61:                   return "Cáncer de próstata"
    if 81 <= num <= 96:             return "Leucemias/linfomas"
    return "Otros cánceres"


def clasificar(cie_codigo):
    """Devuelve dict con (grupo, etiqueta, eje, subtipo) para un código CIE-10.
    Si el código está ausente/ inválido -> grupo 'no_codificada'."""
    p = _code3(cie_codigo)
    if p is None:
        return {"grupo": "no_codificada", "etiqueta": "Causa no codificada",
                "eje": "mal_definida", "subtipo": None}
    L, n = p

    # ---- COVID-19 (U07.1/U07.2 y emergencia U09/B34.2 usado en Perú) ----
    if L == "U" and n in (7, 9):
        return {"grupo": "covid19", "etiqueta": "COVID-19", "eje": "transmisible", "subtipo": None}

    # ---- CÁNCER (C00–C97) ----
    if L == "C" and 0 <= n <= 97:
        return {"grupo": "cancer", "etiqueta": "Tumores (cáncer)", "eje": "cancer",
                "subtipo": _tipo_cancer(L, n)}

    # ---- EJE METABÓLICO / CARDIOVASCULAR ----
    if L == "E" and 10 <= n <= 14:
        return {"grupo": "diabetes", "etiqueta": "Diabetes mellitus", "eje": "metabolico", "subtipo": None}
    if L == "I" and 10 <= n <= 15:
        return {"grupo": "hipertensivas", "etiqueta": "Enfermedades hipertensivas", "eje": "metabolico", "subtipo": None}
    if L == "I" and 20 <= n <= 25:
        return {"grupo": "isquemicas", "etiqueta": "Enf. isquémicas del corazón", "eje": "metabolico", "subtipo": None}
    if L == "I" and 60 <= n <= 69:
        return {"grupo": "cerebrovascular", "etiqueta": "Enf. cerebrovasculares", "eje": "metabolico", "subtipo": None}
    if L == "I":  # resto del aparato circulatorio
        return {"grupo": "otras_cardio", "etiqueta": "Otras enf. cardiovasculares", "eje": "metabolico", "subtipo": None}
    if L == "N" and 17 <= n <= 19:
        return {"grupo": "renal_cronica", "etiqueta": "Enfermedad renal crónica", "eje": "metabolico", "subtipo": None}

    # ---- EJE CRIMINALIDAD ----
    if L == "X" and 85 <= n <= 99:
        return {"grupo": "homicidio", "etiqueta": "Homicidios / agresiones", "eje": "criminalidad", "subtipo": None}
    if L == "Y" and 0 <= n <= 9:
        return {"grupo": "homicidio", "etiqueta": "Homicidios / agresiones", "eje": "criminalidad", "subtipo": None}

    # ---- SUICIDIOS (lesiones autoinfligidas) ----
    if L == "X" and 60 <= n <= 84:
        return {"grupo": "suicidio", "etiqueta": "Suicidios (autoinfligidas)", "eje": "criminalidad", "subtipo": None}

    # ---- EJE ACCIDENTES (por tipo) ----
    if L == "V" and 1 <= n <= 99:
        return {"grupo": "acc_transito", "etiqueta": "Accidentes de tránsito", "eje": "accidentes", "subtipo": None}
    if L == "W" and 0 <= n <= 19:
        return {"grupo": "acc_caidas", "etiqueta": "Caídas", "eje": "accidentes", "subtipo": None}
    if L == "W" and 65 <= n <= 74:
        return {"grupo": "acc_ahogamiento", "etiqueta": "Ahogamiento / sumersión", "eje": "accidentes", "subtipo": None}
    if L == "X" and 40 <= n <= 49:
        return {"grupo": "acc_intoxicacion", "etiqueta": "Intoxicaciones accidentales", "eje": "accidentes", "subtipo": None}
    if L == "X" and 0 <= n <= 9:
        return {"grupo": "acc_fuego", "etiqueta": "Exposición al fuego/humo", "eje": "accidentes", "subtipo": None}
    if (L == "W") or (L == "X" and 10 <= n <= 59):
        return {"grupo": "acc_otros", "etiqueta": "Otros accidentes", "eje": "accidentes", "subtipo": None}
    if L == "Y" and 10 <= n <= 34:
        return {"grupo": "intencion_indet", "etiqueta": "Intención no determinada", "eje": "accidentes", "subtipo": None}

    # ---- TRANSMISIBLES ----
    if L == "A" and 15 <= n <= 19:
        return {"grupo": "tuberculosis", "etiqueta": "Tuberculosis", "eje": "transmisible", "subtipo": None}
    if L == "B" and 20 <= n <= 24:
        return {"grupo": "vih_sida", "etiqueta": "VIH / sida", "eje": "transmisible", "subtipo": None}
    if (L == "J" and (9 <= n <= 18 or 20 <= n <= 22)):
        return {"grupo": "neumonia", "etiqueta": "Influenza y neumonía", "eje": "transmisible", "subtipo": None}
    if L in ("A", "B"):
        return {"grupo": "otras_infecciosas", "etiqueta": "Otras infecciosas/parasitarias", "eje": "transmisible", "subtipo": None}

    # ---- OTRAS CRÓNICAS RELEVANTES ----
    if L == "J" and 40 <= n <= 47:
        return {"grupo": "epoc", "etiqueta": "Enf. respiratorias crónicas (EPOC)", "eje": "otras", "subtipo": None}
    if L == "J":
        return {"grupo": "otras_respiratorias", "etiqueta": "Otras enf. respiratorias", "eje": "otras", "subtipo": None}
    if L == "K" and 70 <= n <= 76:
        return {"grupo": "hepaticas", "etiqueta": "Enf. crónicas del hígado", "eje": "otras", "subtipo": None}
    if L == "O":
        return {"grupo": "materna", "etiqueta": "Causas maternas", "eje": "otras", "subtipo": None}
    if L in ("P",) or (L == "Q"):
        return {"grupo": "perinatal_congenita", "etiqueta": "Perinatales y congénitas", "eje": "otras", "subtipo": None}

    # ---- MAL DEFINIDAS ----
    if L == "R":
        return {"grupo": "mal_definidas", "etiqueta": "Signos/síntomas mal definidos", "eje": "mal_definida", "subtipo": None}

    # ---- RESTO ----
    return {"grupo": "otras", "etiqueta": "Otras causas", "eje": "otras", "subtipo": None}


# ----------------------------------------------------------------------------
# GRUPOS DE EDAD QUINQUENALES (18 grupos) y POBLACIÓN ESTÁNDAR OMS
# ----------------------------------------------------------------------------
GRUPOS_EDAD = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34",
               "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65-69",
               "70-74", "75-79", "80+"]

# Población Estándar Mundial de la OMS (Ahmad OB et al., 2001), reescalada a que
# los 17 grupos (0-4 ... 80+) sumen 1. Se usa para el método directo de
# estandarización por edad. Fuente: WHO Standard Population.
POB_ESTANDAR_OMS = {
    "0-4": 0.0886, "5-9": 0.0869, "10-14": 0.0860, "15-19": 0.0847,
    "20-24": 0.0822, "25-29": 0.0793, "30-34": 0.0761, "35-39": 0.0715,
    "40-44": 0.0659, "45-49": 0.0604, "50-54": 0.0537, "55-59": 0.0455,
    "60-64": 0.0372, "65-69": 0.0296, "70-74": 0.0221, "75-79": 0.0152,
    "80+": 0.0151,  # 80-84 (0.0091) + 85+ (0.0060)
}


def grupo_edad(edad_anios):
    """edad en años (int) -> etiqueta de grupo quinquenal."""
    if edad_anios is None or edad_anios < 0:
        return None
    if edad_anios >= 80:
        return "80+"
    return GRUPOS_EDAD[min(edad_anios // 5, 16)]


# 25 unidades territoriales oficiales (24 departamentos + Prov. Const. del Callao)
DEPARTAMENTOS = {
    "AMAZONAS", "ANCASH", "APURIMAC", "AREQUIPA", "AYACUCHO", "CAJAMARCA",
    "CALLAO", "CUSCO", "HUANCAVELICA", "HUANUCO", "ICA", "JUNIN", "LA LIBERTAD",
    "LAMBAYEQUE", "LIMA", "LORETO", "MADRE DE DIOS", "MOQUEGUA", "PASCO",
    "PIURA", "PUNO", "SAN MARTIN", "TACNA", "TUMBES", "UCAYALI",
}


def normaliza_departamento(dep):
    if not dep:
        return "NO DETERMINADO"
    d = dep.strip().upper()
    if d in DEPARTAMENTOS:
        return d
    return "EXTRANJERO/NO DETERMINADO"
