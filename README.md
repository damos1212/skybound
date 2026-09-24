# Skybound

A browser game in the spirit of *Learn to Fly*: launch from a tropical island, climb as high and as
far as you can, dodge whatever is up there, cash in, upgrade, and go again. Start with a patchwork
hot-air balloon, graduate to a staged rocket, then fly a Starship past the Moon, Mars, the Sun and
the outer planets to the black hole at the centre of the galaxy.

It renders with its own WebGPU engine (WGSL shaders, no framework) built on the engine core of
[Tidewater](https://github.com/dgreenheck/tidewater): a physically based atmosphere you can fly
out of, volumetric clouds you fly through and above, an FFT ocean, procedural planets, and toy-like
vehicles under real sky light.

## What's in it

- **Three vehicles**, each with its own upgrade tree (23 lines) and a paint shop for the rocket and
  the Starship:
  - *Hot-air balloon*: burner heat, envelope lift, sandbags, steering fans.
  - *Sounding rocket*: launched from a sea barge with a gantry; strap-on boosters that separate and
    tumble away, nose cones, fins, and a time warp while coasting to apogee.
  - *Starship*: exponential drives (every second of burn multiplies your speed), solar sails, heat
    shields for the Sun, and the Improbability Drive for the final leap.
- **18 zones** from Island Shores through the Cloud Deck, the Stratosphere, the Edge of Space and
  orbit, then the Moon, Mars, the Sun, Jupiter, Saturn (rings and all), Neptune, the Kuiper Belt,
  interstellar space and Sagittarius A*. Flybys play out in slow motion with the camera tracking
  the planet.
- **25 hazards**: gulls, geese, kites, drones, helicopters, hang gliders, paragliders, rival
  balloons, seaplanes, blimps, storm cells with lightning, airliners with contrails, weather balloons,
  fighter jets, UFOs at night, meteors, satellites, space junk, the space station, asteroids, solar
  flares, Saturn's ring ice, comets, space whales.
- **Pickups**: coins, fuel, lucky stars, shield / magnet / turbo orbs, stranded astronauts, lost
  probes, space crystals.
- **49 achievements**, a flight log, five launch times (dawn to night, with pay bonuses), generative
  music, synthesized sound, particles (exhaust, smoke, sparks, confetti, explosions), and an ending.

## Run it

Needs a browser with WebGPU (recent Chrome, Edge or Safari). No build step, no dependencies:

```sh
python3 tools/serve.py 5217
```

Then open http://127.0.0.1:5217. The first load compiles the shaders (can take ~20 s); later visits
start in about a second.

## Controls

| Input | Action |
|---|---|
| Space / W / ↑ / hold left mouse | Burner / thrust |
| A D / ← → | Steer |
| Shift / E | Drop a sandbag (balloon) |
| Esc / P | Pause |
| U | Workshop (on the pad) |
| 1 2 3 | Pick a vehicle (on the pad) |
| M | Sound on/off |

Touch: hold the right half of the screen to thrust, drag on the left half to steer.

## Test URLs

These never touch your saved progress:

| Parameter | Effect |
|---|---|
| `?tier=0..5` | Every upgrade at that level, all vehicles unlocked (5 adds the Improbability Drive) |
| `?vehicle=balloon\|rocket\|starship` | Start with that vehicle |
| `?cash=5000` | Start with cash |
| `?start=12000` | Launch from that altitude / route distance (m) |
| `?quality=low\|medium\|high` | Graphics quality |
| `?noClouds` | Skip the volumetric clouds |

`node tools/balance.mjs` simulates a run per upgrade tier for each vehicle and prints how far it gets.

## Layout

| Folder | Contents |
|---|---|
| `src/engine/` | Rendering engine (from Tidewater, MIT): WebGPU device, WGSL composition, materials, lighting, shadows |
| `src/sky/` | Atmosphere (Hillaire 2020, also from orbit), sky with the Earth from above, stars, planets and the black hole; volumetric clouds for any altitude; environment lighting |
| `src/ocean/` | FFT ocean simulation (Tidewater) and the curved, camera-centred sea surface |
| `src/post/` | Fog + cloud composite, temporal AA, bloom, auto exposure, motion blur, lens flare, tone mapping |
| `src/fx/` | Billboard particles |
| `src/world/` | The island, launch pad, rocket barge and the toy prop builder |
| `src/game/` | Vehicles and their physics, the Starship's route, hazards and pickups, upgrades, zones, achievements, game states |
| `src/ui/`, `src/audio/` | DOM overlay (hangar, workshop, HUD, results, modals, credits), synthesized sound and generative music |

## Credits

- Engine core, atmosphere, clouds, FFT ocean, temporal upscaler, motion blur and lens flare are
  adapted from [Tidewater](https://github.com/dgreenheck/tidewater) by Dan Greenheck
  (© 2026 DRG Software Solutions LLC, MIT license, see `src/engine/LICENSE-tidewater`).
- Everything else (game, models, planets, music, sounds) is procedural and original to this project.
- Fonts: Baloo 2 and Inter from Google Fonts (SIL OFL).
