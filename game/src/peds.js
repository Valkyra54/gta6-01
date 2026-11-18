// Pedestrians: groups of 2–4 walking the sidewalks, a few standing idle
// (phone, smoking, leaning, window-shopping) with an activity that rotates
// every few minutes. They flee from the hero car; a fleeing ped remembers
// what it saw — the "saw it" flag Day 3's wanted system reads. No wanted
// logic lives here: this file only walks, idles, flees and remembers.

import { chance, createRandom, pick, range, rangeInt } from './random.js';

const WALKERS = 36;
const IDLERS = 10;
const SIDEWALK = 8.5; // metres from a road centreline to the walking line
const FLEE_SPEED = 3.5;
const FLEE_RADIUS = 8;
const FLEE_TIME = 2.5;
const SHIRTS = ['#E8E4DA', '#7FB3D5', '#D9A441', '#C96F4A', '#8FAE8B', '#F2A7B8', '#5B7A99', '#E8B4C8', '#FFF3E0', '#9FD8CF'];
const SKINS = ['#E8B48C', '#C98A6B', '#8A5A3B'];
const ACTIVITIES = ['phone', 'smoking', 'leaning', 'window-shopping'];

/** The sidewalk point on a segment, `d` metres along it, on `side` (+1/-1). */
function sidewalkPoint(seg, side, d) {
  const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
  const dx = (seg.bx - seg.ax) / len;
  const dz = (seg.bz - seg.az) / len;
  const rx = -dz;
  const rz = dx;
  return {
    x: seg.ax + dx * d + rx * side * SIDEWALK,
    z: seg.az + dz * d + rz * side * SIDEWALK,
    heading: Math.atan2(dx, dz),
    rx,
    rz,
  };
}

function makePed(random, city, segIndex, side, d, speed, forward, kind) {
  const seg = city.segments[segIndex];
  const point = sidewalkPoint(seg, side, d);
  const lateral = range(random, -1, 1);
  const activity = pick(random, ACTIVITIES);
  // Idle peds face something: the building when window-shopping, the road
  // otherwise. Walkers face where they are going.
  const heading = kind === 'idle'
    ? (activity === 'window-shopping'
      ? Math.atan2(point.rx * side, point.rz * side)
      : Math.atan2(-point.rx * side, -point.rz * side))
    : (forward ? point.heading : point.heading + Math.PI);
  return {
    kind,
    seg: segIndex,
    side,
    d,
    speed,
    forward,
    lateral,
    x: point.x + point.rx * lateral,
    z: point.z + point.rz * lateral,
    heading,
    bob: range(random, 0, Math.PI * 2),
    color: pick(random, SHIRTS),
    skin: pick(random, SKINS),
    reactive: chance(random, 0.83), // ~80–85% react; some keep walking
    activity,
    activityTimer: range(random, 120, 240),
    fleeTimer: 0,
    // Waypoint a walker heads for when it turns a corner: the sidewalk
    // corner, so it never cuts across the junction through the road.
    via: null,
    sawIt: null,
    // A witness phone call in progress: { kind, description, endsAt, quality }.
    // The ped stands still with the phone until it ends (the report lands) or
    // the player gets close enough to interrupt it. Day 3 owns the call.
    call: null,
    rng: createRandom(Math.floor(random() * 2147483647)),
  };
}

/** Spawn the peds: walking groups on the sidewalks, a few standing idle. */
export function createPeds(city, seed) {
  const random = createRandom(seed ^ 0x9e37);
  const list = [];
  let guard = 0;
  while (list.length < WALKERS && guard < 200) {
    guard += 1;
    const segIndex = Math.floor(random() * city.segments.length);
    const seg = city.segments[segIndex];
    // Peds never walk the causeway to the island: it is a car bridge, and
    // its "sidewalk" would hang over the water.
    if (segmentLength(seg) > 100) continue;
    const side = chance(random, 0.5) ? 1 : -1;
    const groupSize = rangeInt(random, 2, 4);
    const d = range(random, 6, Math.max(7, segmentLength(seg) - 6));
    const speed = range(random, 1.0, 1.5);
    const forward = chance(random, 0.5);
    for (let k = 0; k < groupSize && list.length < WALKERS; k += 1) {
      list.push(makePed(random, city, segIndex, side, d + range(random, -1.5, 1.5), speed, forward, 'walk'));
    }
  }
  while (list.length < WALKERS + IDLERS && guard < 400) {
    guard += 1;
    const segIndex = Math.floor(random() * city.segments.length);
    const seg = city.segments[segIndex];
    if (segmentLength(seg) > 100) continue;
    const side = chance(random, 0.5) ? 1 : -1;
    const d = range(random, 8, Math.max(9, segmentLength(seg) - 8));
    list.push(makePed(random, city, segIndex, side, d, 0, true, 'idle'));
  }
  return { list };
}

function segmentLength(seg) {
  return Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
}

/** A new segment at a node: any segment touching it, not the one we came from. */
function pickNextSegment(city, ped, node) {
  const candidates = [];
  city.segments.forEach((s, i) => {
    if (i === ped.seg) return;
    // Never turn onto the causeway (see createPeds).
    if (segmentLength(s) > 100) return;
    const touchesStart = Math.abs(s.ax - node.x) < 1 && Math.abs(s.az - node.z) < 1;
    const touchesEnd = Math.abs(s.bx - node.x) < 1 && Math.abs(s.bz - node.z) < 1;
    if (touchesStart || touchesEnd) candidates.push({ index: i, atStart: touchesStart });
  });
  if (candidates.length === 0) return { index: ped.seg, atStart: true };
  return candidates[Math.floor(ped.rng() * candidates.length)];
}

/**
 * A witness event: every reactive ped within `radius` remembers what it saw
 * AND starts a phone call to dispatch (3–5 s, interruptible). Day 3's wanted
 * system reads the call when it completes; the description degrades when
 * retold — that is Day 3's job; here it is recorded verbatim.
 */
export function witnessEvent(peds, kind, x, z, radius, description, time) {
  for (const ped of peds.list) {
    if (!ped.reactive) continue;
    if (Math.hypot(ped.x - x, ped.z - z) > radius) continue;
    ped.sawIt = { kind, description: { ...description }, time };
    ped.call = {
      kind,
      description: { ...description },
      endsAt: time + 3 + ped.rng() * 2,
      quality: 1,
    };
  }
}

function stepPed(ped, city, player, dt, time) {
  // --- Flee: the hero car is close, or closing fast. ---
  const dx = ped.x - player.x;
  const dz = ped.z - player.z;
  const dist = Math.hypot(dx, dz);
  const playerSpeed = Math.hypot(player.vx, player.vz);
  // --- On a witness call: stand still with the phone. Close enough and the
  // player interrupts it — the ped drops the phone and runs, and the report
  // never arrives. ---
  if (ped.call) {
    if (dist < 2.5) {
      ped.call = null;
      ped.fleeTimer = FLEE_TIME;
    } else {
      ped.bob += dt * 0.5;
      return;
    }
  }
  const closing = dist < 14 && playerSpeed > 12
    && (player.vx * dx + player.vz * dz) / (playerSpeed * Math.max(dist, 0.01)) < -0.7;
  if (ped.reactive && ped.fleeTimer <= 0 && (dist < FLEE_RADIUS || closing)) {
    ped.fleeTimer = FLEE_TIME;
    // A fleeing ped drops the phone: no call, only the memory of what it saw.
    ped.call = null;
    ped.sawIt = {
      kind: 'reckless-driving',
      description: { carColor: 'pink', carModel: 'KOMODO GT', jacket: null, weapon: null },
      time,
    };
  }
  if (ped.fleeTimer > 0) {
    ped.fleeTimer -= dt;
    const away = dist > 0.01 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 1 };
    ped.x += away.x * FLEE_SPEED * dt;
    ped.z += away.z * FLEE_SPEED * dt;
    ped.heading = Math.atan2(away.x, away.z);
    ped.bob += FLEE_SPEED * dt * 2.4;
    return;
  }
  if (ped.kind === 'idle') {
    ped.activityTimer -= dt;
    if (ped.activityTimer <= 0) {
      ped.activity = ACTIVITIES[Math.floor(ped.rng() * ACTIVITIES.length)];
      ped.activityTimer = range(ped.rng(), 120, 240);
    }
    ped.bob += dt * 0.5;
    return;
  }
  // --- Walk: follow the sidewalk, turn at the segment's end. ---
  // While a corner waypoint is pending the ped walks to it and does not
  // advance along the new segment, so it can never cut the junction.
  const seg = city.segments[ped.seg];
  const len = segmentLength(seg);
  if (!ped.via) {
    ped.d += (ped.forward ? 1 : -1) * ped.speed * dt;
    if (ped.d > len - 2 || ped.d < 2) {
      const node = ped.d > len - 2 ? { x: seg.bx, z: seg.bz } : { x: seg.ax, z: seg.az };
      const next = pickNextSegment(city, ped, node);
      const oldIndex = ped.seg;
      const oldSide = ped.side;
      // The side relative to the walking direction (not the segment's
      // stored direction): keep it through the turn, so the ped never
      // crosses the street to change sidewalks.
      const walkSide = ped.forward ? ped.side : -ped.side;
      ped.seg = next.index;
      const nextSeg = city.segments[next.index];
      const nextLen = segmentLength(nextSeg);
      ped.forward = next.atStart;
      ped.d = next.atStart ? 2 : nextLen - 2;
      ped.side = ped.forward ? walkSide : -walkSide;
      // Turning onto a perpendicular street: walk the sidewalk corner
      // first (the point 8.5 m off both centrelines on our side), instead
      // of cutting straight across the junction through the road.
      const dirOld = { x: (seg.bx - seg.ax) / len, z: (seg.bz - seg.az) / len };
      const dirNew = { x: (nextSeg.bx - nextSeg.ax) / nextLen, z: (nextSeg.bz - nextSeg.az) / nextLen };
      const dot = dirOld.x * dirNew.x + dirOld.z * dirNew.z;
      if (next.index !== oldIndex && Math.abs(dot) < 0.5) {
        const rOld = { x: -dirOld.z, z: dirOld.x };
        const rNew = { x: -dirNew.z, z: dirNew.x };
        ped.via = {
          x: node.x + rOld.x * oldSide * SIDEWALK + rNew.x * ped.side * SIDEWALK,
          z: node.z + rOld.z * oldSide * SIDEWALK + rNew.z * ped.side * SIDEWALK,
        };
      } else {
        ped.via = null;
      }
    }
  }
  let tx;
  let tz;
  if (ped.via) {
    tx = ped.via.x;
    tz = ped.via.z;
    if (Math.hypot(tx - ped.x, tz - ped.z) < 0.6) {
      // Corner reached: resume along the new segment from where we are.
      ped.via = null;
      const ns = city.segments[ped.seg];
      const nlen = segmentLength(ns);
      const ndx = (ns.bx - ns.ax) / nlen;
      const ndz = (ns.bz - ns.az) / nlen;
      ped.d = Math.max(2, Math.min(nlen - 2, (ped.x - ns.ax) * ndx + (ped.z - ns.az) * ndz));
    }
  }
  if (!ped.via) {
    const point = sidewalkPoint(city.segments[ped.seg], ped.side, ped.d);
    tx = point.x + point.rx * ped.lateral;
    tz = point.z + point.rz * ped.lateral;
  }
  const mx = tx - ped.x;
  const mz = tz - ped.z;
  const md = Math.hypot(mx, mz);
  const step = Math.min(md, ped.speed * dt * 1.6);
  if (md > 0.01) {
    ped.x += (mx / md) * step;
    ped.z += (mz / md) * step;
    ped.heading = Math.atan2(mx, mz);
    ped.bob += step * 2.2;
  }
  // Lamp poles and palm trunks stand on the sidewalk: step around them.
  for (const l of city.lamps) {
    const lx = ped.x - l.x;
    const lz = ped.z - l.z;
    const ld = Math.hypot(lx, lz);
    if (ld < 0.6 && ld > 0.01) {
      ped.x = l.x + (lx / ld) * 0.6;
      ped.z = l.z + (lz / ld) * 0.6;
    }
  }
  for (const p of city.palms) {
    const px = ped.x - p.x;
    const pz = ped.z - p.z;
    const pd = Math.hypot(px, pz);
    if (pd < 0.7 && pd > 0.01) {
      ped.x = p.x + (px / pd) * 0.7;
      ped.z = p.z + (pz / pd) * 0.7;
    }
  }
  // The hero car never runs a ped over: push the ped clear of it.
  if (dist < 1.6 && dist > 0.01) {
    ped.x = player.x + (dx / dist) * 1.6;
    ped.z = player.z + (dz / dist) * 1.6;
  }
}

/** One fixed step of pedestrians. */
export function stepPeds(peds, city, player, dt, time) {
  for (const ped of peds.list) stepPed(ped, city, player, dt, time);
}
