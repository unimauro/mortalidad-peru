#!/usr/bin/env python3
"""Genera la imagen Open Graph (1200x630) de la página suicidios-homicidios.html.

Todas las cifras se leen de data/processed/contraste_violentas.json; si falta
algún dato el script termina con error en vez de dibujar un número a mano.

Requiere Pillow. Uso: python pipeline/generar_og_suicidios.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATOS = os.path.join(ROOT, "data", "processed", "contraste_violentas.json")
SALIDA = os.path.join(ROOT, "assets", "og-suicidios.png")

W, H = 1200, 630
MARGEN = 70

# Paleta del sitio (assets/styles.css)
PAPER = (250, 248, 244)
INK = (23, 24, 29)
INK_SOFT = (74, 78, 87)
LINE = (231, 226, 216)
BRAND = (179, 18, 43)
NARANJA = (213, 94, 0)   # --c4: valor del mapa viral
AZUL = (0, 114, 178)     # --c1: estimación vigente de la OMS

# Tipografías: el sitio usa Fraunces (títulos) e Inter (texto). Si no están
# instaladas se usan equivalentes del sistema (macOS y luego Linux/ubuntu).
_HOME = os.path.expanduser("~")
_MAC = "/System/Library/Fonts/Supplemental/"
_LIB = "/usr/share/fonts/truetype/liberation/"
_DJV = "/usr/share/fonts/truetype/dejavu/"
FUENTES = {
    "serif_b": [
        os.path.join(ROOT, "assets", "fonts", "Fraunces-SemiBold.ttf"),
        _HOME + "/Library/Fonts/Fraunces-SemiBold.ttf",
        "/usr/share/fonts/truetype/fraunces/Fraunces-SemiBold.ttf",
        _MAC + "Georgia Bold.ttf",
        _LIB + "LiberationSerif-Bold.ttf",
        _DJV + "DejaVuSerif-Bold.ttf",
        "DejaVuSerif-Bold.ttf",
    ],
    "sans": [
        os.path.join(ROOT, "assets", "fonts", "Inter-Regular.ttf"),
        _HOME + "/Library/Fonts/Inter-Regular.ttf",
        "/usr/share/fonts/truetype/inter/Inter-Regular.ttf",
        _MAC + "Arial.ttf",
        _LIB + "LiberationSans-Regular.ttf",
        _DJV + "DejaVuSans.ttf",
        "DejaVuSans.ttf",
    ],
    "sans_b": [
        os.path.join(ROOT, "assets", "fonts", "Inter-SemiBold.ttf"),
        _HOME + "/Library/Fonts/Inter-SemiBold.ttf",
        "/usr/share/fonts/truetype/inter/Inter-SemiBold.ttf",
        _MAC + "Arial Bold.ttf",
        _LIB + "LiberationSans-Bold.ttf",
        _DJV + "DejaVuSans-Bold.ttf",
        "DejaVuSans-Bold.ttf",
    ],
}
_usadas = {}


def font(rol, size):
    for p in FUENTES[rol]:
        try:
            f = ImageFont.truetype(p, size)
            _usadas[rol] = p
            return f
        except Exception:
            continue
    _usadas[rol] = "Pillow (fuente por defecto)"
    try:
        return ImageFont.load_default(size)  # Pillow >= 10.1: escalable
    except TypeError:
        return ImageFont.load_default()


def ancho(d, txt, f):
    return d.textlength(txt, font=f)


def envolver(d, txt, f, max_w):
    lineas, actual = [], ""
    for palabra in txt.split():
        prueba = (actual + " " + palabra).strip()
        if actual and ancho(d, prueba, f) > max_w:
            lineas.append(actual)
            actual = palabra
        else:
            actual = prueba
    if actual:
        lineas.append(actual)
    return lineas


def espaciado(d, xy, txt, f, fill, tracking=1.5):
    """Texto con interletraje (para los rótulos en mayúsculas)."""
    x, y = xy
    for ch in txt:
        d.text((x, y), ch, font=f, fill=fill)
        x += ancho(d, ch, f) + tracking
    return x


def num(v):
    return f"{v:.1f}"


def leer_datos():
    with open(DATOS, encoding="utf-8") as fh:
        D = json.load(fh)
    anio = D["meta"]["anio_mapa"]
    fila = next((p for p in D["peru"] if p.get("anio") == anio), None)
    if fila is None:
        sys.exit(f"No hay fila del Perú para el año del mapa ({anio}) en {DATOS}")
    s = fila["suicidio"]
    oms = s["oms"]
    faltan = [k for k, v in (("oms_edicion_anterior", s.get("oms_edicion_anterior")),
                             ("oms.v", oms.get("v")), ("oms.lo", oms.get("lo")),
                             ("oms.hi", oms.get("hi"))) if v is None]
    if faltan:
        sys.exit(f"Faltan datos de suicidio {anio}: {', '.join(faltan)}")
    return {"anio": anio, "mapa": float(s["oms_edicion_anterior"]),
            "oms": float(oms["v"]), "lo": float(oms["lo"]), "hi": float(oms["hi"])}


def bloque(d, x, y, rotulo, valor, color, escala, nota=None, intervalo=None):
    """Rótulo + cifra grande + barra proporcional (misma escala en ambos)."""
    espaciado(d, (x, y), rotulo.upper(), font("sans_b", 24), color, 2)
    f_num = font("serif_b", 150)
    d.text((x - 6, y + 34), num(valor), font=f_num, fill=color)
    by = y + 214
    if intervalo:
        lo, hi = intervalo
        # intervalo de incertidumbre: banda tenue detrás de la barra
        tenue = tuple(int(c + (p - c) * 0.72) for c, p in zip(color, PAPER))
        d.rectangle([x + lo * escala, by, x + hi * escala, by + 16], fill=tenue)
    d.rectangle([x, by, x + valor * escala, by + 16], fill=color)
    if nota:
        d.text((x, by + 30), nota, font=font("sans", 23), fill=INK_SOFT)


def main():
    v = leer_datos()
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # banda superior de marca (igual que assets/og.png)
    d.rectangle([0, 0, W, 12], fill=BRAND)

    # antetítulo
    espaciado(d, (MARGEN, 50),
              "Verificación de datos · Observatorio de Mortalidad del Perú".upper(),
              font("sans_b", 21), BRAND, 1.5)

    # titular
    f_tit = font("serif_b", 56)
    y = 88
    for linea in envolver(d, "¿La tasa de suicidio más baja de América Latina?",
                          f_tit, W - 2 * MARGEN - 160):
        d.text((MARGEN - 2, y), linea, font=f_tit, fill=INK)
        y += 66

    # contraste central
    d.line([MARGEN, y + 18, W - MARGEN, y + 18], fill=LINE, width=2)
    yb = y + 42
    x1, x2 = MARGEN, 520
    escala = (W - MARGEN - x2) / max(v["hi"], v["oms"], v["mapa"])
    bloque(d, x1, yb, "Mapa viral", v["mapa"], NARANJA, escala,
           nota="edición anterior de la OMS")
    bloque(d, x2, yb, "OMS vigente", v["oms"], AZUL, escala,
           nota=f"intervalo {num(v['lo'])}–{num(v['hi'])}",
           intervalo=(v["lo"], v["hi"]))
    # unidad, alineada a la derecha de la cifra de la OMS
    f_u = font("sans", 25)
    unidad = ["por 100 mil habitantes,", str(v["anio"])]
    for i, t in enumerate(unidad):
        d.text((W - MARGEN - ancho(d, t, f_u), yb + 112 + i * 34), t, font=f_u, fill=INK_SOFT)

    # pie
    d.line([MARGEN, H - 70, W - MARGEN, H - 70], fill=LINE, width=2)
    d.text((MARGEN, H - 52), "Fuentes: OMS, Banco Mundial, SINADEF, CEIC-INEI",
           font=font("sans", 21), fill=INK_SOFT)
    url = "unimauro.github.io/mortalidad-peru"
    f_url = font("sans_b", 21)
    d.text((W - MARGEN - ancho(d, url, f_url), H - 52), url, font=f_url, fill=BRAND)

    # La fuente interna de Pillow no tiene tildes ni «¿»: mejor no sobrescribir
    # el PNG versionado que publicar uno con caracteres rotos.
    if any(p.startswith("Pillow") for p in _usadas.values()):
        sys.exit("No se encontró ninguna tipografía TrueType (ni DejaVu); no se "
                 "regenera og-suicidios.png. En ubuntu: apt-get install fonts-dejavu-core")

    # PNG con paleta adaptativa: mantiene el suavizado y pesa mucho menos
    img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) \
       .save(SALIDA, "PNG", optimize=True)
    kb = os.path.getsize(SALIDA) / 1024
    print(f"og-suicidios.png OK · {kb:.0f} KB · año {v['anio']}: mapa {num(v['mapa'])} "
          f"vs OMS {num(v['oms'])} ({num(v['lo'])}–{num(v['hi'])})")
    for rol, p in sorted(_usadas.items()):
        print(f"  fuente {rol}: {p}")


if __name__ == "__main__":
    main()
