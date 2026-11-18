// The wanted system: the DEPD hunts the player by DESCRIPTION, not just by sight.
// A witness report carries a description snapshot (car, jacket, weapon); the description
// degrades every time it is retold, and changing car or clothes drops the match. Stars
// have four visual states: solid gold (a unit has line of sight), flashing gold (the
// trail is searching), solid red (the player is near the last known position), hollow
// (reported without any description). The search zone is a circle around the last known
// position; leave it and avoid contact for a few seconds and the trail goes cold.
// Pure simulation, deterministic from the seed. A cop ramming the player never raises
// the wanted level — only witness reports do.
import { WANTED } from './config.js';

/** Stars each crime kind carries: a reckless drive is 1, a shooting seen is 2, a cop is 3. */
const STARS_BY_CRIME = { theft: 1, reckless: 1, assault: 2, gunshot: 2, cop: 3 };

export function createWanted() {
  return {
    stars: 0,
    state: 'none', // 'none' | 'los' | 'search' | 'near' | 'hollow'
    description: null, // { carColor, carModel, jacket, weapon, match }
    retells: 0,
    lastKnown: null, // { x, z } — where the player was last seen
    searchR: WANTED.searchBaseR,
    zone: null, // { x, z, r } — the search circle, mirrored to the minimap
    clearT: 0,
    los: false,
    heliWatching: false,
    flatT: 0, // flat tyres remaining (seconds) after a spike strip
    arrested: false,
  };
}

/** A witness report lands: stars rise, the description is filed, the search zone opens. */
export function reportCrime(wanted, crime) {
  const gain = STARS_BY_CRIME[crime.kind] || 1;
  wanted.stars = Math.min(3, wanted.stars + gain);
  if (crime.description) {
    wanted.description = { ...crime.description, match: 1 };
    wanted.retells = 0;
  }
  wanted.lastKnown = { x: crime.x, z: crime.z };
  wanted.searchR = WANTED.searchBaseR + 20 * (wanted.stars - 1);
  wanted.zone = { x: crime.x, z: crime.z, r: wanted.searchR };
  wanted.clearT = 0;
  wanted.state = wanted.description ? 'search' : 'hollow';
  return wanted.stars;
}

/** A description retold: each retelling keeps only 60% of the match (1 → 0.6 → 0.36). */
export function degradeDescription(wanted) {
  if (!wanted.description) return 0;
  wanted.retells += 1;
  wanted.description.match *= WANTED.retellFalloff;
  return wanted.description.match;
}

/**
 * Change identity while the trail is warm. AIR-1 watching blocks it outright — the
 * helicopter is the hard counter to description-escape. Otherwise the match drops; below
 * the floor the description matches nothing and the trail dies at once.
 * Returns true when the change went through, false when the heli blocked it.
 */
export function changeIdentity(wanted, kind) {
  if (wanted.heliWatching) return false;
  if (!wanted.description) return true;
  const drop = kind === 'car' ? 0.25 : kind === 'plates' ? 0.4 : 0.5;
  wanted.description.match *= drop;
  if (wanted.description.match < WANTED.matchFloor) clearTrail(wanted);
  return true;
}

/** The car swap (M3): the description now names the new car, at a 0.2 match — the old
 * trail goes cold on the next wanted step, when no unit has line of sight. */
export function swapCarIdentity(wanted, newDescription) {
  wanted.description = { ...newDescription, match: 0.2 };
}

/** The trail goes cold: no stars, no description, no search zone. */
export function clearTrail(wanted) {
  wanted.stars = 0;
  wanted.state = 'none';
  wanted.description = null;
  wanted.retells = 0;
  wanted.lastKnown = null;
  wanted.zone = null;
  wanted.clearT = 0;
  wanted.los = false;
}

/** A spike strip hit: flat tyres for ~25 s, top speed ~40% until repaired. */
export function applySpike(wanted) {
  wanted.flatT = WANTED.flatSeconds;
}

/**
 * One fixed step. Line of sight is any active police unit within range, or AIR-1
 * watching from above (the heli never loses contact while it is up). On a sighting the
 * search zone re-centres on the player; outside the zone with no contact for a few
 * seconds, the trail goes cold. A description too degraded to match also kills the trail.
 */
export function stepWanted(wanted, player, units, dt) {
  if (wanted.flatT > 0) wanted.flatT -= dt;

  let los = wanted.heliWatching;
  if (!los) {
    for (let i = 0; i < units.length; i += 1) {
      const u = units[i];
      if (u.wrecked) continue;
      if (Math.hypot(u.x - player.x, u.z - player.z) < WANTED.losRange) { los = true; break; }
    }
  }
  wanted.los = los;

  if (wanted.stars === 0) {
    wanted.state = 'none';
    wanted.zone = null;
    wanted.clearT = 0;
    return;
  }

  if (los) {
    wanted.lastKnown = { x: player.x, z: player.z };
    wanted.zone = { x: player.x, z: player.z, r: wanted.searchR };
    wanted.clearT = 0;
    wanted.state = 'los';
    return;
  }

  if (!wanted.description) {
    wanted.state = 'hollow';
  } else if (wanted.description.match < WANTED.matchFloor) {
    clearTrail(wanted);
    return;
  } else {
    const d = Math.hypot(player.x - wanted.lastKnown.x, player.z - wanted.lastKnown.z);
    wanted.state = d < wanted.searchR * 0.5 ? 'near' : 'search';
    if (d > wanted.searchR) {
      wanted.clearT += dt;
      if (wanted.clearT >= WANTED.clearSeconds) {
        clearTrail(wanted);
        return;
      }
    } else {
      wanted.clearT = 0;
    }
  }
  if (wanted.lastKnown) {
    wanted.zone = { x: wanted.lastKnown.x, z: wanted.lastKnown.z, r: wanted.searchR };
  }
}

/**
 * Interrupt a witness phone call: any ped in the 'report' state within range of the
 * player is stopped before the call ends — no stars from that witness. Returns how many
 * calls were interrupted.
 */
export function interruptReports(peds, player) {
  let count = 0;
  const all = peds.walkers.concat(peds.idlers);
  for (const ped of all) {
    if (ped.state !== 'report' || !ped.sawIt) continue;
    if (Math.hypot(ped.x - player.x, ped.z - player.z) > WANTED.reportInterruptRange) continue;
    ped.state = 'walk';
    ped.calmT = 6;
    ped.sawIt = null;
    ped.reportT = 0;
    count += 1;
  }
  return count;
}

/** What the HUD shows under the stars: what the police know, and how to change it. */
export function descriptionLines(wanted) {
  if (!wanted.description || wanted.stars === 0) return [];
  const d = wanted.description;
  const lines = [];
  lines.push({ label: `CAR: ${d.carColor} ${d.carModel}`, hint: 'ganti mobil / cat baru' });
  if (d.match >= 0.4) lines.push({ label: `JACKET: ${d.jacket}`, hint: 'ganti jaket' });
  if (d.match > 0.6 && d.weapon) lines.push({ label: `WEAPON: ${d.weapon}`, hint: 'buang senjata' });
  if (d.match < 0.6) lines.push({ label: 'DESKRIPSI KABUR — retold, makin samar', hint: '' });
  return lines;
}
