#!/usr/bin/env python3
"""Painted UI illustrations for the ornate confirm modal (src/ui/confirm.ts), made on this Mac.

    ~/.local/share/uv/tools/mflux/bin/python tools/gen-ui-art.py [--only key,key] [--seeds 3]

Paints each key on a plain grey studio background with Z-Image-Turbo (mflux, local, free), cuts it
out (tools/add-sprite.py --cut-only) and writes src/assets/confirm/<key>.webp. With --seeds N it
paints N variants per key as resources/ui-art/<key>-<seed>.png so you can pick one:
    python3 tools/add-sprite.py --cut-only resources/ui-art/journey-2.png src/assets/confirm/journey.webp
Replace any of them with your own painted art at any time (same path, transparent webp).
"""
import argparse
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'resources/ui-art'
OUT = ROOT / 'src/assets/confirm'
SAVED = Path.home() / 'models/mflux/z-image-turbo-q8'

STYLE = ('Painterly fantasy game UI illustration, one isolated object group, centered, cozy storybook style, '
         'rich hand-painted detail, warm golden rim light, small golden sparkles, plain light-grey studio background, '
         'no text, no border, no frame —')
ART = {
    'journey': 'an unrolled ancient parchment scroll with a golden compass rose drawn on it, resting on a few mossy stones with fresh green leaves and small purple flowers',
    'erase': 'an old leather-bound adventure journal with a cracked violet crystal set in its cover, its loose pages crumbling into glowing golden dust, on mossy stones with green leaves',
    'overwrite': 'a white feather quill writing glowing golden ink across an old parchment scroll, a second rolled scroll behind it, on mossy stones with green leaves and small purple flowers',
    'abandon': 'a small expedition camp flag on a wooden pole planted between mossy stones, its torn cloth banner showing a compass emblem, the last embers of a campfire beside it, green leaves',
    'settings': 'ornate brass clockwork gears and cogs interlocking around a glowing violet gem, on mossy stones with green leaves and small purple flowers',
    'logout': 'a small arched wooden fantasy door with iron hinges in a mossy stone frame, a warm glowing lantern hanging beside it, ivy leaves and small purple flowers',
    'demolish': 'a stonemason hammer leaning against a small crumbling brick wall with fallen stones and dust, moss and green leaves',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--seeds', type=int, default=1)
    ap.add_argument('--steps', type=int, default=9)
    ap.add_argument('--model', default=str(SAVED) if SAVED.exists() else 'z-image-turbo')
    a = ap.parse_args()
    keys = a.only.split(',') if a.only else list(ART)

    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.z_image import ZImage

    if hasattr(mx, 'set_cache_limit'):
        mx.set_cache_limit(2 * 1024**3)
    t = time.time()
    saved = Path(a.model).expanduser().exists()
    model = ZImage(model_config=ModelConfig.z_image_turbo(), model_path=a.model, quantize=None if saved else 8)
    print(f'model loaded in {time.time() - t:.0f}s', flush=True)
    RAW.mkdir(parents=True, exist_ok=True)
    for k in keys:
        for seed in range(1, a.seeds + 1):
            t = time.time()
            img = model.generate_image(seed=seed * 101, prompt=f'{STYLE} {ART[k]}', num_inference_steps=a.steps, width=1024, height=1024)
            raw = RAW / f'{k}-{seed}.png'
            img.image.save(raw)
            if seed == 1:  # the first variant becomes the art; pick another later with --cut-only
                subprocess.run(['python3', str(ROOT / 'tools/add-sprite.py'), '--cut-only', str(raw), str(OUT / f'{k}.webp'), '--max', '512'], check=True)
            print(f'{k}-{seed}: {time.time() - t:.0f}s', flush=True)


if __name__ == '__main__':
    main()
