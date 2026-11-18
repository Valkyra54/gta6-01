// The screenshot scenes behind ?shot=start|play|end. Each one plays the real
// rules forward from a fresh state for a fixed number of steps, steered by a
// simple autopilot (hold the lane, ease off before the road ends), so the frame
// is what a short drive really looks like and the same seed always gives the
// same frame. `wall`, `edge` and `street` are verification-only scenes (not
// submission shots): they stage the Day 2 collision, world-bounds and
// traffic/ped behaviour so it can be seen in a screenshot instead of only in
// a headless test.
import { STEP } from './config.js';
import { SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './hud.js';
import { reportCrime } from './wanted.js';
import { placePoliceUnit } from './police.js';
import { nearestRoadPoint } from './collision.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 26;
const END_SECONDS = 60;
const WALL_SECONDS = 4;
const EDGE_SECONDS = 60;
const STREET_SECONDS = 3;

/** Steer toward the beach strip lane and hold it; ease off mid-street so the
 *  frame ends with a long clear run of road ahead, not against the south edge. */
function autopilot(state) {
  const laneX = state.city.start.x;
  const lateral = laneX - state.car.x;
  const steer = Math.max(-1, Math.min(1, lateral * 0.06 - state.car.heading * 1.2));
  const z = state.car.z;
  return {
    throttle: z > -30 ? 0.25 : 1,
    steer,
    brake: z > 5 ? 1 : 0,
    handbrake: false,
  };
}

/** Pure pursuit toward a point on a lane: aim 25 m ahead on the lane line,
 *  in the direction of travel (`dir` +1 south, -1 north), and steer toward
 *  it. Works heading south and north, unlike a fixed-heading autopilot. */
function laneAutopilot(state, laneX, dir, throttle) {
  const tx = laneX;
  const tz = state.car.z + dir * 25;
  const want = Math.atan2(tx - state.car.x, tz - state.car.z);
  let diff = want - state.car.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return { throttle, steer: Math.max(-1, Math.min(1, diff * 2)), brake: 0, handbrake: false };
}

/** Full throttle south, no braking: the car must turn back at the
 *  road-network edge instead of driving into the void. */
function edgeAutopilot(state) {
  const dir = Math.abs(state.car.heading) < Math.PI / 2 ? 1 : -1;
  return laneAutopilot(state, state.city.start.x, dir, 1);
}

/** A busy Kota Lama street: the car drives south on the x=-33 road toward
 *  its traffic-light junction, so the frame shows traffic, peds and a light. */
function streetAutopilot(state) {
  return laneAutopilot(state, -36.5, 1, 0.6);
}

/** The chase circuit: a rectangle of Kota Lama roads, driven lap after lap so
 *  a 26 s chase never reaches the edge of the world. Leg-based, not
 *  waypoint-based: pure pursuit to the far corner cuts across the block,
 *  straight into buildings. Each leg is one road (its lane line, direction,
 *  and end); the aim point is 25 m ahead along the leg, and the leg only
 *  changes once the car reaches the junction — so the car turns at
 *  junctions like a driver. */
const CHASE_LEGS = [
  { axis: 'z', line: -168.5, dir: 1, end: 66 }, // south, x=-165 road (the start road)
  { axis: 'x', line: 69.5, dir: 1, end: 99 }, // east, z=66 road
  { axis: 'z', line: 95.5, dir: -1, end: -66 }, // north, x=99 road (wrong way)
  { axis: 'x', line: -69.5, dir: -1, end: -165 }, // west, z=-66 road
];

export function chaseAutopilot(state) {
  if (state.chaseLeg === undefined) state.chaseLeg = 0;
  const leg = CHASE_LEGS[state.chaseLeg];
  const coord = leg.axis === 'z' ? state.car.z : state.car.x;
  // Switch legs 25 m before the junction: this car turns at a constant
  // 20 m radius (turn rate scales with speed, so slowing down does NOT
  // tighten the turn) — the turn must start a full radius before the
  // corner, or the arc exits 20 m past the junction, inside the block.
  // Aiming at the junction itself delays the turn until it is too late.
  const pastEnd = leg.dir > 0 ? coord >= leg.end - 25 : coord <= leg.end + 25;
  if (pastEnd) state.chaseLeg = (state.chaseLeg + 1) % CHASE_LEGS.length;
  const active = CHASE_LEGS[state.chaseLeg];
  const aim = active.axis === 'z'
    ? { x: active.line, z: state.car.z + active.dir * 25 }
    : { x: state.car.x + active.dir * 25, z: active.line };
  const dx = aim.x - state.car.x;
  const dz = aim.z - state.car.z;
  const want = Math.atan2(dx, dz);
  let diff = want - state.car.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  // A weave: the chase reads as a chase, not a commute. Under AIR-1 the
  // weave hardens: the heli's lock breaks at 0.3 rad/s of heading change,
  // and the gentle weave only reaches 0.23 — so the gunner fires every
  // three seconds on a straight. A 0.18 weave peaks at 0.34 rad/s and keeps
  // resetting the lock, the way a swerving player would.
  const weaveAmp = state.heli && state.heli.state === 'watch' ? 0.18 : 0.12;
  const weave = Math.sin(state.time * 0.6) * weaveAmp;
  const steer = Math.max(-1, Math.min(1, diff * 2 + weave));
  const speed = Math.abs(state.car.speed);
  // Stuck recovery: a player who drives nose-first into a wall reverses
  // out — and steers while reversing, so the nose swings onto a new line
  // instead of re-approaching the same wall at the same angle. Brake at a
  // standstill reverses the car; a negative speed flips the steering, so
  // the reverse steer is the opposite sign of the forward one.
  if (speed < 1) {
    if (state.chaseStuckSince === undefined) state.chaseStuckSince = state.time;
  } else {
    state.chaseStuckSince = undefined;
    state.chaseReverseUntil = undefined;
  }
  if (state.chaseStuckSince !== undefined && state.time - state.chaseStuckSince > 1.5
      && state.chaseReverseUntil === undefined) {
    state.chaseReverseUntil = state.time + 2.0;
  }
  if (state.chaseReverseUntil !== undefined && state.time < state.chaseReverseUntil) {
    return { throttle: 0, steer: -steer, brake: 1, handbrake: false };
  }
  return {
    throttle: Math.abs(diff) < 0.35 ? 1 : 0.75,
    steer,
    brake: 0,
    handbrake: false,
  };
}

/**
 * Set `state` to the named scene (start, play or end; any other name is start)
 * by stepping it forward with the autopilot, and return the screen to draw
 * over it. `step` is the sim's one-fixed-step function: step(state, drive).
 */
export function stageShot(name, state, step) {
  state.car.x = state.city.start.x;
  state.car.z = state.city.start.z;
  state.car.heading = state.city.start.heading;
  state.car.speed = 0;
  state.car.vx = 0;
  state.car.vz = 0;
  state.car.steer = 0;
  state.time = 0;
  if (name === 'chase') {
    // A 2★ chase that heats to 3★: the player steals down the circuit with
    // two DEPD cars behind and AIR-1 coming in overhead. The frame at 26 s is
    // the future cover's core — police lights, helicopter, stars, search zone.
    // The car starts on the circuit (city.start, the west road) with the
    // cops behind it on the same road; starting it anywhere else makes the
    // autopilot cut diagonally across blocks to reach the circuit.
    state.chaseLeg = 0;
    reportCrime(state.wanted, 'car-theft', state.car.x, state.car.z, {
      carColor: 'pink', carModel: 'KOMODO GT', jacket: 'red', weapon: null,
    }, 0);
    state.wanted.stars = 2;
    state.wanted.searchZone = { x: state.car.x, z: state.car.z, radius: 80 };
    state.wanted.lastKnown = { x: state.car.x, z: state.car.z };
    placePoliceUnit(state.police, state.car.x, state.car.z - 18, 0);
    placePoliceUnit(state.police, state.car.x, state.car.z - 30, 0);
    const CHASE_SECONDS = 26;
    const ESCALATE_AT = 12;
    for (let index = 0; index < CHASE_SECONDS / STEP; index += 1) {
      if (state.time >= ESCALATE_AT && state.wanted.stars === 2) {
        reportCrime(state.wanted, 'ram-police', state.car.x, state.car.z, {
          carColor: 'pink', carModel: 'KOMODO GT', jacket: 'red', weapon: null,
        }, state.time);
      }
      step(state, chaseAutopilot(state));
    }
    // The cover needs a cop IN the frame: the chase cam looks forward, so
    // pursuers behind the player are invisible, and a roadblock 45 m out is
    // thirteen pixels tall. Stage the farthest unit as the roadblock, 30 m
    // ahead on the player's road and facing the player with its lights on —
    // the roadblock mechanic, placed where the camera can see it — and the
    // second-farthest as a flanker door-to-door on the player's left, the
    // box-in moment, big in the frame.
    const ahead = nearestRoadPoint(state.city,
      state.car.x + Math.sin(state.car.heading) * 30,
      state.car.z + Math.cos(state.car.heading) * 30);
    const sorted = [...state.police.units].sort((a, b) =>
      Math.hypot(b.x - state.car.x, b.z - state.car.z)
      - Math.hypot(a.x - state.car.x, a.z - state.car.z));
    const far = sorted[0];
    if (far) {
      far.x = ahead.x;
      far.z = ahead.z;
      far.heading = state.car.heading + Math.PI;
      far.speed = 0;
      far.vx = 0;
      far.vz = 0;
      far.state = 'roadblock';
      far.target = { x: ahead.x, z: ahead.z };
    }
    const flank = sorted[1];
    if (flank) {
      const fx = Math.sin(state.car.heading);
      const fz = Math.cos(state.car.heading);
      // Left of the player's heading, two metres ahead: the oncoming lane.
      flank.x = state.car.x + fz * 3.5 + fx * 2;
      flank.z = state.car.z - fx * 3.5 + fz * 2;
      flank.heading = state.car.heading;
      flank.speed = Math.abs(state.car.speed);
      flank.vx = state.car.vx;
      flank.vz = state.car.vz;
      flank.state = 'pursue';
      flank.role = 'flank-right';
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'wall') {
    // Drive straight into a building and hold the throttle: the car must
    // stop at the wall, never pass through it.
    const b = state.city.buildings.find((bb) => Math.abs(bb.x) < 120 && Math.abs(bb.z) < 120);
    state.car.x = b.x;
    state.car.z = b.z - b.d / 2 - 8;
    state.car.heading = 0;
    for (let index = 0; index < WALL_SECONDS / STEP; index += 1) {
      step(state, { throttle: 1, steer: 0, brake: 0, handbrake: false });
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'edge') {
    for (let index = 0; index < EDGE_SECONDS / STEP; index += 1) {
      step(state, edgeAutopilot(state));
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'street') {
    // Stage the car on the southbound lane of the x=-33 road, north of the
    // Kota Lama traffic-light junction at (-33, 0).
    state.car.x = -36.5;
    state.car.z = -60;
    state.car.heading = 0;
    for (let index = 0; index < STREET_SECONDS / STEP; index += 1) {
      step(state, streetAutopilot(state));
    }
    return { screen: SCREEN_PLAY };
  }
  if (name !== 'play' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      step(state, { throttle: 0, steer: 0, brake: 0, handbrake: false });
    }
    return { screen: SCREEN_TITLE };
  }
  const limit = name === 'end' ? END_SECONDS : PLAY_SECONDS;
  for (let index = 0; index < limit / STEP; index += 1) {
    step(state, autopilot(state));
  }
  return { screen: name === 'end' ? SCREEN_PAUSED : SCREEN_PLAY };
}
