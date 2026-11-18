// Collision for the hero car: buildings, parked cars and containers are
// axis-aligned boxes; palms and lamps are points. The car is two circles
// (front + rear axle); a hit pushes the car out along the shallowest axis
// and strips the into-wall part of the velocity, so the car slides along a
// wall instead of sticking to it. Traffic cars are circles too — the player
// rams them (keeps its speed, shoves them aside) instead of stopping dead.
// The same file owns the soft turn-back: past the edge of the road network the car is
// steered gently back toward the nearest road, with a HUD prompt, instead of
// driving into the void.
// Pure sim — plain data in, plain data out. No three.js, no DOM.

import { STEP } from './config.js';

const TURN_BACK_PROMPT = 'KEMBALI KE JALAN — Dermaga Emas di belakangmu';
const TURN_BACK_DISTANCE = 25; // metres from the nearest road before the nudge
const TURN_BACK_RATE = 2; // rad/s the car is steered back toward the road
const OUT_OF_BOUNDS_SPEED = 12; // m/s cap while off the network

const CAR_CIRCLES = [
  { along: 1.2, radius: 1.15 },
  { along: -1.2, radius: 1.15 },
];
const TRAFFIC_RADIUS = 2.3; // a traffic car, as one circle, for the player

/** Push a circle out of an axis-aligned box. Null when clear. */
function circleBoxPush(cx, cz, radius, bx, bz, halfW, halfD) {
  const qx = Math.max(bx - halfW, Math.min(cx, bx + halfW));
  const qz = Math.max(bz - halfD, Math.min(cz, bz + halfD));
  const dx = cx - qx;
  const dz = cz - qz;
  const dist = Math.hypot(dx, dz);
  if (dist >= radius) return null;
  if (dist < 1e-6) {
    // The centre is inside the box: leave by the shallowest face.
    const px = halfW - Math.abs(cx - bx);
    const pz = halfD - Math.abs(cz - bz);
    if (px < pz) return { nx: cx >= bx ? 1 : -1, nz: 0, depth: px + radius };
    return { nx: 0, nz: cz >= bz ? 1 : -1, depth: pz + radius };
  }
  return { nx: dx / dist, nz: dz / dist, depth: radius - dist };
}

/** Push a circle out of a point obstacle (a palm trunk, a lamp pole). */
function circlePointPush(cx, cz, radius, px, pz, pr) {
  const dx = cx - px;
  const dz = cz - pz;
  const dist = Math.hypot(dx, dz);
  const min = radius + pr;
  if (dist >= min) return null;
  if (dist < 1e-6) return { nx: 1, nz: 0, depth: min };
  return { nx: dx / dist, nz: dz / dist, depth: min - dist };
}

/** Move the car out along a push normal and strip the into-wall velocity. */
function applyPush(car, push) {
  car.x += push.nx * push.depth;
  car.z += push.nz * push.depth;
  const vn = car.vx * push.nx + car.vz * push.nz;
  if (vn < 0) {
    car.vx -= push.nx * vn;
    car.vz -= push.nz * vn;
  }
  // Keep only the tangential share of the scalar speed: head-on is a stop,
  // a graze keeps almost all of it. That is the slide.
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const dot = fx * push.nx + fz * push.nz;
  car.speed *= Math.sqrt(Math.max(0, 1 - dot * dot));
  if (Math.abs(car.speed) < 0.05) car.speed = 0;
}

/** A parked car's box half-extents, from its heading (long axis along it). */
function parkedBox(p) {
  return Math.abs(Math.sin(p.heading)) > 0.5
    ? { halfW: 2.1, halfD: 0.95 }
    : { halfW: 0.95, halfD: 2.1 };
}

/**
 * Resolve the hero car against every solid thing in the city. Two passes:
 * the first push can expose a second contact. Returns true when anything hit.
 */
export function resolveCarCollision(car, city) {
  let hit = false;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const circle of CAR_CIRCLES) {
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const cx = car.x + fx * circle.along;
      const cz = car.z + fz * circle.along;
      for (const b of city.buildings) {
        if (Math.abs(b.x - cx) > b.w / 2 + 3 || Math.abs(b.z - cz) > b.d / 2 + 3) continue;
        const push = circleBoxPush(cx, cz, circle.radius, b.x, b.z, b.w / 2, b.d / 2);
        if (push) { applyPush(car, push); hit = true; }
      }
      for (const c of city.containers) {
        if (Math.abs(c.x - cx) > c.w / 2 + 3 || Math.abs(c.z - cz) > c.d / 2 + 3) continue;
        const push = circleBoxPush(cx, cz, circle.radius, c.x, c.z, c.w / 2, c.d / 2);
        if (push) { applyPush(car, push); hit = true; }
      }
      for (const p of city.parkedCars) {
        const box = parkedBox(p);
        if (Math.abs(p.x - cx) > box.halfW + 3 || Math.abs(p.z - cz) > box.halfD + 3) continue;
        const push = circleBoxPush(cx, cz, circle.radius, p.x, p.z, box.halfW, box.halfD);
        if (push) { applyPush(car, push); hit = true; }
      }
      for (const p of city.palms) {
        if (Math.abs(p.x - cx) > 3 || Math.abs(p.z - cz) > 3) continue;
        const push = circlePointPush(cx, cz, circle.radius, p.x, p.z, 0.35);
        if (push) { applyPush(car, push); hit = true; }
      }
      for (const l of city.lamps) {
        if (Math.abs(l.x - cx) > 3 || Math.abs(l.z - cz) > 3) continue;
        const push = circlePointPush(cx, cz, circle.radius, l.x, l.z, 0.15);
        if (push) { applyPush(car, push); hit = true; }
      }
    }
  }
  return hit;
}

/** The player against traffic cars: the player is the ram — it keeps its
 *  speed and shoves the traffic car out of the way. Only the positions are
 *  corrected, never the player's speed: a head-on ram used to zero it (the
 *  wall rule), which left the player permanently stuck at 0 behind a car
 *  it had just hit. */
export function resolvePlayerTraffic(car, traffic) {
  for (const other of traffic.cars) {
    for (const circle of CAR_CIRCLES) {
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const cx = car.x + fx * circle.along;
      const cz = car.z + fz * circle.along;
      const dx = cx - other.x;
      const dz = cz - other.z;
      const min = circle.radius + TRAFFIC_RADIUS;
      const dist = Math.hypot(dx, dz);
      if (dist >= min || dist < 1e-6) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const depth = min - dist;
      car.x += nx * depth * 0.5;
      car.z += nz * depth * 0.5;
      other.x -= nx * depth * 0.5;
      other.z -= nz * depth * 0.5;
      other.speed *= 0.5;
    }
  }
}

function pointSegmentDistance(px, pz, s) {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - s.ax) * dx + (pz - s.az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = s.ax + dx * t;
  const qz = s.az + dz * t;
  return { dist: Math.hypot(px - qx, pz - qz), x: qx, z: qz };
}

/** The nearest point of the drivable world: the road graph, the pier, the island. */
export function nearestRoadPoint(city, x, z) {
  let best = { dist: Infinity, x, z };
  for (const s of city.segments) {
    const d = pointSegmentDistance(x, z, s);
    if (d.dist < best.dist) best = d;
  }
  const pier = city.pier;
  const px = Math.max(pier.x0, Math.min(x, pier.x1));
  const pz = Math.max(pier.z0, Math.min(z, pier.z1));
  const pd = Math.hypot(x - px, z - pz);
  if (pd < best.dist) best = { dist: pd, x: px, z: pz };
  const toIsland = Math.hypot(x - city.island.x, z - city.island.z);
  const id = toIsland - city.island.radius;
  if (id < best.dist) {
    if (id <= 0) return { dist: 0, x, z };
    const ux = (x - city.island.x) / toIsland;
    const uz = (z - city.island.z) / toIsland;
    best = { dist: id, x: city.island.x + ux * city.island.radius, z: city.island.z + uz * city.island.radius };
  }
  return best;
}

/**
 * The soft turn-back: past the edge of the road network, steer the heading
 * toward the nearest road point and ease the speed down, with a HUD prompt.
 * No teleport, no hard stop — the car curves back onto the roads itself.
 */
export function turnBackIfOutOfBounds(state) {
  const car = state.car;
  const near = nearestRoadPoint(state.city, car.x, car.z);
  if (near.dist <= TURN_BACK_DISTANCE) {
    if (state.prompt === TURN_BACK_PROMPT) state.prompt = '';
    return;
  }
  const want = Math.atan2(near.x - car.x, near.z - car.z);
  let diff = want - car.heading;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const turn = Math.max(-TURN_BACK_RATE * STEP, Math.min(TURN_BACK_RATE * STEP, diff));
  car.heading += turn;
  if (Math.abs(car.speed) > OUT_OF_BOUNDS_SPEED) {
    car.speed -= Math.sign(car.speed) * 20 * STEP;
  }
  state.prompt = TURN_BACK_PROMPT;
}
