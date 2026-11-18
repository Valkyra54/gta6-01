// Traffic: lane-following cars on the road graph. Pure sim — plain data,
// seeded RNG, fixed steps. A car steers by pure pursuit toward a lookahead
// point on its lane, follows the car ahead with an Intelligent Driver Model
// gap (the gap grows with speed, cars never overlap), stops at red lights,
// treats the player car as a solid obstacle, and steers around parked cars.
// At a lane's end it picks a successor lane at the junction; the island is a
// dead end, so a car there turns back down the causeway.

import { createRandom, pick, range } from './random.js';

const TRAFFIC_COUNT = 20;
const CAR_HALF = 2.1; // half the length of a car, metres
const LOOKAHEAD = 8; // metres ahead on the lane the car steers toward
const MAX_TURN = 2.4; // rad/s, the steering rate of a traffic car
const LIGHT_CYCLE = 22; // seconds: 8 green, 2 yellow, 1 all-red, then the same for the cross street
const STOP_LINE = 11; // metres before a lane's end the stop line sits
const TRAFFIC_COLORS = ['#E8E4DA', '#7FB3D5', '#D9A441', '#5B7A99', '#C96F4A', '#8FAE8B', '#C0C4C8', '#A8544A'];
const IDM = { a: 2.5, b: 3, t: 1.2, s0: 3 };

function laneLength(lane) {
  return Math.hypot(lane.ex - lane.sx, lane.ez - lane.sz);
}

function laneDir(lane) {
  const len = laneLength(lane);
  return { x: (lane.ex - lane.sx) / len, z: (lane.ez - lane.sz) / len };
}

function lanePoint(lane, s) {
  const d = laneDir(lane);
  return { x: lane.sx + d.x * s, z: lane.sz + d.z * s };
}

/** A point's distance along a lane and its lateral offset from it. */
function projectOnLane(x, z, lane) {
  const d = laneDir(lane);
  return {
    s: (x - lane.sx) * d.x + (z - lane.sz) * d.z,
    lateral: (x - lane.sx) * -d.z + (z - lane.sz) * d.x,
  };
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** The light state at a sim time: { ns, ew }, each 'green' | 'yellow' | 'red'. */
export function signalPhase(time, offset) {
  const t = (((time + offset) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  if (t < 8) return { ns: 'green', ew: 'red' };
  if (t < 10) return { ns: 'yellow', ew: 'red' };
  if (t < 11) return { ns: 'red', ew: 'red' };
  if (t < 19) return { ns: 'red', ew: 'green' };
  if (t < 21) return { ns: 'red', ew: 'yellow' };
  return { ns: 'red', ew: 'red' };
}

function lightForLaneEnd(city, lane) {
  if (!city.lights) return null;
  for (const light of city.lights) {
    if (Math.abs(light.x - lane.endNode.x) < 1 && Math.abs(light.z - lane.endNode.z) < 1) return light;
  }
  return null;
}

/** Spawn the traffic: spread over the lanes, never near the player's start. */
export function createTraffic(city, seed) {
  const random = createRandom(seed ^ 0x5eed);
  const cars = [];
  let guard = 0;
  while (cars.length < TRAFFIC_COUNT && guard < 400) {
    guard += 1;
    const laneIndex = Math.floor(random() * city.lanes.length);
    const lane = city.lanes[laneIndex];
    const len = laneLength(lane);
    const s = range(random, 4, len - 4);
    // Never spawn in the stop-line zone: a car there would already be past
    // the line when the light is red.
    if (s > len - 14) continue;
    const pos = lanePoint(lane, s);
    if (Math.hypot(pos.x - city.start.x, pos.z - city.start.z) < 20) continue;
    if (cars.some((c) => c.lane === laneIndex && Math.abs(c.s - s) < 10)) continue;
    cars.push({
      lane: laneIndex,
      s,
      x: pos.x,
      z: pos.z,
      heading: Math.atan2(lane.ex - lane.sx, lane.ez - lane.sz),
      speed: range(random, 4, 9),
      targetSpeed: range(random, 8, 13),
      lateral: 0,
      lateralTarget: 0,
      color: pick(random, TRAFFIC_COLORS),
      rng: createRandom(Math.floor(random() * 2147483647)),
    });
  }
  return { cars, rng: random };
}

/** Pick the next lane at a junction: the one that keeps the car moving forward. */
function pickSuccessor(car, city, lane) {
  const hx = Math.sin(car.heading);
  const hz = Math.cos(car.heading);
  const candidates = [];
  for (let i = 0; i < city.lanes.length; i += 1) {
    if (i === car.lane) continue;
    const next = city.lanes[i];
    if (Math.hypot(next.sx - lane.ex, next.sz - lane.ez) > 7) continue;
    const nd = laneDir(next);
    if (nd.x * hx + nd.z * hz > -0.3) candidates.push(i);
  }
  if (candidates.length > 0) return candidates[Math.floor(car.rng() * candidates.length)];
  // Dead end (the island): turn back down the same segment.
  return car.lane ^ 1;
}

function stepCar(car, traffic, city, player, dt, time) {
  const lane = city.lanes[car.lane];
  const len = laneLength(lane);
  const dir = laneDir(lane);
  // Re-sync the distance along the lane from the real position: no drift.
  car.s = Math.max(0, Math.min(len, projectOnLane(car.x, car.z, lane).s));

  // --- The leader: the nearest car ahead in my lane, the player, a red
  // stop line, or the player crossing my lane's end (a junction). ---
  // The stop line and the lane end are points, not cars, so their bumper
  // offset is one half-length instead of two.
  let leaderGap = Infinity;
  let leaderSpeed = 0;
  let leaderBumper = 2 * CAR_HALF;
  for (const other of traffic.cars) {
    if (other === car || other.lane !== car.lane) continue;
    const gap = other.s - car.s;
    if (gap > 0 && gap < leaderGap) {
      leaderGap = gap;
      leaderSpeed = other.speed;
      leaderBumper = 2 * CAR_HALF;
    }
  }
  const pp = projectOnLane(player.x, player.z, lane);
  if (pp.s > car.s && pp.s - car.s < 45 && Math.abs(pp.lateral) < 4.5) {
    const gap = pp.s - car.s;
    if (gap < leaderGap) {
      leaderGap = gap;
      leaderSpeed = Math.max(0, player.vx * dir.x + player.vz * dir.z);
      leaderBumper = 2 * CAR_HALF;
    }
  }
  // The player crossing the lane's end (a junction) is a leader at the
  // end: the car brakes and lets the player through instead of being
  // shoved aside by the player push-out when the player drives through.
  const endDx = player.x - lane.ex;
  const endDz = player.z - lane.ez;
  if (Math.hypot(endDx, endDz) < 10 && car.s > len - 25) {
    const gap = len - car.s;
    if (gap < leaderGap) {
      leaderGap = gap;
      leaderSpeed = 0;
      leaderBumper = CAR_HALF;
    }
  }
  // A red light is a stopped leader at the stop line. Yellow with no room
  // to stop is a legal run-through (dilemma zone); a car already past the
  // line clears the junction.
  const light = lightForLaneEnd(city, lane);
  if (light) {
    const phase = signalPhase(time, light.offset);
    const sig = lane.horizontal ? phase.ew : phase.ns;
    const distToLine = len - STOP_LINE - car.s;
    const mustStop = sig === 'red' || (sig === 'yellow' && distToLine > (car.speed * car.speed) / (2 * IDM.b) + 2);
    if (mustStop && distToLine > 0 && distToLine < 45 && distToLine < leaderGap) {
      leaderGap = distToLine;
      leaderSpeed = 0;
      leaderBumper = CAR_HALF;
    }
  }
  // --- Parked cars: steer around them (they sit at the lane's outer edge). ---
  let parkedAhead = false;
  for (const p of city.parkedCars) {
    const q = projectOnLane(p.x, p.z, lane);
    if (q.s > car.s && q.s - car.s < 22 && Math.abs(q.lateral) < 3.2) {
      parkedAhead = true;
      break;
    }
  }
  car.lateralTarget = parkedAhead ? -1.2 : 0;

  // --- Speed: IDM toward the leader, capped by the stop line. ---
  // Near a lane's end the car slows for the junction, so it can make the
  // turn instead of swinging wide into the oncoming lane.
  const cruise = (len - car.s < 14) ? Math.min(car.targetSpeed, 7) : car.targetSpeed;
  const gap = leaderGap - leaderBumper;
  const dv = car.speed - leaderSpeed;
  const sStar = IDM.s0 + car.speed * IDM.t + (car.speed * dv) / (2 * Math.sqrt(IDM.a * IDM.b));
  const free = 1 - Math.pow(car.speed / cruise, 4);
  const follow = Number.isFinite(leaderGap) ? -Math.pow(sStar / Math.max(gap, 0.5), 2) : 0;
  const accel = Math.max(-6, Math.min(2.5, IDM.a * (free + follow)));
  car.speed += accel * dt;
  car.speed = Math.max(0, Math.min(car.targetSpeed, car.speed));
  if (car.speed < 0.05) car.speed = 0;

  // --- Steering: pure pursuit toward a lookahead point on the lane. ---
  car.lateral += (car.lateralTarget - car.lateral) * Math.min(1, 2 * dt);
  const look = lanePoint(lane, Math.min(car.s + LOOKAHEAD, len));
  const rx = -dir.z;
  const rz = dir.x;
  const tx = look.x + rx * car.lateral;
  const tz = look.z + rz * car.lateral;
  const want = Math.atan2(tx - car.x, tz - car.z);
  const diff = wrapAngle(want - car.heading);
  car.heading += Math.max(-MAX_TURN * dt, Math.min(MAX_TURN * dt, diff));
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;

  // --- Lane end: pick a successor at the junction. ---
  if (projectOnLane(car.x, car.z, lane).s >= len - 1.5) {
    const next = pickSuccessor(car, city, lane);
    if (next !== null) car.lane = next;
  }
}

/** A hard separation pass: two cars that still touch are pushed apart. */
function separateTraffic(cars) {
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 4.4 || dist < 1e-6) continue;
      const push = (4.4 - dist) / 2;
      const nx = dx / dist;
      const nz = dz / dist;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    }
  }
}

/** One fixed step of traffic. `player` is the hero car (the obstacle). */
export function stepTraffic(traffic, city, player, dt, time) {
  for (const car of traffic.cars) stepCar(car, traffic, city, player, dt, time);
  separateTraffic(traffic.cars);
}
