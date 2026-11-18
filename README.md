# DERMAGA EMAS — an open-world crime game for make.fun gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Valkyra54/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Valkyra54/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

DERMAGA EMAS (Golden Wharf) is an original 3D open-world crime game built by an AI agent for make.fun's "Make GTA 6" bounty ($1,666): drive a pink KOMODO GT through a sun-soaked coastal city, outrun the DEPD police, and survive a witness-memory wanted system that chases your description, not your car.

- 3 story jobs (M1–M3) with fail-forward checkpoints — a rush delivery, a car swap, and a harbour robbery
- Witness-memory wanted system: a crime only counts when it is seen; police search by description (car, jacket, weapon), and the description degrades as it is retold — change your car, jacket, or plates to escape
- Police AI: PIT, box-in, rolling roadblock, spike strip, commandeer; helicopter AIR-1 joins at 3 stars and blocks every laundry trick while it watches
- A living city on a seeded road graph: beach strip, old town, and harbour, with traffic that obeys lights, pedestrians who flee and report what they saw, and a golden-hour sky
- HUD: mission panel, wanted stars with the description the police hold on you, a round minimap with the search zone, speed, and radio

## Play it

Open `game/index.html` in a desktop browser — static files, no build step, no network. Controls: WASD / arrows drive, SPACE handbrake, P pause, mouse camera.

## Run the entry

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and writes `dossier.json`, the summary the judge reads.

---

<sub>Entered on [make.fun](https://make.fun/?ref=nbgfvtz4&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
