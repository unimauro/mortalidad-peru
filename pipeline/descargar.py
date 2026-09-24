#!/usr/bin/env python3
"""
Descarga la microdata cruda de SINADEF desde datosabiertos.gob.pe (MINSA).
El archivo (~365 MB) NO se versiona; se regenera con este script.

El servidor del MINSA está detrás de Cloudflare y bloquea peticiones sin
User-Agent de navegador, por eso se fija uno explícito.

Uso:  python pipeline/descargar.py
"""
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST_DIR = os.path.join(ROOT, "data", "raw")
DEST = os.path.join(DEST_DIR, "fallecidos_sinadef.csv")

# Recurso "DataSet de Información de Fallecidos del Sistema Nacional de Defunciones"
URL = "https://drive.minsa.gob.pe/s/PigmdwnCGEdyqos/download"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36")


def main():
    os.makedirs(DEST_DIR, exist_ok=True)
    print(f"Descargando SINADEF -> {DEST}")
    req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=600) as r, open(DEST, "wb") as f:
        total = int(r.headers.get("Content-Length", 0))
        leido = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            leido += len(chunk)
            if total:
                sys.stdout.write(f"\r  {leido/1e6:.0f} / {total/1e6:.0f} MB")
                sys.stdout.flush()
    print(f"\nOK — {os.path.getsize(DEST)/1e6:.0f} MB")


if __name__ == "__main__":
    main()
