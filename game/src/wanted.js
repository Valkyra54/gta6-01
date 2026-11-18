// The wanted system: the police hunt the player by DESCRIPTION, not just by
// sight. A witness phones in what it saw (a 3–5 s call, interruptible); the
// description degrades every time it is retold; changing the car, the jacket
// or the weapon drops the match until the police lose the trail. Stars are a
// line-of-sight game, not a timer: solid gold while a cop sees you, flashing
// gold while they search, solid red near the scene, hollow when the crime was
// reported with no description at all. Escape is break line of sight, leave
// the search zone, stay hidden. Pure sim — plain data, seeded RNG, no DOM.

/** Seconds of no contact (and outside the zone) before the trail goes cold. */
const CLEAR_AFTER = { 1: 4, 2: 6, 3: 8 };
const SEARCH_RADIUS = { 1: 60, 2: 80, 3: 100 };
const CALL_INTERRUPT_DIST = 2.5;

/** The wanted state, fresh: no stars, nothing known, nowhere to search. */
export function createWanted() {
  return {
    stars: 0,
    /** 'none' | 'seen' | 'searching' | 'near' | 'reported' — what the HUD draws. */
    display: 'none',
    /** What the police know: null fields are unknown. */
    description: null,
    /** 1 = fresh eyewitness; every retell multiplies it by 0.6. */
    quality: 1,
    lastKnown: null, // { x, z } — where the player was last seen
    searchZone: null, // { x, z, radius } — the red circle on the map
    seenTimer: 0, // seconds since anyone last saw the player
    clearTimer: 0, // seconds of no contact outside the zone
    heliWatching: false, // AIR-1 overhead: laundry does not work
    crime: null, // the last reported crime, for the radio (Day 4)
  };
}

/**
 * One retell of a description: the quality drops and each known field has a
 * (1 - quality) chance of being forgotten. A twice-retold pink KOMODO GT
 * becomes "a dark car", then nothing at all.
 */
export function degradeDescription(description, quality, rng) {
  const nextQuality = quality * 0.6;
  const out = {};
  for (const key of ['carColor', 'carModel', 'jacket', 'weapon']) {
    const value = description[key];
    out[key] = value && rng() < nextQuality ? value : null;
  }
  return { description: out, quality: nextQuality };
}

/**
 * A crime is reported: stars rise, the description is what the police know,
 * the last-known position and the search zone move to the scene. A new crime
 * while already wanted raises the level by one (a witness report on a clean
 * record starts at 1 star). Returns true when anything changed.
 */
export function reportCrime(wanted, kind, x, z, description, time) {
  const base = kind === 'ram-police' || kind === 'gunshot' ? 2 : 1;
  const next = wanted.stars === 0 ? base : Math.min(3, wanted.stars + (base === 2 ? 1 : 0));
  if (next === wanted.stars && wanted.description) return false;
  wanted.stars = next;
  // A fresh report replaces what is known field by field; unknown fields
  // stay unknown rather than being overwritten with nothing.
  if (description) {
    const old = wanted.description || { carColor: null, carModel: null, jacket: null, weapon: null };
    wanted.description = {
      carColor: description.carColor ?? old.carColor,
      carModel: description.carModel ?? old.carModel,
      jacket: description.jacket ?? old.jacket,
      weapon: description.weapon ?? old.weapon,
    };
    wanted.quality = 1;
  }
  wanted.lastKnown = { x, z };
  wanted.searchZone = { x, z, radius: SEARCH_RADIUS[next] };
  wanted.seenTimer = 0;
  wanted.clearTimer = 0;
  wanted.crime = { kind, time };
  return true;
}

/**
 * Witness phone calls that finished: the ped told dispatch, dispatch told
 * the units — one retell, so the description degrades once. A call the
 * player interrupted never arrives. `peds` is the peds sim state.
 */
export function processWitnessCalls(wanted, peds, time, rng) {
  let reported = false;
  for (const ped of peds.list) {
    if (!ped.call || time < ped.call.endsAt) continue;
    const call = ped.call;
    ped.call = null;
    const degraded = degradeDescription(call.description, call.quality, rng);
    reportCrime(wanted, call.kind, ped.x, ped.z, degraded.description, time);
    wanted.quality = degraded.quality;
    reported = true;
  }
  return reported;
}

/** Segment (x1,z1)-(x2,z2) against one axis-aligned building box, in 2D. */
function segmentHitsBox(x1, z1, x2, z2, b) {
  const minX = b.x - b.w / 2;
  const maxX = b.x + b.w / 2;
  const minZ = b.z - b.d / 2;
  const maxZ = b.z + b.d / 2;
  const dx = x2 - x1;
  const dz = z2 - z1;
  let tmin = 0;
  let tmax = 1;
  for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dz, z1 - minZ], [dz, maxZ - z1]]) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) tmin = Math.max(tmin, t);
      else tmax = Math.min(tmax, t);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/** Line of sight between two points: clear unless a building stands between. */
export function hasLineOfSight(x1, z1, x2, z2, city, maxDist) {
  const dist = Math.hypot(x2 - x1, z2 - z1);
  if (dist > maxDist) return false;
  for (const b of city.buildings) {
    // Cheap reject: the box is nowhere near the segment's bounding box.
    if (Math.max(x1, x2) < b.x - b.w / 2 || Math.min(x1, x2) > b.x + b.w / 2) continue;
    if (Math.max(z1, z2) < b.z - b.d / 2 || Math.min(z1, z2) > b.z + b.d / 2) continue;
    if (segmentHitsBox(x1, z1, x2, z2, b)) return false;
  }
  return true;
}

/** Does this police unit see the player right now (range + line of sight)? */
export function unitSeesPlayer(unit, player, city) {
  return hasLineOfSight(unit.x, unit.z, player.x, player.z, city, 70);
}

/**
 * One fixed step of the wanted state. `police` is the police sim state
 * (units with x/z), `heliWatching` is set by the helicopter. While anyone
 * sees the player the trail is hot; once sight is broken the search zone
 * stays where the player was last seen, and leaving it unseen for a few
 * seconds clears the level.
 */
export function updateWanted(wanted, player, police, heliWatching, city, dt) {
  if (wanted.stars === 0) {
    wanted.display = 'none';
    wanted.searchZone = null;
    wanted.lastKnown = null;
    return;
  }
  const seen = heliWatching || police.units.some((u) => u.state !== 'wrecked' && unitSeesPlayer(u, player, city));
  if (seen) {
    wanted.display = 'seen';
    wanted.lastKnown = { x: player.x, z: player.z };
    wanted.searchZone = { x: player.x, z: player.z, radius: SEARCH_RADIUS[wanted.stars] };
    wanted.seenTimer = 0;
    wanted.clearTimer = 0;
    return;
  }
  wanted.seenTimer += dt;
  // Near the scene: a unit close to the last-known spot turns the stars red.
  const nearScene = police.units.some((u) => {
    if (!wanted.lastKnown || u.state === 'wrecked') return false;
    return Math.hypot(u.x - wanted.lastKnown.x, u.z - wanted.lastKnown.z) < 25;
  });
  const known = wanted.description
    && (wanted.description.carColor || wanted.description.carModel
      || wanted.description.jacket || wanted.description.weapon);
  wanted.display = nearScene ? 'near' : known ? 'searching' : 'reported';
  // Outside the zone and unseen: the trail goes cold.
  const inZone = wanted.searchZone
    && Math.hypot(player.x - wanted.searchZone.x, player.z - wanted.searchZone.z) < wanted.searchZone.radius;
  if (!inZone && wanted.seenTimer > CLEAR_AFTER[wanted.stars]) {
    wanted.clearTimer += dt;
    if (wanted.clearTimer > 3) {
      wanted.stars = 0;
      wanted.display = 'none';
      wanted.description = null;
      wanted.quality = 1;
      wanted.lastKnown = null;
      wanted.searchZone = null;
      wanted.clearTimer = 0;
      wanted.seenTimer = 0;
      wanted.crime = null;
    }
  } else {
    wanted.clearTimer = 0;
  }
}

/**
 * Laundry: change the car, the jacket, the weapon or the plates, and the
 * police lose that part of the description. While AIR-1 watches, none of it
 * works — the helicopter is the hard counter to description-escape. When
 * every field is gone, the police have nothing to hunt and the level clears.
 */
export function applyLaundry(wanted, what) {
  if (wanted.heliWatching) return { ok: false, reason: 'AIR-1 di atas — ganti mobil/pakaian tidak berguna' };
  if (wanted.stars === 0 || !wanted.description) return { ok: false, reason: 'Tidak ada yang dicari' };
  if (what === 'car' || what === 'plates') {
    wanted.description.carColor = null;
    wanted.description.carModel = null;
  } else if (what === 'jacket') {
    wanted.description.jacket = null;
  } else if (what === 'weapon') {
    wanted.description.weapon = null;
  } else {
    return { ok: false, reason: 'Tidak dikenal' };
  }
  const left = wanted.description.carColor || wanted.description.carModel
    || wanted.description.jacket || wanted.description.weapon;
  if (!left) {
    wanted.stars = 0;
    wanted.display = 'none';
    wanted.description = null;
    wanted.quality = 1;
    wanted.lastKnown = null;
    wanted.searchZone = null;
    wanted.crime = null;
    return { ok: true, cleared: true };
  }
  return { ok: true, cleared: false };
}

/** A witness within arm's reach drops the phone: the call never arrives. */
export function callInterruptDistance() {
  return CALL_INTERRUPT_DIST;
}
