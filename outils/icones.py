# Génère public/icons/icon-192.png et icon-512.png (Pillow). À relancer seulement pour changer l'icône : python3 outils/icones.py
from PIL import Image, ImageDraw
import math

def icone(taille):
    n = 2048
    img = Image.new("RGB", (n, n), "#14301f")
    # dégradé vert doux, plein cadre (icône « maskable » : pas de coins arrondis)
    d = ImageDraw.Draw(img)
    for y in range(n):
        t = y / n
        c = (int(26 + 20 * (1 - t)), int(122 - 30 * t), int(67 - 10 * t))
        d.line([(0, y), (n, y)], fill=c)
    d = ImageDraw.Draw(img)
    # triangle « lecture », au centre, dans la zone sûre (60 % du cadre)
    cx, cy, r = n * 0.46, n * 0.5, n * 0.19
    pts = [(cx - r * 0.7, cy - r), (cx - r * 0.7, cy + r), (cx + r * 1.1, cy)]
    d.polygon(pts, fill="#ffffff")
    # deux ondes sonores à droite
    for k, rayon in enumerate((n * 0.17, n * 0.27)):
        ox, oy = n * 0.55, n * 0.5
        box = [ox - rayon, oy - rayon, ox + rayon, oy + rayon]
        d.arc(box, -42, 42, fill="#d8f5e3", width=int(n * 0.028))
    return img.resize((taille, taille), Image.LANCZOS)

for t in (192, 512):
    icone(t).save(f"public/icons/icon-{t}.png", optimize=True)
