#!/usr/bin/env python3
"""Local, free creature art: paints every Mystic form on this Mac with mflux (Apple-silicon MLX),
then cuts it out and registers it as a 2.5D sprite (tools/add-sprite.py). No cloud, no API keys.

    MFLUX_PY=~/.local/share/uv/tools/mflux/bin/python
    caffeinate -i $MFLUX_PY tools/gen-creatures.py [--line ID] [--only ID] [--limit N] [--force]

The model loads ONCE and stays in memory for the whole run (the mflux CLI reloads ~31 GB per image).
Save a quantized copy first so loading never needs the full-precision weights:

    mflux-save --model z-image-turbo --quantize 8 --path ~/models/mflux/z-image-turbo-q8

Stage 1 of a line is text-to-image (Z-Image-Turbo, Apache-2.0). Stages 2-5 start FROM the previous
form's image (image-to-image) so a whole line stays one creature growing up. Prompts come from
docs/v3/creature-art.json (the roster pass). Your own art in resources/creatures/<id>.png always wins
and seeds the next stage. Resumable: finished forms are skipped unless --force.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'docs/v3/creature-art.json'
OUT = ROOT / 'resources/creatures/gen'
HANDMADE = ROOT / 'resources/creatures'
SAVED = Path.home() / 'models/mflux/z-image-turbo-q8'

STYLE = ('Stylized fantasy creature concept art for a premium monster-collecting RPG, painterly, '
         'cute-to-majestic, big expressive eyes, full body, 3/4 view, centered, plain light-grey '
         'background, no shadow, no text, no border —')
EVOLVE = ('Same creature, evolved into its next, grander form: keep its colour palette, eye design and '
          'signature features, bigger and more majestic —')


def seed_of(s: str) -> int:
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h % 100000


def groups(art: list[dict]) -> list[tuple[str, list[dict]]]:
    """line id -> its forms in stage order; forms without a line (legendaries) are their own group."""
    by: dict[str, list[dict]] = {}
    for a in art:
        by.setdefault(a.get('line') or a['id'], []).append(a)
    for forms in by.values():
        forms.sort(key=lambda a: a.get('stage') or 1)
    return list(by.items())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--line')
    ap.add_argument('--only')
    ap.add_argument('--limit', type=int, default=10**9)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--steps', type=int, default=9)
    ap.add_argument('--size', type=int, default=1024)
    ap.add_argument('--strength', type=float, default=0.34,
                    help='how much of the previous form survives (0-1); 0.34 = denoise from step 3 of 9')
    ap.add_argument('--model', default=str(SAVED) if SAVED.exists() else 'z-image-turbo')
    ap.add_argument('--q', type=int, default=8, help='quantize on load (ignored for a saved quantized model)')
    ap.add_argument('--out', default=str(OUT))
    ap.add_argument('--no-sprite', action='store_true', help='paint only, skip cut-out + manifest')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    if not ART.exists():
        sys.exit(f'missing {ART} — run the roster pass first')
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # plan the run first, so the model only loads when there is work
    jobs = []
    for line_id, forms in groups(json.loads(ART.read_text())):
        if a.line and line_id != a.line:
            continue
        prev = None
        for f in forms:
            hand = HANDMADE / f"{f['id']}.png"
            out = out_dir / f"{f['id']}.png"
            if hand.exists():
                prev = hand
                continue
            wanted = (not a.only or f['id'] == a.only) and (a.force or not out.exists())
            if wanted and len(jobs) < a.limit:
                jobs.append((line_id, f, prev, out))
            prev = out  # the next stage starts from this form (once painted)
    print(f'{len(jobs)} forms to paint')
    if a.dry_run or not jobs:
        for line_id, f, prev, out in jobs:
            print(f"  {f['id']:<18} {line_id} stage {f.get('stage', 1)}  from {prev.name if prev else 'text'}")
        return

    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.z_image import ZImage

    if hasattr(mx, 'set_cache_limit'):
        mx.set_cache_limit(2 * 1024**3)
    saved = Path(a.model).expanduser().exists()
    t = time.time()
    model = ZImage(model_config=ModelConfig.z_image_turbo(), model_path=a.model,
                   quantize=None if saved else a.q)
    print(f'model loaded in {time.time() - t:.0f}s ({a.model})', flush=True)

    t0 = time.time()
    for i, (line_id, f, prev, out) in enumerate(jobs, 1):
        t = time.time()
        img2img = prev is not None and prev.exists()
        prompt = f"{STYLE} {EVOLVE if img2img else ''} {f['prompt']}".replace('  ', ' ')
        image = model.generate_image(
            seed=seed_of(line_id), prompt=prompt, num_inference_steps=a.steps,
            width=a.size, height=a.size,
            image_path=str(prev) if img2img else None,
            image_strength=a.strength if img2img else None,
        )
        image.image.save(out)
        if not a.no_sprite:
            # system python has scipy for the cut-out; the mflux venv does not
            subprocess.run(['python3', str(ROOT / 'tools/add-sprite.py'), f['id'], str(out), '--facing', 'right'],
                           check=True, stdout=subprocess.DEVNULL)
        avg = (time.time() - t0) / i
        left = (len(jobs) - i) * avg
        print(f"[{i}/{len(jobs)}] {f['id']} ({line_id} stage {f.get('stage', 1)}) {time.time() - t:.0f}s"
              f" · avg {avg:.0f}s · ~{left / 3600:.1f} h left", flush=True)
    print(f'finished {len(jobs)} forms in {(time.time() - t0) / 60:.1f} min')


if __name__ == '__main__':
    main()
