# Skybound

A browser game in the spirit of *Learn to Fly*: launch from a tropical island, fly as high as you can,
cash in, upgrade and go again, from a patchwork hot-air balloon all the way to the edge of the
observable universe.

### ▶ [Play it here](https://damos1212.github.io/skybound/)

Needs a browser with WebGPU (a recent Chrome, Edge or Safari on desktop). The first visit builds the
shaders and can take a little while; later visits start in about a second.

## Features

- **Five vehicles**, each with its own upgrade tree: hot-air balloon, sounding rocket, Starship,
  Warpship and the Infinity Ark.
- **32 zones**: the island's sky, orbit, the Moon, the planets, the Sun, other stars, nebulae, the heart
  of the Milky Way, other galaxies, the cosmic web and the edge of everything.
- Hazards, ring chains, pickups, missions, sky events, achievements, five launch times and photo mode.
- A custom WebGPU renderer: physically based atmosphere, volumetric clouds, an FFT ocean with breaking
  surf and caustics, god rays, local lights, temporal AA, bloom and auto exposure.
- Music and sound synthesized live in the browser.

## Controls

| Input | Action |
|---|---|
| Space / W / ↑ / hold mouse | Burner / thrust (tap to skip intros) |
| A D / ← → | Steer |
| Shift / E | Sandbag (balloon), afterburner (rocket), hyperjump (Warpship, Ark) |
| R / U | After a run: fly again / open the workshop |
| C | Photo mode |
| Esc / P | Pause |
| M | Sound on/off |

On touch screens, hold the right half of the screen to thrust and drag on the left half to steer.

## Run locally

No build step and no dependencies:

```sh
python3 tools/serve.py 5217
```

Then open http://127.0.0.1:5217.

## Credits

- The engine core, atmosphere, clouds, FFT ocean, temporal upscaler, motion blur and lens flare are
  adapted from [Tidewater](https://github.com/dgreenheck/tidewater) by Dan Greenheck (MIT, see
  `src/engine/LICENSE-tidewater`).
- Fonts: Baloo 2 and Inter from Google Fonts (SIL OFL).
