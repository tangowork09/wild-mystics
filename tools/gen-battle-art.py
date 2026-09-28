#!/usr/bin/env python3
"""Painted 2D battle art, made on this Mac (mflux Z-Image-Turbo, local and free).

    ~/.local/share/uv/tools/mflux/bin/python tools/gen-battle-art.py [--only vale,stump] [--seeds 2]

Backdrops (one per land) → src/assets/battle/<land>.webp, a wide painted scene with an empty
stage in the lower half. Props (stump, plinth) are cut out → src/assets/battle/<key>.webp.
Raw renders land in resources/battle-art/ so a better variant can be picked later. Drop your own
painted art on the same paths at any time; the game picks it up.
"""
import argparse
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'resources/battle-art'
OUT = ROOT / 'src/assets/battle'
SAVED = Path.home() / 'models/mflux/z-image-turbo-q8'

SCENE = ('Painterly 2D side-view battle background for a cozy fantasy monster-collecting game, hand-painted '
         'storybook illustration, soft golden light, rich colour, gentle depth haze, wide landscape, the lower half is '
         'an open flat grassy clearing that serves as an empty stage, no characters, no creatures, no people, no text, '
         'no UI, no border —')
BACKDROPS = {
    'vale': 'a sunny meadow clearing in a green valley, wildflowers (white daisies, bluebells), soft rolling hills, round leafy trees and a distant timber-framed village, blue sky with fluffy clouds',
    'lakes': 'a calm lakeshore clearing with reeds and cattails, water lilies on mirror-still water, misty pine forest across the lake, soft morning light',
    'coast': 'a grassy sea cliff clearing above a turquoise bay, sea-pinks and dune grass, a distant lighthouse, bright sky and gulls',
    'marsh': 'a misty swamp clearing with mossy logs, cattails, glowing mushrooms and still green water, hanging willows, soft green haze',
    'scar': 'a volcanic badlands clearing of dark rock with glowing lava cracks in the distance, ember-lit smoky orange sky, charred trees',
    'elder': 'an ancient forest glade under gigantic mossy trees, sunbeams through the canopy, ferns and glowing motes',
    'dunes': 'a desert oasis clearing with golden sand dunes, palm trees and sandstone ruins, hot bright sky',
    'peaks': 'a snowy mountain plateau clearing with pines dusted in snow, jagged peaks and a pale blue sky',
    'hollows': 'a twilight crystal cavern clearing with glowing blue and violet crystals, luminous mushrooms and starry mist',
    'summit': 'a sky-high mountaintop shrine clearing above the clouds, marble ruins, golden sunset light',
}
PROPS = {
    'stump': ('Painterly fantasy game prop, a single wide mossy tree stump with a flat top for standing on, visible growth rings, '
              'roots and a few small mushrooms, warm hand-painted storybook style, seen from the side and slightly above, '
              'full object centered, plain light-grey background, no shadow, no text —'),
    'plinth': ('Painterly fantasy game prop, a wide round ancient stone plinth with a flat top for standing on, carved rune ring, '
               'moss and ivy, warm hand-painted storybook style, seen from the side and slightly above, full object centered, '
               'plain light-grey background, no shadow, no text —'),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--seeds', type=int, default=1)
    ap.add_argument('--steps', type=int, default=9)
    ap.add_argument('--model', default=str(SAVED) if SAVED.exists() else 'z-image-turbo')
    a = ap.parse_args()
    keys = a.only.split(',') if a.only else [*PROPS, *BACKDROPS]

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
    OUT.mkdir(parents=True, exist_ok=True)
    for k in keys:
        prop = k in PROPS
        for seed in range(1, a.seeds + 1):
            t = time.time()
            prompt = PROPS[k] if prop else f'{SCENE} {BACKDROPS[k]}'
            w, h = (1024, 1024) if prop else (1344, 768)
            img = model.generate_image(seed=seed * 131, prompt=prompt, num_inference_steps=a.steps, width=w, height=h)
            raw = RAW / f'{k}-{seed}.png'
            img.image.save(raw)
            if seed == 1:
                if prop:
                    subprocess.run(['python3', str(ROOT / 'tools/add-sprite.py'), '--cut-only', str(raw), str(OUT / f'{k}.webp'), '--max', '640'], check=True)
                else:
                    subprocess.run(['python3', '-c', f'from PIL import Image; Image.open("{raw}").convert("RGB").save("{OUT / (k + ".webp")}", "WEBP", quality=84, method=6)'], check=True)
            print(f'{k}-{seed}: {time.time() - t:.0f}s', flush=True)


if __name__ == '__main__':
    main()
