# Skybound

A browser game in the spirit of *Learn to Fly*: launch from a tropical island, climb as high and as
far as you can, dodge whatever is up there, cash in, upgrade, and go again. Start with a patchwork
hot-air balloon, graduate to a staged rocket, fly a Starship past the Moon, Mars, the Sun and the
outer planets, fold space in a Warpship to other stars, nebulae and the heart of the Milky Way, and
finally dive through Sagittarius A* in the Infinity Ark to cross the galaxies, the great clusters and
the cosmic web to the edge of the observable universe.

It renders with its own WebGPU engine (WGSL shaders, no framework) built on the engine core of
[Tidewater](https://github.com/dgreenheck/tidewater): a physically based atmosphere you can fly
out of, volumetric cumulus you fly through and above (casting shadows on the sea and the island), an
FFT ocean you can see into (the seabed and its caustics through clear turquoise water, breaking
waves and surf, the island reflected), a procedurally textured island with swaying jungle, ground
bounce light, contact shadows and ambient occlusion, procedural planets, stars, nebulae and
galaxies, and toy-like vehicles with enamel, rip-stop and brushed-metal detail under real sky light.

## What's in it

- **Five vehicles**, each with its own upgrade tree (43 lines) and a paint shop for the rocket and
  the ships:
  - *Hot-air balloon*: burner heat, envelope lift, sandbags, steering fans.
  - *Sounding rocket*: launched from a sea barge with a gantry; strap-on boosters that separate and
    tumble away, nose cones, fins, and a time warp while coasting to apogee.
  - *Starship*: exponential drives (every second of burn multiplies your speed), solar sails, heat
    shields for the Sun, and the Improbability Drive for the first leap to another star.
  - *Warpship*: jumps out past the heliopause in a warp tunnel; warp core, antimatter pods, a
    radiation screen for giant stars, and **hyperjumps** (Shift) that surge ahead through anything.
  - *Infinity Ark*: a captive black hole for an engine and a spinning habitat ring; dives through
    Sagittarius A* and needs the Reality Anchor to cross the Edge.
- **32 zones**: the Earth's sky and orbit, the Moon, Mars, the Sun, Jupiter, Saturn (rings and all),
  Neptune, the Kuiper Belt; Alpha Centauri's two suns, the seven worlds of TRAPPIST-1, Betelgeuse,
  the Orion Nebula, the Crab Pulsar's beams, Sagittarius A*; the Milky Way seen from above, Omega
  Centauri, the Magellanic Clouds, Andromeda, the Virgo Cluster and M87's jet, the Great Attractor,
  the quasar 3C 273, the cosmic web and the microwave background at the edge of everything.
  Flybys play out in slow motion with the camera tracking the view.
- **33 hazards**, from gulls, kites, airliners and storm cells to satellites, asteroids and solar
  flares, then plasma balls, sweeping pulsar beams, protostar jets, hypervelocity stars, dark matter,
  alien motherships, cosmic strings to thread and quasar jets.
- **Ring chains**: sky hoops for the balloon and the rocket, warp rings for the space vehicles; every
  ring gives a kick, a whole chain pays a bonus (and refills a hyperjump).
- A glowing line marks your best height ahead of you; hit-stop on big moments, the camera leans
  into turns.
- **Pickups**: coins (with combos), fuel, lucky stars, shield / magnet / turbo orbs, stranded
  astronauts, lost probes, space crystals.
- **Missions** (three at a time per vehicle), close-call bonuses, **77 achievements**, a flight log,
  five launch times (dawn to night, with pay bonuses), photo mode, generative music, synthesized
  sound, particles, and an ending.

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
| Shift / E | Drop a sandbag (balloon) / hyperjump (Warpship, Ark) |
| C | Photo mode (drag to orbit, scroll to zoom) |
| Esc / P | Pause |
| U | Workshop (on the pad) |
| 1 – 5 | Pick a vehicle (on the pad) |
| M | Sound on/off |

Touch: hold the right half of the screen to thrust, drag on the left half to steer.

## Test URLs

These never touch your saved progress:

| Parameter | Effect |
|---|---|
| `?tier=0..5` | Every upgrade at that level, all vehicles unlocked (5 adds the Improbability Drive and the Reality Anchor) |
| `?vehicle=balloon\|rocket\|starship\|warpship\|ark` | Start with that vehicle |
| `?cash=5000` | Start with cash |
| `?start=12000` | Launch from that altitude / route distance (m) |
| `?quality=low\|medium\|high` | Graphics quality |
| `?noClouds` | Skip the volumetric clouds |

`node tools/balance.mjs` simulates a run per upgrade tier for each vehicle and prints how far it gets;
`node tools/economy.mjs` plays the whole game with a simple strategy and prints when each milestone
is reached; `node tools/route.mjs` lists what is on screen along the space route.

## Layout

| Folder | Contents |
|---|---|
| `src/engine/` | Rendering engine (from Tidewater, MIT): WebGPU device, WGSL composition, materials, lighting, shadows |
| `src/sky/` | Atmosphere (Hillaire 2020, also from orbit), sky with the Earth from above, stars, planets, exoplanets, nebulae, pulsars, galaxies, clusters, quasars, the cosmic web, the microwave background and the black hole; volumetric clouds for any altitude; environment lighting |
| `src/ocean/` | FFT ocean simulation (Tidewater) and the curved, camera-centred sea surface |
| `src/post/` | Fog + cloud composite, temporal AA, bloom, auto exposure, motion blur, lens flare, tone mapping |
| `src/fx/` | Billboard particles |
| `src/world/` | The island, launch pad, rocket barge and the toy prop builder |
| `src/game/` | Vehicles and their physics, the space route, hazards and pickups, upgrades, zones, missions, achievements, game states |
| `src/ui/`, `src/audio/` | DOM overlay (hangar, workshop, HUD, results, modals, credits), synthesized sound and generative music |

## Credits

- Engine core, atmosphere, clouds, FFT ocean, temporal upscaler, motion blur and lens flare are
  adapted from [Tidewater](https://github.com/dgreenheck/tidewater) by Dan Greenheck
  (© 2026 DRG Software Solutions LLC, MIT license, see `src/engine/LICENSE-tidewater`).
- Everything else (game, models, planets, music, sounds) is procedural and original to this project.
- Fonts: Baloo 2 and Inter from Google Fonts (SIL OFL).
