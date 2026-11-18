// Pedestrians: walkers in groups of 2–4 on the sidewalks plus idlers with rotating
// activities, and the witness chain Day 3 builds on. A ped that sees a threat runs first
// and then stops to report (the phone call is Day 3); running sets `sawIt`, a description
// snapshot of what the ped saw. ~83% of peds react; the rest keep walking. Pure simulation,
// deterministic from the seed. The causeway and pier never carry peds.
import { PEDS } from './config.js';
import { createRandom, intRange, pick, range } from './random.js';
import { nearestSegment } from './city.js';

const CLOTHES = [0x7a6a8a, 0x4a6b7a, 0x8a7a5a, 0x5a7a5a, 0x9a9a9a, 0x6a5a7a, 0x7a5a4a, 0x3a5a6a];
const SKIN = [0xe8c39a, 0xc99a6a, 0x8a5a3a, 0xf2d5b0];
const ACTIVITIES = ['phone', 'smoking', 'leaning', 'window', 'map'];

function walkable(seg) {
  return seg.kind !== 'causeway' && seg.kind !== 'pier';
}

/** Where a sidewalk walker stands: the segment at `s`, on `side`, with a fixed jitter. */
function sidewalkPos(seg, side, s, lateral) {
  const dx = seg.b.x - seg.a.x;
  const dz = seg.b.z - seg.a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const t = s / len;
  return {
    x: seg.a.x + dx * t + nx * (side * PEDS.sidewalkOffset + lateral),
    z: seg.a.z + dz * t + nz * (side * PEDS.sidewalkOffset + lateral),
  };
}

function startFlee(ped, player, time) {
  const dx = ped.x - player.x;
  const dz = ped.z - player.z;
  const d = Math.hypot(dx, dz) || 1;
  ped.fleeX = dx / d;
  ped.fleeZ = dz / d;
  ped.state = 'flee';
  ped.fleeT = PEDS.fleeSeconds;
  ped.sawIt = { carColor: 'pink', carModel: 'KOMODO GT', at: time };
}

function isThreat(ped, player, playerSpeed) {
  if (!ped.reactive || ped.calmT > 0) return false;
  const d = Math.hypot(ped.x - player.x, ped.z - player.z);
  if (d < PEDS.fleeRadius) return true;
  return playerSpeed > PEDS.closingSpeed && d < PEDS.closingRadius;
}

export function createPeds(city, seed) {
  const random = createRandom(seed + 202);
  const walkSegs = city.segments.filter(walkable);
  const walkers = [];
  let group = 0;
  while (walkers.length < PEDS.walkers) {
    const size = Math.min(intRange(random, 2, 4), PEDS.walkers - walkers.length);
    const seg = pick(random, walkSegs);
    const side = random() < 0.5 ? 1 : -1;
    const dir = random() < 0.5 ? 1 : -1;
    const speed = range(random, 1.2, 1.5);
    const s0 = range(random, 12, seg.length - 12);
    for (let k = 0; k < size; k += 1) {
      const ped = {
        group,
        seg,
        side,
        s: s0 - k * 1.6 * dir,
        dir,
        speed: speed + range(random, -0.1, 0.1),
        lateral: range(random, -0.8, 0.8),
        x: 0,
        z: 0,
        heading: 0,
        reactive: random() < PEDS.reactiveShare,
        state: 'walk',
        fleeT: 0,
        reportT: 0,
        calmT: 0,
        fleeX: 0,
        fleeZ: 0,
        sawIt: null,
        color: pick(random, CLOTHES),
        skin: pick(random, SKIN),
      };
      const pos = sidewalkPos(seg, side, ped.s, ped.lateral);
      ped.x = pos.x;
      ped.z = pos.z;
      ped.heading = dir > 0 ? seg.angle : seg.angle + Math.PI;
      walkers.push(ped);
    }
    group += 1;
  }

  const idlers = [];
  for (let i = 0; i < PEDS.idlers; i += 1) {
    const seg = pick(random, walkSegs);
    const side = random() < 0.5 ? 1 : -1;
    const s = range(random, 8, seg.length - 8);
    const pos = sidewalkPos(seg, side, s, range(random, -0.8, 0.8));
    idlers.push({
      homeX: pos.x,
      homeZ: pos.z,
      x: pos.x,
      z: pos.z,
      heading: seg.angle + (random() < 0.5 ? 0 : Math.PI),
      activity: pick(random, ACTIVITIES),
      timer: range(random, 120, 240),
      reactive: random() < PEDS.reactiveShare,
      state: 'idle',
      fleeT: 0,
      reportT: 0,
      calmT: 0,
      fleeX: 0,
      fleeZ: 0,
      sawIt: null,
      color: pick(random, CLOTHES),
      skin: pick(random, SKIN),
    });
  }
  return { walkers, idlers, random };
}

/** Snap a walker back onto the nearest sidewalk after it ran off it. */
function resnapWalker(ped, city) {
  const near = nearestSegment(city, ped.x, ped.z);
  if (!near) return;
  const s = near.segment;
  const dx = s.b.x - s.a.x;
  const dz = s.b.z - s.a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const relX = ped.x - s.a.x;
  const relZ = ped.z - s.a.z;
  const lateral = relX * nx + relZ * nz;
  ped.seg = s;
  ped.side = lateral >= 0 ? 1 : -1;
  ped.s = Math.max(1, Math.min(len - 1, (relX * dx + relZ * dz) / len));
  ped.lateral = Math.max(-0.8, Math.min(0.8, Math.abs(lateral) - PEDS.sidewalkOffset));
  ped.dir = 1;
  ped.heading = s.angle;
}

/** One fixed step for every ped. `player` is {x, z, vx, vz}. `onReport`, when given, is
 * called with a ped whose phone call just got through — the witness files a report. */
export function stepPeds(peds, city, player, dt, time, onReport) {
  const playerSpeed = Math.hypot(player.vx, player.vz);

  for (const ped of peds.walkers) {
    if (ped.calmT > 0) ped.calmT -= dt;
    if (ped.state === 'walk' && isThreat(ped, player, playerSpeed)) startFlee(ped, player, time);

    if (ped.state === 'walk') {
      ped.s += ped.dir * ped.speed * dt;
      if (ped.s >= ped.seg.length - 1 || ped.s <= 1) {
        // At the end of the street: turn onto a connected walkable segment.
        const node = ped.s >= ped.seg.length - 1 ? ped.seg.b : ped.seg.a;
        const options = city.segments.filter((s) => s !== ped.seg && walkable(s) && (s.a === node || s.b === node));
        if (options.length > 0) {
          const next = options[Math.floor(peds.random() * options.length)];
          ped.seg = next;
          ped.side = peds.random() < 0.5 ? 1 : -1;
          ped.dir = next.a === node ? 1 : -1;
          ped.s = ped.dir > 0 ? 1 : next.length - 1;
        } else {
          ped.dir = -ped.dir;
          ped.s = Math.max(1, Math.min(ped.seg.length - 1, ped.s));
        }
      }
      const pos = sidewalkPos(ped.seg, ped.side, ped.s, ped.lateral);
      ped.x = pos.x;
      ped.z = pos.z;
      ped.heading = ped.dir > 0 ? ped.seg.angle : ped.seg.angle + Math.PI;
    } else if (ped.state === 'flee') {
      ped.x += ped.fleeX * PEDS.fleeSpeed * dt;
      ped.z += ped.fleeZ * PEDS.fleeSpeed * dt;
      ped.heading = Math.atan2(ped.fleeX, ped.fleeZ);
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) {
        ped.state = 'report';
        ped.reportT = PEDS.reportSeconds;
      }
    } else if (ped.state === 'report') {
      ped.reportT -= dt;
      if (ped.reportT <= 0) {
        // The call got through: the witness files a report (Day 3 hook).
        if (onReport) onReport(ped);
        ped.state = 'walk';
        ped.calmT = PEDS.calmSeconds;
        resnapWalker(ped, city);
      }
    }
  }

  for (const ped of peds.idlers) {
    if (ped.calmT > 0) ped.calmT -= dt;
    if (ped.state === 'idle' && isThreat(ped, player, playerSpeed)) {
      // An idler flees only when the car is very close — it was standing still.
      const d = Math.hypot(ped.x - player.x, ped.z - player.z);
      if (d < 6) startFlee(ped, player, time);
    }

    if (ped.state === 'idle') {
      ped.timer -= dt;
      if (ped.timer <= 0) {
        ped.activity = ACTIVITIES[Math.floor(peds.random() * ACTIVITIES.length)];
        ped.timer = 120 + peds.random() * 120;
      }
    } else if (ped.state === 'flee') {
      ped.x += ped.fleeX * PEDS.fleeSpeed * dt;
      ped.z += ped.fleeZ * PEDS.fleeSpeed * dt;
      ped.heading = Math.atan2(ped.fleeX, ped.fleeZ);
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) {
        ped.state = 'report';
        ped.reportT = PEDS.reportSeconds;
      }
    } else if (ped.state === 'report') {
      ped.reportT -= dt;
      if (ped.reportT <= 0) {
        if (onReport) onReport(ped);
        ped.state = 'return';
      }
    } else if (ped.state === 'return') {
      const dx = ped.homeX - ped.x;
      const dz = ped.homeZ - ped.z;
      const d = Math.hypot(dx, dz);
      if (d < 1) {
        ped.state = 'idle';
        ped.calmT = PEDS.calmSeconds;
      } else {
        ped.x += (dx / d) * PEDS.walkSpeed * dt;
        ped.z += (dz / d) * PEDS.walkSpeed * dt;
        ped.heading = Math.atan2(dx, dz);
      }
    }
  }
}

/**
 * Day 3 hook: a witnessed event (theft, gunshot, ...) within `radius` of (x, z) makes
 * every reactive ped nearby flee with a description snapshot. Returns how many fled.
 */
export function witnessEvent(peds, x, z, radius, description, time) {
  let count = 0;
  const all = peds.walkers.concat(peds.idlers);
  for (const ped of all) {
    if (!ped.reactive || ped.calmT > 0) continue;
    if (ped.state !== 'walk' && ped.state !== 'idle') continue;
    if (Math.hypot(ped.x - x, ped.z - z) > radius) continue;
    const dx = ped.x - x;
    const dz = ped.z - z;
    const d = Math.hypot(dx, dz) || 1;
    ped.fleeX = dx / d;
    ped.fleeZ = dz / d;
    ped.state = 'flee';
    ped.fleeT = PEDS.fleeSeconds;
    ped.sawIt = { ...description, at: time || 0 };
    count += 1;
  }
  return count;
}
