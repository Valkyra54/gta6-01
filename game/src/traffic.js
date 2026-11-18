// Traffic: 20 cars on the road graph, pure simulation. Each car follows a lane (a line
// resampled per metre), picks the straightest connected lane at each junction, and follows
// the car ahead with the Intelligent Driver Model — never overlapping. Traffic lights stop
// cars at stop lines per signal group; the player car counts as a solid leader, so traffic
// brakes early and queues behind the player. Deterministic: every choice comes from the
// seeded generator, no wall-clock, no unseeded Math.random().
import { PALETTE, PLAYER_START, TRAFFIC } from './config.js';
import { createRandom, pick } from './random.js';

export const TRAFFIC_COUNT = TRAFFIC.count;

/** The player's collision radius, for the gap to a player acting as a leader. */
const CAR_RADIUS = 1.6;

/** Which phase a movement belongs to: avenues (north-south) run phase A, streets phase B. */
function phaseOf(segment) {
  const dx = Math.abs(segment.b.x - segment.a.x);
  const dz = Math.abs(segment.b.z - segment.a.z);
  return dx > dz ? 'B' : 'A';
}

/**
 * The light state for one approach at one moment. The 22 s cycle is two 11 s phases:
 * phase A green [0,8), yellow [8,10), red [10,22); phase B green [11,19), yellow
 * [19,21), red otherwise. `offset` staggers the cycle per junction, seeded.
 */
export function lightState(offset, phase, time) {
  const t = (((time + offset) % TRAFFIC.lightCycle) + TRAFFIC.lightCycle) % TRAFFIC.lightCycle;
  if (phase === 'A') {
    if (t < TRAFFIC.green) return 'green';
    if (t < TRAFFIC.green + TRAFFIC.yellow) return 'yellow';
    return 'red';
  }
  if (t >= TRAFFIC.green + TRAFFIC.yellow + TRAFFIC.allRed && t < TRAFFIC.green + TRAFFIC.yellow + TRAFFIC.allRed + TRAFFIC.green) return 'green';
  if (t >= TRAFFIC.green + TRAFFIC.yellow + TRAFFIC.allRed + TRAFFIC.green && t < TRAFFIC.green + TRAFFIC.yellow + TRAFFIC.allRed + TRAFFIC.green + TRAFFIC.yellow) return 'yellow';
  return 'red';
}

function laneStart(lane, forward) {
  return forward ? { x: lane.x1, z: lane.z1 } : { x: lane.x2, z: lane.z2 };
}

function laneDir(lane, forward) {
  const dx = lane.x2 - lane.x1;
  const dz = lane.z2 - lane.z1;
  const len = Math.hypot(dx, dz) || 1;
  return forward ? { x: dx / len, z: dz / len } : { x: -dx / len, z: -dz / len };
}

/** Place the car's x/z/heading from its lane position (called after every step). */
function placeCar(car) {
  const lane = car.seg.lanes[car.laneIndex];
  const start = laneStart(lane, car.forward);
  const dir = laneDir(lane, car.forward);
  // Right-hand traffic: lane 0 runs a->b, lane 1 runs b->a.
  const nx = -dir.z;
  const nz = dir.x;
  car.x = start.x + dir.x * car.s + nx * car.lateral;
  car.z = start.z + dir.z * car.s + nz * car.lateral;
  car.heading = Math.atan2(dir.x, dir.z);
}

/** Is this node a junction (somewhere a light is needed)? */
function isJunction(city, node) {
  let touching = 0;
  let orientations = 0;
  for (const s of city.segments) {
    if (s.a !== node && s.b !== node) continue;
    touching += 1;
    if (Math.abs(s.b.x - s.a.x) > Math.abs(s.b.z - s.a.z)) orientations |= 1;
    else orientations |= 2;
  }
  return touching >= 3 || orientations === 3;
}

export function createTraffic(city, seed) {
  const random = createRandom(seed + 101);
  // One seeded cycle offset per junction node.
  const signals = new Map();
  for (const n of city.nodes) {
    if (isJunction(city, n)) signals.set(n.id, random() * TRAFFIC.lightCycle);
  }

  const cars = [];
  const lanes = [];
  for (const s of city.segments) {
    lanes.push({ seg: s, laneIndex: 0, forward: true });
    lanes.push({ seg: s, laneIndex: 1, forward: false });
  }
  for (let i = 0; i < TRAFFIC.count; i += 1) {
    const slot = lanes[Math.floor(random() * lanes.length)];
    const lane = slot.seg.lanes[slot.laneIndex];
    const len = slot.seg.length;
    let s = 5 + random() * (len - 10);
    const car = {
      seg: slot.seg,
      laneIndex: slot.laneIndex,
      forward: slot.forward,
      s,
      speed: 0,
      color: pick(random, PALETTE.parked),
      knockX: 0,
      knockZ: 0,
      lateral: 0,
      x: 0,
      z: 0,
      heading: 0,
    };
    placeCar(car);
    // Spawn safety: never drop a car on top of the player start; shift it back along
    // its lane instead.
    if (Math.hypot(car.x - PLAYER_START.x, car.z - PLAYER_START.z) < 12) {
      car.s = Math.max(2, car.s - 20);
      placeCar(car);
    }
    cars.push(car);
  }
  return { cars, signals, random };
}

/** The nearest leader ahead of `car` on its lane: a car, the player, or a red stop line. */
function findLeader(traffic, city, car, player, time) {
  const lane = car.seg.lanes[car.laneIndex];
  const start = laneStart(lane, car.forward);
  const dir = laneDir(lane, car.forward);
  const len = car.seg.length;
  let best = null;

  function consider(gap, speed) {
    if (gap === null || gap < 0) return;
    if (!best || gap < best.gap) best = { gap, speed };
  }

  // Cars ahead on the same lane, same direction.
  for (const other of traffic.cars) {
    if (other === car || other.seg !== car.seg || other.laneIndex !== car.laneIndex || other.forward !== car.forward) continue;
    if (other.s <= car.s) continue;
    consider(other.s - TRAFFIC.carLength / 2 - (car.s + TRAFFIC.carLength / 2), other.speed);
  }

  // The player, projected onto this lane: a solid obstacle with its real outline.
  const px = player.x - start.x;
  const pz = player.z - start.z;
  const t = px * dir.x + pz * dir.z;
  const lateral = -px * dir.z + pz * dir.x;
  if (t > 0 && t < len && Math.abs(lateral) < 3.5 && t > car.s) {
    const playerSpeed = Math.max(0, player.vx * dir.x + player.vz * dir.z);
    consider(t - CAR_RADIUS - (car.s + TRAFFIC.carLength / 2), playerSpeed);
  }

  // Yield to the player at the junction ahead: if the player is crossing the node this
  // car is driving toward, the car brakes for the node itself.
  const endNode = car.forward ? car.seg.b : car.seg.a;
  const endX = endNode.x;
  const endZ = endNode.z;
  const remaining = len - car.s;
  if (remaining < 30 && Math.hypot(player.x - endX, player.z - endZ) < 9) {
    consider(len - (car.s + TRAFFIC.carLength / 2), 0);
  }

  // The stop line at a junction: red means stop, yellow means stop unless already
  // committed (within 10 m and moving faster than 6 m/s — the dilemma zone).
  const nodeId = endNode.id;
  if (traffic.signals.has(nodeId)) {
    const state = lightState(traffic.signals.get(nodeId), phaseOf(car.seg), time);
    const stopS = len - TRAFFIC.stopLine;
    const gapToLine = stopS - (car.s + TRAFFIC.carLength / 2);
    if (state === 'red' && gapToLine > 0) consider(gapToLine, 0);
    else if (state === 'yellow' && gapToLine > 0) {
      const committed = gapToLine < 10 && car.speed > 6;
      if (!committed) consider(gapToLine, 0);
    }
  }

  return best;
}

/** Pick the next lane at a junction: the connected lane closest to the current heading. */
function nextLane(traffic, city, car) {
  const node = car.forward ? car.seg.b : car.seg.a;
  const dir = laneDir(car.seg.lanes[car.laneIndex], car.forward);
  let best = null;
  let bestDot = -2;
  for (const s of city.segments) {
    if (s === car.seg) continue;
    let forward;
    if (s.a === node) forward = true;
    else if (s.b === node) forward = false;
    else continue;
    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      if ((laneIndex === 0) !== forward) continue; // right-hand traffic: lane 0 a->b, lane 1 b->a
      const d = laneDir(s.lanes[laneIndex], forward);
      const dot = d.x * dir.x + d.z * dir.z;
      if (dot > bestDot + 1e-9) {
        bestDot = dot;
        best = { seg: s, laneIndex, forward };
      }
    }
  }
  return best;
}

/** One fixed step for every traffic car. `player` is {x, z, vx, vz}. */
export function stepTraffic(traffic, city, player, dt, time) {
  for (const car of traffic.cars) {
    const len = car.seg.length;
    const remaining = len - car.s;
    let v0 = TRAFFIC.cruise;
    if (remaining < TRAFFIC.nearEndDist) v0 = Math.min(v0, TRAFFIC.cruiseNearEnd);

    const leader = findLeader(traffic, city, car, player, time);
    let acc;
    if (!leader) {
      acc = TRAFFIC.accel * (1 - Math.pow(car.speed / v0, 4));
    } else {
      const dv = car.speed - leader.speed;
      const gap = Math.max(leader.gap, 0.1);
      const sStar = TRAFFIC.minGap + car.speed * TRAFFIC.timeHeadway
        + (car.speed * dv) / (2 * Math.sqrt(TRAFFIC.accel * TRAFFIC.brake));
      acc = TRAFFIC.accel * (1 - Math.pow(car.speed / v0, 4) - Math.pow(sStar / gap, 2));
    }
    acc = Math.max(-TRAFFIC.brake * 2, Math.min(TRAFFIC.accel, acc));
    car.speed = Math.max(0, car.speed + acc * dt);
    car.s += car.speed * dt;

    // Steer around a parked car: shift half a metre away from the kerb while passing it.
    let targetLateral = 0;
    const lane = car.seg.lanes[car.laneIndex];
    const start = laneStart(lane, car.forward);
    const dir = laneDir(lane, car.forward);
    for (const p of city.parked) {
      const px = p.x - start.x;
      const pz = p.z - start.z;
      const t = px * dir.x + pz * dir.z;
      if (t < car.s || t > car.s + 14) continue;
      const lat = -px * dir.z + pz * dir.x;
      if (Math.abs(lat) < 3.2) targetLateral = lat > 0 ? -0.6 : 0.6;
    }
    car.lateral += (targetLateral - car.lateral) * Math.min(1, 2 * dt);

    if (car.s >= len) {
      const next = nextLane(traffic, city, car);
      if (next) {
        // Entry gate: do not pull onto a lane whose entry is still occupied — two cars
        // arriving at one junction at once must queue, not overlap.
        const blocked = traffic.cars.some((other) => other !== car && other.seg === next.seg
          && other.laneIndex === next.laneIndex && other.forward === next.forward && other.s < 6);
        if (blocked) {
          car.s = len;
          car.speed = 0;
        } else {
          car.seg = next.seg;
          car.laneIndex = next.laneIndex;
          car.forward = next.forward;
          car.s = Math.max(0, car.s - len);
        }
      } else {
        // Dead end (pier, island): U-turn onto the other lane, but only if its entry
        // is clear — a car coming back the other way has the right of way.
        const blocked = traffic.cars.some((other) => other !== car && other.seg === car.seg
          && other.laneIndex === 1 - car.laneIndex && other.forward === !car.forward && other.s < 6);
        if (blocked) {
          car.s = len;
          car.speed = 0;
        } else {
          car.forward = !car.forward;
          car.laneIndex = 1 - car.laneIndex;
          car.s = Math.max(0, len - car.s);
        }
      }
    }
    placeCar(car);
    // The knock is applied on top of the lane position, so re-add it after placing.
    if (car.knockX !== 0 || car.knockZ !== 0) {
      car.x += car.knockX * dt;
      car.z += car.knockZ * dt;
    }
  }
}
