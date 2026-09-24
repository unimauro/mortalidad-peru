#!/usr/bin/env python3
"""Genera la imagen Open Graph (1200x630) y los favicons PNG a partir de los
datos procesados. Requiere Pillow. Uso: python pipeline/generar_imagenes.py"""
import json, os, math
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
DATOS = os.path.join(ROOT, "data", "processed", "datos.json")

BRAND = (179, 18, 43)
INK = (23, 24, 29)
PAPER = (250, 248, 244)
GOLD = (230, 159, 0)
GREEN = (0, 158, 115)

GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"
GEORGIA_B = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
ARIAL_B = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(path, size, fb=ARIAL):
    for p in (path, fb):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def heartbeat(d, x, y, w, h, color, width=6):
    """Dibuja una línea de electrocardiograma que se aplana."""
    pts = [(0, .5), (.22, .5), (.32, .18), (.46, .95), (.58, .35), (.66, .5), (1, .5)]
    px = [(x + p[0] * w, y + p[1] * h) for p in pts]
    d.line(px, fill=color, width=width, joint="curve")
    d.ellipse([px[-1][0] - width, px[-1][1] - width, px[-1][0] + width, px[-1][1] + width], fill=color)


def og():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    # banda superior de marca
    d.rectangle([0, 0, W, 12], fill=BRAND)
    # kicker
    d.text((70, 70), "OBSERVATORIO DE DATOS ABIERTOS · PERÚ", font=font(ARIAL_B, 22, ARIAL_B), fill=BRAND)
    # título
    d.text((66, 108), "¿De qué morimos", font=font(GEORGIA_B, 84, ARIAL_B), fill=INK)
    d.text((66, 196), "en el Perú?", font=font(GEORGIA_B, 84, ARIAL_B), fill=INK)
    # subtítulo
    sub = ("Mortalidad 2017–2026 · SINADEF · tasas estandarizadas por edad,\n"
           "tendencias y tres ejes de prevención. Sin cifras inventadas.")
    d.multiline_text((70, 320), sub, font=font(ARIAL, 27), fill=(74, 78, 87), spacing=10)

    # mini-gráfico real: serie total por año (barras)
    try:
        D = json.load(open(DATOS, encoding="utf-8"))
        ys = [str(a) for a in D["meta"]["anios"]]
        vals = [D["total_por_anio"][y] for y in ys]
        gx, gy, gw, gh = 70, 418, 700, 118
        mx = max(vals)
        bw = gw / len(vals) * 0.62
        gap = gw / len(vals)
        for i, (yy, v) in enumerate(zip(ys, vals)):
            bh = v / mx * gh
            x0 = gx + i * gap
            col = GOLD if yy in ("2020", "2021") else BRAND
            d.rectangle([x0, gy + gh - bh, x0 + bw, gy + gh], fill=col)
            d.text((x0, gy + gh + 8), yy[2:], font=font(ARIAL, 18), fill=(120, 124, 132))
        d.text((gx, gy - 30), "Defunciones registradas por año", font=font(ARIAL_B, 20, ARIAL_B), fill=(74, 78, 87))
    except Exception as e:
        print("mini-chart skip:", e)

    # logo heartbeat esquina
    heartbeat(d, 980, 120, 150, 70, BRAND, 8)
    d.text((980, 210), "mortalidad-peru", font=font(ARIAL_B, 24, ARIAL_B), fill=INK)
    d.text((70, H - 46), "unimauro.github.io/mortalidad-peru", font=font(ARIAL_B, 22, ARIAL_B), fill=BRAND)

    img.save(os.path.join(ASSETS, "og.png"), "PNG")
    print("og.png OK")


def icon(size, fname):
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.22)
    d.rounded_rectangle([0, 0, S, S], radius=r, fill=BRAND)
    heartbeat(d, int(S * 0.1), int(S * 0.32), int(S * 0.8), int(S * 0.36), (255, 255, 255), max(2, int(S * 0.06)))
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(ASSETS, fname), "PNG")
    print(fname, "OK")


if __name__ == "__main__":
    og()
    icon(32, "favicon-32.png")
    icon(180, "apple-touch-icon.png")
