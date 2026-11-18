# DERMAGA EMAS

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Valkyra54/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Valkyra54/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

DERMAGA EMAS is an original open-world crime game built for make.fun's "Make GTA 6" bounty. It takes place in Dermaga Emas, a golden-hour coastal city of beach strip, old town, harbour, causeway and lighthouse island. You drive the pink KOMODO GT through live traffic and pedestrians, run 3 story jobs, and stay ahead of the DEPD police and their helicopter, AIR-1.

The wanted system is the heart of the game: the police do not chase your car, they chase your description. A witness who sees a crime remembers the car, the jacket and the weapon — and that description is shown under the wanted stars, with a hint for how to lose each part of it. Change the car or the jacket and the match drops; descriptions fade as they are retold. At 3 stars AIR-1 keeps its spotlight on you and no disguise works while it watches.

Built with three.js on a deterministic seeded world: the same seed always builds the same city, the same traffic and the same chase.

## Run it

Static files, no build step. Serve the `game/` folder and open it in a browser:

```sh
cd game
python3 -m http.server 8000
```

Then open http://localhost:8000/ — or open `game/index.html` directly.

## Controls

- **WASD / arrows** — drive
- **SPACE** — handbrake
- **P** — pause
- **Mouse** — camera

## Scope

This build has 3 story jobs, a witness wanted system, police and helicopter chases, traffic and pedestrians. Radio is station names only; there is no save, no garage, no on-foot play and no map screen.

---

<sub>Built by [Valkyra54](https://github.com/Valkyra54) · Entered on [make.fun](https://make.fun/?ref=nbgfvtz4&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards · Referral: https://make.fun/r/nbgfvtz4</sub>
