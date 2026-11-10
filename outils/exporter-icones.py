#!/usr/bin/env python3
"""Fabrique toutes les icônes de Brief à partir du fichier maître public/icons/icon.svg.

Outil de développement, HORS de l'appli et de l'image Docker : rien de tout ça n'est utilisé quand Brief tourne.
Pour le lancer (une seule fois, quand le logo change) :
    python3 -m venv /tmp/icones && /tmp/icones/bin/pip install cairosvg pillow
    /tmp/icones/bin/python outils/exporter-icones.py

Le logo est 100 % à plat (deux couleurs unies). Fichiers fabriqués dans public/icons/ (et public/favicon.ico) :
  icon-512.png, icon-192.png   usage « any » : coins arrondis (rayon 22 %), coins transparents
  icon-180.png                 apple-touch-icon : carré plein, sans coins arrondis (iOS arrondit lui-même)
  icon-maskable-512.png        carré plein, symbole réduit à 78 % pour rester dans la zone sûre (Android découpe lui-même)
  favicon-32.png, favicon-48.png, favicon.ico   symbole un peu agrandi sur fond plein
"""
import io
import os
import re
import sys

try:
    import cairosvg
    from PIL import Image
except ImportError:
    sys.exit(__doc__)

racine = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
svg = open(os.path.join(racine, "icons", "icon.svg"), encoding="utf-8").read()
fond = re.search(r"<!--fond-->(.*?)<!--/fond-->", svg, re.S)
symbole = re.search(r"<!--symbole-->(.*?)<!--/symbole-->", svg, re.S)
if not fond or not symbole:
    sys.exit("icon.svg : repères <!--fond--> et <!--symbole--> introuvables")
couleur_fond = re.search(r'fill="(#[0-9a-fA-F]{6})"', fond.group(1)).group(1)


def assembler(arrondi=0, echelle=1.0):
    """SVG complet : fond plein (ou à coins arrondis), symbole mis à l'échelle autour du centre."""
    carre = f'<rect width="512" height="512" rx="{arrondi}" fill="{couleur_fond}"/>'
    centre = f'<g transform="translate(256 256) scale({echelle}) translate(-256 -256)">{symbole.group(1)}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{carre}{centre}</svg>'


def png(source, taille, mode):
    donnees = cairosvg.svg2png(bytestring=source.encode("utf-8"), output_width=taille, output_height=taille)
    return Image.open(io.BytesIO(donnees)).convert(mode)


ARRONDI = round(512 * 0.22)  # 113
sorties = {
    "icons/icon-512.png": png(assembler(ARRONDI), 512, "RGBA"),
    "icons/icon-192.png": png(assembler(ARRONDI), 192, "RGBA"),
    "icons/icon-180.png": png(assembler(0), 180, "RGB"),
    "icons/icon-maskable-512.png": png(assembler(0, 0.78), 512, "RGB"),
    "icons/favicon-32.png": png(assembler(0, 1.12), 32, "RGB"),
    "icons/favicon-48.png": png(assembler(0, 1.12), 48, "RGB"),
}
for nom, image in sorties.items():
    image.save(os.path.join(racine, nom), optimize=True)
    print("écrit", nom, image.size, image.mode)
png(assembler(0, 1.12), 256, "RGB").save(os.path.join(racine, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
print("écrit favicon.ico")
