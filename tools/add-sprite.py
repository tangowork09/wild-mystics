#!/usr/bin/env python3
"""Turn a painted creature image (flat grey studio background) into a 2.5D game sprite.

    python3 tools/add-sprite.py <species-id> <image.png> [--facing left|right]
    python3 tools/add-sprite.py --cut-only <image.png> <out.webp> [--max 512]   (UI art, not a sprite)

Cuts the background (flood fill from the border + soft, colour-decontaminated edge), trims to the
creature, writes public/assets/sprites/<id>.webp (+ <id>-portrait.webp) and registers it under
"sprites" in public/assets/manifest.json. The game then draws that Mystic as a billboard sprite
everywhere (overworld, battles, menus) instead of its 3D stand-in.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/assets/sprites'
MAX_SIDE = 1024
PAD = 10


def cut(path: Path) -> Image.Image:
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    # distance to the studio grey; its vignette is soft, so compare against a blurred local estimate too
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    cand = dist < 30
    lab, _ = ndi.label(cand)
    edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    back = np.isin(lab, list(edge_labels))
    # enclosed pockets of studio grey (between a tail and a wing, under an arm…): the flood fill can't
    # reach them, so take any sizeable, perfectly flat patch of the background colour as well
    tight = dist < 12
    lab_t, nt = ndi.label(tight & ~back)
    if nt:
        idx = np.arange(1, nt + 1)
        sizes = ndi.sum(np.ones_like(lab_t), lab_t, index=idx)
        spread = np.max([ndi.standard_deviation(rgb[..., c], lab_t, index=idx) for c in range(3)], axis=0)
        pocket = np.zeros(nt + 1, bool)
        pocket[1:] = (sizes >= max(120, h * w * 0.0002)) & (spread < 4.5)
        back |= pocket[lab_t]
    # soft edge: a 3 px band around the background gets alpha from colour distance
    band = ndi.binary_dilation(back, iterations=3) & ~back
    t = np.clip((dist - 14) / (46 - 14), 0, 1)
    alpha = np.ones((h, w), np.float32)
    alpha[back] = 0
    alpha[band] = (t * t * (3 - 2 * t))[band]
    alpha = ndi.gaussian_filter(alpha, 0.6)
    alpha[ndi.binary_erosion(back, iterations=1)] = 0
    # un-blend the grey from semi-transparent edge pixels so no halo shows on dark or bright ground
    a3 = alpha[..., None]
    semi = (a3 > 0.02) & (a3 < 0.98)
    col = np.where(semi, np.clip((rgb - (1 - a3) * bg) / np.maximum(a3, 0.02), 0, 255), rgb)
    # drop dust specks
    solid = alpha > 0.05
    lab2, n2 = ndi.label(solid)
    if n2 > 1:
        sizes = ndi.sum(np.ones_like(lab2), lab2, index=np.arange(1, n2 + 1))
        keep = np.zeros(n2 + 1, bool)
        keep[1:] = sizes >= max(40, sizes.max() * 0.0005)
        alpha[~keep[lab2]] = 0
    out = np.dstack([col, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(out)
    x0, y0, x1, y1 = img.getbbox()
    img = img.crop((x0, y0, x1, y1))
    s = MAX_SIDE / max(img.size)
    if s < 1:
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    padded = Image.new('RGBA', (img.width + PAD * 2, img.height + PAD * 2), (0, 0, 0, 0))
    padded.paste(img, (PAD, PAD))
    return padded


def portrait(sprite: Image.Image, size=384) -> Image.Image:
    """Square, full-body portrait with a little headroom, transparent background."""
    w, h = sprite.size
    side = int(max(w, h) * 1.08)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(sprite, ((side - w) // 2, (side - h) // 2 + int(side * 0.02)), sprite)
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    if args[0] == '--cut-only':  # UI art: cut out + trim only, no sprite registration
        src, dst = Path(args[1]).expanduser(), Path(args[2])
        side = int(args[args.index('--max') + 1]) if '--max' in args else 512
        img = cut(src)
        s = side / max(img.size)
        if s < 1:
            img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst, 'WEBP', quality=88, alpha_quality=92, method=6)
        print(f'{dst.name}: {img.width}x{img.height}, {dst.stat().st_size // 1024} KB')
        return
    sid, src = args[0], Path(args[1]).expanduser()
    facing = 'right'
    if '--facing' in args:
        facing = args[args.index('--facing') + 1]
    OUT.mkdir(parents=True, exist_ok=True)
    sprite = cut(src)
    sprite.save(OUT / f'{sid}.webp', 'WEBP', quality=88, alpha_quality=92, method=6)
    portrait(sprite).save(OUT / f'{sid}-portrait.webp', 'WEBP', quality=86, alpha_quality=90, method=6)
    mpath = ROOT / 'public/assets/manifest.json'
    manifest = json.loads(mpath.read_text())
    manifest.setdefault('sprites', {})[sid] = {
        'src': f'sprites/{sid}.webp',
        'portrait': f'sprites/{sid}-portrait.webp',
        'w': sprite.width,
        'h': sprite.height,
        'pad': PAD,
        'facing': facing,
    }
    mpath.write_text(json.dumps(manifest, indent=2) + '\n')
    kb = (OUT / f'{sid}.webp').stat().st_size // 1024
    print(f'{sid}: {sprite.width}x{sprite.height} facing {facing}, {kb} KB')


if __name__ == '__main__':
    main()
