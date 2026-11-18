// The screenshot scenes behind ?shot=start|play|chase|street|end. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, steered by a road-following
// autopilot (it picks the connected segment closest to the car's heading at each junction and
// brakes for sharp turns), so the frame is what a short drive really looks like and the same
// seed always gives the same frame.
import { STEP } from './config.js';
import { nearestSegment } from './city.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { reportCrime } from './wanted.js';
import { spawnPolice } from './police.js';

const START_SECONDS = 0;
const PLAY_SECONDS = 20; // at 26 s the car sat in a building shadow on avenue -120; 20 s should catch it sunlit just after the beachfront turn
const CHASE_SECONDS = 8;
const STREET_SECONDS = 20; // the car stops at a red light (~11 s of the 22 s cycle) and the palms line the sightline — a longer drive gets it moving through the junction

function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** A road-following autopilot: chase the far node of the connected segment closest to the nose. */
export function autopilotDrive(sim) {
  const { state } = sim;
  const car = state.car;
  const speed = Math.hypot(car.vx, car.vz);
  const near = nearestSegment(state.city, car.x, car.z);
  if (!near) return { steer: 0, throttle: 1, handbrake: false };
  const s = near.segment;
  // The node ahead: the segment end further along the car's travel direction.
  const fwdX = Math.sin(car.heading);
  const fwdZ = Math.cos(car.heading);
  const toA = (s.a.x - car.x) * fwdX + (s.a.z - car.z) * fwdZ;
  const toB = (s.b.x - car.x) * fwdX + (s.b.z - car.z) * fwdZ;
  let node = toB >= toA ? s.b : s.a;
  // At the node, take the connected segment closest to the current heading.
  let bestNode = node;
  let bestDot = -2;
  for (const other of state.city.segments) {
    if (other === s) continue;
    const otherNode = other.a === node ? other.b : other.b === node ? other.a : null;
    if (!otherNode) continue;
    const dx = otherNode.x - node.x;
    const dz = otherNode.z - node.z;
    const len = Math.hypot(dx, dz) || 1;
    const dot = (dx / len) * fwdX + (dz / len) * fwdZ;
    if (dot > bestDot) { bestDot = dot; bestNode = otherNode; }
  }
  // Aim at the junction itself while far away, and only at the far node once close: aiming
  // at the far node from the start of the approach cuts every corner across the sidewalk.
  const distToNode = Math.hypot(node.x - car.x, node.z - car.z);
  const aimX = distToNode > 10 ? node.x : bestNode.x;
  const aimZ = distToNode > 10 ? node.z : bestNode.z;
  const desired = Math.atan2(aimX - car.x, aimZ - car.z);
  const diff = wrapAngle(desired - car.heading);
  const steer = Math.max(-1, Math.min(1, diff * 1.6));
  const throttle = Math.abs(diff) > 0.7 && speed > 12 ? -0.5 : 1;
  return { steer, throttle, handbrake: false };
}

function driveFor(sim, seconds) {
  for (let i = 0; i < seconds / STEP; i += 1) sim.step(autopilotDrive(sim));
}

/**
 * Set the sim to the named scene and return the screen to draw over it. Any unknown name is
 * the title scene.
 */
export function stageShot(name, sim, renderer) {
  sim.reset();
  if (name === 'play') {
    renderer.clearFixedCamera();
    driveFor(sim, PLAY_SECONDS);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'chase') {
    sim.place(100, 126.5, -Math.PI / 2); // beachfront, westbound — driving INTO the low sun
    sim.state.fov = 70; // wider chase lens: the low sun sits inside the frame, speed reads faster
    renderer.clearFixedCamera();
    driveFor(sim, CHASE_SECONDS);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'wanted') {
    // A staged 3-star chase on a CITY street: a witnessed assault files the description,
    // 3 DEPD units spawn ahead, AIR-1 comes up — the frame the cover needs. The beachfront
    // staging failed (the car sat on sand, the road out of frame, the units too far to
    // read). Street z=20 runs west through downtown — tall pastel facades both sides — and
    // the WSW heading puts the low SW sun ~22 deg left of centre, deep in the frame.
    sim.place(100, 20, -Math.PI / 2); // street z=20, westbound through downtown — the 8 s drive ends mid-downtown, tall facades both sides
    sim.state.fov = 70;
    sim.state.camDistance = 9; // pull in: the hero car read small at the 11 m chase distance
    const w = sim.state.wanted;
    const desc = { carColor: 'pink', carModel: 'KOMODO GT', jacket: 'red', weapon: 'pistol' };
    reportCrime(w, { kind: 'assault', x: sim.state.car.x, z: sim.state.car.z, description: desc, seen: true });
    reportCrime(w, { kind: 'cop', x: sim.state.car.x, z: sim.state.car.z, description: desc, seen: true });
    spawnPolice(sim.state.police, sim.state.city, sim.state.car, 3);
    renderer.clearFixedCamera();
    driveFor(sim, CHASE_SECONDS);
    // The 8 s drive can end with a PIT spin throwing the car anywhere (a spin turns it
    // onto an avenue, and the nearest E-W segment is then the beachfront — try-2 landed
    // on sand). So the snap is to a FIXED downtown spot, not to the car's post-drive
    // position: the E-W segment nearest (30, 20), mid-block on street z=20 between avenues
    // 0 and 60, tall facades both sides. The frame is frozen after staging, so the car
    // holds exactly where placed; the sun (SW) then sits ~22 deg left of centre.
    const car = sim.state.car;
    let best = null;
    let bestD = Infinity;
    for (const s of sim.state.city.segments) {
      const dx = s.b.x - s.a.x;
      const dz = s.b.z - s.a.z;
      if (Math.abs(dx) < Math.abs(dz) * 3) continue; // not east-west
      const mx = (s.a.x + s.b.x) / 2;
      const mz = (s.a.z + s.b.z) / 2;
      const d = Math.hypot(30 - mx, 20 - mz);
      if (d < bestD) { bestD = d; best = s; }
    }
    const speed = Math.hypot(car.vx, car.vz);
    if (best) {
      car.x = 30;
      car.z = 20;
      car.heading = -3 * Math.PI / 8; // WSW, into the low sun
      car.vx = Math.sin(car.heading) * speed;
      car.vz = Math.cos(car.heading) * speed;
    }
    // Cover framing: the pursuit drives past during the 8 s, so the units end up behind
    // the chase camera. Put two of them back where they READ at 384 px — one flanking
    // alongside in the next lane (rear three-quarter, light bar on top) and one angled
    // across the road ahead (full flank + light bar, a rolling roadblock). The frame is
    // frozen after staging, so they hold exactly where placed.
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const px = Math.cos(car.heading);
    const pz = -Math.sin(car.heading);
    const units = sim.state.police.units;
    const slots = [
      { ahead: 3, side: 3.5, heading: car.heading }, // flanker, same direction, right lane
      { ahead: 10, side: -2.0, heading: car.heading + Math.PI / 2 }, // roadblock, flank to camera — closer, so the light bar reads
    ];
    for (let i = 0; i < Math.min(2, units.length); i += 1) {
      const u = units[i];
      const slot = slots[i];
      u.x = car.x + fx * slot.ahead + px * slot.side;
      u.z = car.z + fz * slot.ahead + pz * slot.side;
      u.heading = slot.heading;
      u.vx = 0;
      u.vz = 0;
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'street') {
    sim.place(-3.5, 10, 0); // central avenue, southbound — avenue -60's sightline is blocked by a palm the car stops behind
    renderer.clearFixedCamera();
    driveFor(sim, STREET_SECONDS);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'end') {
    sim.place(198, 60, Math.PI / 2); // pier end, harbour behind
    renderer.setFixedCamera({ x: 165, y: 16, z: 28 }, { x: 185, y: 3, z: 60 });
    return { screen: SCREEN_PLAY };
  }
  renderer.setFixedCamera(
    { x: sim.state.car.x - 55, y: 30, z: sim.state.car.z - 70 },
    { x: 0, y: 5, z: 20 },
  );
  return { screen: SCREEN_TITLE };
}
