// The hero car's kinematic arcade model: a velocity vector plus a slip angle and grip, pure
// simulation with no rendering in it. Deterministic: same inputs, same steps, same car.
// Heading 0 faces south (+z); forward is (sin(heading), cos(heading)) in (x, z).
import { CAR, CITY } from './config.js';

export function createCar(start) {
  return {
    x: start.x,
    z: start.z,
    heading: start.heading,
    vx: 0,
    vz: 0,
    steer: 0,
    bump: 0, // frames left of the hit flash the HUD can read
    distance: 0, // metres driven, for the speed readout and missions
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/**
 * One fixed step. `drive` is { steer: -1..1, throttle: -1..1, handbrake: bool }.
 * The car turns by a bicycle rule (turn rate grows with speed, capped), the engine pushes
 * along the nose, grip eats the sideways slide, and the handbrake cuts the grip so the tail
 * steps out. Walls and the world edge are solid. `cap` overrides the top speed — the
 * police run the same model at 1.08x the player's cap.
 */
export function stepCar(car, drive, city, dt, cap) {
  const maxSpeed = cap ?? CAR.maxSpeed;
  const speed = Math.hypot(car.vx, car.vz);
  const maxSteer = CAR.maxSteerLow + (CAR.maxSteerHigh - CAR.maxSteerLow) * (speed / CAR.maxSpeed);
  const steerTarget = drive.steer * maxSteer;
  const steerDelta = clamp(steerTarget - car.steer, -CAR.steerRate * dt, CAR.steerRate * dt);
  car.steer += steerDelta;

  const turnRate = clamp((speed / CAR.wheelbase) * Math.tan(car.steer), -CAR.maxTurnRate, CAR.maxTurnRate);
  car.heading += turnRate * dt;

  const fwd = forwardOf(car.heading);
  const forwardSpeed = car.vx * fwd.x + car.vz * fwd.z;
  // Engine along the nose; drag grows with speed so top speed is self-limiting.
  let push = 0;
  if (drive.throttle > 0) push = drive.throttle * CAR.accel;
  else if (drive.throttle < 0) push = forwardSpeed > 0.5 ? drive.throttle * CAR.brake : drive.throttle * CAR.reverseAccel;
  push -= forwardSpeed * CAR.drag;
  const nextForward = clamp(forwardSpeed + push * dt, -CAR.maxReverse, maxSpeed);
  // Sideways slide decays by grip (handbrake: much less grip, so the car drifts).
  const grip = drive.handbrake ? CAR.handbrakeGrip : CAR.grip;
  const slide = Math.exp(-grip * dt);
  const sideX = car.vx - forwardSpeed * fwd.x;
  const sideZ = car.vz - forwardSpeed * fwd.z;
  car.vx = nextForward * fwd.x + sideX * slide;
  car.vz = nextForward * fwd.z + sideZ * slide;

  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.distance += Math.hypot(car.vx, car.vz) * dt;
  if (car.bump > 0) car.bump -= 1;

  collideCity(car, city);
}

function collideCity(car, city) {
  const r = CAR.radius;
  // Building footprints are axis-aligned boxes: push the car out along the shallowest axis.
  for (let i = 0; i < city.buildings.length; i += 1) {
    const b = city.buildings[i];
    const dx = car.x - b.x;
    const dz = car.z - b.z;
    const px = b.hw + r - Math.abs(dx);
    const pz = b.hd + r - Math.abs(dz);
    if (px > 0 && pz > 0) {
      if (px < pz) {
        car.x += dx > 0 ? px : -px;
        car.vx *= -CAR.bumpKeep * 0.4;
      } else {
        car.z += dz > 0 ? pz : -pz;
        car.vz *= -CAR.bumpKeep * 0.4;
      }
      // Kill the speed into the wall, keep the slide along it.
      const speed = Math.hypot(car.vx, car.vz);
      if (speed > 1) {
        car.vx *= CAR.bumpKeep;
        car.vz *= CAR.bumpKeep;
      }
      car.bump = 6;
    }
  }
  // The world edge is a wall: the car stops at the sand and the sea.
  const b = CITY.bounds;
  if (car.x < b.minX + r) { car.x = b.minX + r; if (car.vx < 0) car.vx = 0; }
  if (car.x > b.maxX - r) { car.x = b.maxX - r; if (car.vx > 0) car.vx = 0; }
  if (car.z < b.minZ + r) { car.z = b.minZ + r; if (car.vz < 0) car.vz = 0; }
  if (car.z > b.maxZ - r) { car.z = b.maxZ - r; if (car.vz > 0) car.vz = 0; }
}

/** Speed in km/h, for the HUD. */
export function speedKmh(car) {
  return Math.hypot(car.vx, car.vz) * 3.6;
}
