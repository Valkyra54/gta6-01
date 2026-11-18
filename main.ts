// DERMAGA EMAS — a working gta6-01 entry (Node 22, standard library only): the
// game is this directory's game/ folder, plain static files a desktop browser
// loads offline (game/index.html and its ES modules, three.js vendored under
// game/vendor/three/, no network request), and the program hands it in. It
// copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun
// library. The game is an original open-world crime game: Raka drives a pink
// KOMODO GT through the sun-soaked coastal city of Dermaga Emas — beach strip,
// old town and harbour on a seeded road graph — with traffic, pedestrians, a
// witness-memory wanted system, and 3 story jobs. Put your 3 or 4
// PNG or JPEG screenshots in screenshots/ (the first by name is the cover) and
// run it.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// Verify the output round-trips: buildDossier already refuses a bad tree,
// but this catches a partial write or a copy race — every image the dossier
// names must exist on disk with the same sha256, and the text must hold the
// game's entry point. A mismatch fails the run instead of handing in a
// dossier that does not match its screenshots.
{
  const doc = JSON.parse(readFileSync(join(out, 'dossier.json'), 'utf8'));
  if (typeof doc !== 'object' || doc === null || typeof doc.text !== 'string' || !Array.isArray(doc.images)) {
    throw new Error('main.ts: dossier.json does not parse into the expected shape');
  }
  if (doc.images.length === 0) throw new Error('main.ts: dossier holds no images');
  for (const image of doc.images) {
    const bytes = readFileSync(join(out, 'screenshots', image.name));
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== image.sha256) {
      throw new Error(`main.ts: screenshots/${image.name} on disk does not match the dossier's sha256`);
    }
  }
  if (!doc.text.includes('game/index.html')) {
    throw new Error('main.ts: dossier text does not hold the game entry point');
  }
  console.log(`dossier ok: ${doc.images.length} screenshots, cover ${doc.images[0].name}, ${doc.text.length} chars of source`);
}
