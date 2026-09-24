#!/usr/bin/env python3
"""
Descarga la microdata cruda de SINADEF (MINSA) y la deja lista en data/raw/.
El archivo se publica como ZIP en files.minsa.gob.pe y contiene el CSV completo
(2017 → fecha actual). El crudo NO se versiona; se regenera con este script.

El servidor del MINSA está tras Cloudflare y exige User-Agent de navegador.

Uso:  python pipeline/descargar.py
"""
import io
import os
import sys
import zipfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST_DIR = os.path.join(ROOT, "data", "raw")
ZIP_DEST = os.path.join(DEST_DIR, "sinadef.zip")
CSV_DEST = os.path.join(DEST_DIR, "SINADEF_DATOS_ABIERTOS.csv")

# Recurso oficial "SINADEF DATOS ABIERTOS" (ZIP con el CSV completo).
URL = "https://files.minsa.gob.pe/s/RjeWiJt2wX3pMdG/download"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36")


def main():
    os.makedirs(DEST_DIR, exist_ok=True)
    print(f"Descargando SINADEF (ZIP) -> {ZIP_DEST}")
    req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=900) as r, open(ZIP_DEST, "wb") as f:
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
    print(f"\nZIP: {os.path.getsize(ZIP_DEST)/1e6:.0f} MB. Extrayendo CSV...")
    with zipfile.ZipFile(ZIP_DEST) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(name) as src, open(CSV_DEST, "wb") as dst:
            while True:
                b = src.read(1 << 20)
                if not b:
                    break
                dst.write(b)
    os.remove(ZIP_DEST)
    print(f"OK — CSV: {os.path.getsize(CSV_DEST)/1e6:.0f} MB en {CSV_DEST}")


if __name__ == "__main__":
    main()
