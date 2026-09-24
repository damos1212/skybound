# Skybound

A browser game in the spirit of *Learn to Fly*: launch a hot-air balloon from a tropical island,
climb as high as you can, dodge whatever is up there, cash in, upgrade, and go higher. The
balloon era takes you from the beach through the cloud deck into the stratosphere; rockets, the
Moon, Mars and beyond are next on the ladder.

It renders with its own WebGPU engine (WGSL shaders, no framework) built on the engine core of
[Tidewater](https://github.com/dgreenheck/tidewater): a physically based atmosphere, volumetric
clouds you fly through and above, an FFT ocean, and toy-like vehicles under real sky light.

## Run it

Needs a browser with WebGPU (recent Chrome, Edge or Safari). No build step, no dependencies:

```sh
python3 tools/serve.py 5217
```

Then open http://127.0.0.1:5217. The first load compiles the shaders (can take ~20 s); later
visits start in well under a second.

## Controls

| Input | Action |
|---|---|
| Space / W / ↑ / hold left mouse | Burner |
| A D / ← → | Steering fans |
| Shift / E | Drop a sandbag (needs the Sandbags upgrade) |
| Esc / P | Pause |
| U | Workshop (on the pad) |
| M | Sound on/off |

Touch: hold the right half of the screen to burn, drag on the left half to steer.

## Test URLs

These never touch your saved progress:

| Parameter | Effect |
|---|---|
| `?tier=0..4` | Every upgrade at that level |
| `?cash=5000` | Start with cash |
| `?start=12000` | Launch from that altitude (m) |
| `?quality=low|medium|high` | Cloud quality |
| `?noClouds` | Skip the volumetric clouds |

`node tools/balance.mjs` simulates a run per upgrade tier and prints the peak altitude.

## Layout

| Folder | Contents |
|---|---|
| `src/engine/` | Rendering engine (from Tidewater, MIT): WebGPU device, WGSL composition, materials, lighting, shadows |
| `src/sky/` | Atmosphere (Hillaire 2020), sky, volumetric clouds adapted for any altitude, environment lighting |
| `src/ocean/` | FFT ocean simulation (Tidewater) and the curved, camera-centred sea surface |
| `src/post/` | Fog + cloud composite, temporal AA, bloom, auto exposure, motion blur, lens flare, tone mapping |
| `src/world/` | The island, launch pad and toy prop builder |
| `src/game/` | Flight physics, balloon model, hazards and pickups, upgrades, zones, game states |
| `src/ui/`, `src/audio/` | DOM overlay (hangar, workshop, HUD, results) and synthesized sound |

## Credits

- Engine core, atmosphere, clouds, FFT ocean, temporal upscaler, motion blur and lens flare are
  adapted from [Tidewater](https://github.com/dgreenheck/tidewater) by Dan Greenheck
  (© 2026 DRG Software Solutions LLC, MIT license, see `src/engine/LICENSE-tidewater`).
- Everything else (game, models, sounds) is procedural and original to this project.
- Fonts: Baloo 2 and Inter from Google Fonts (SIL OFL).
