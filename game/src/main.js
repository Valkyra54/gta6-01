// DERMAGA EMAS — the entrypoint. Boot and the one loop: input is read every
// frame, the simulation advances in fixed 1/60 s steps (several in a slow frame,
// none in a fast one), and the renderer paints what is there. The game moves
// between three screens: title, play and paused. The simulation is plain data
// (city, car, wanted, mission); the renderer only draws it.
//
// ?seed=N fixes the city. ?shot=start|play|end (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { DEFAULT_SEED, STEP } from './config.js';
import { createRandom } from './random.js';
import { buildCity } from './city.js';
import { createCar, driveCar } from './car.js';
import { resolveCarCollision, resolvePlayerTraffic, turnBackIfOutOfBounds } from './collision.js';
import { createTraffic, stepTraffic } from './traffic.js';
import { createPeds, stepPeds } from './peds.js';
import { ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createWanted, processWitnessCalls, updateWanted } from './wanted.js';
import { createPolice, stepPolice } from './police.js';
import { createHeli, stepHeli } from './heli.js';
import { createMissions, restoreCheckpoint, stepMissions } from './missions.js';
import { createRenderer } from './render.js';
import { SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, createHud, showScreen, updateHud } from './hud.js';
import { drawMinimap } from './minimap.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : DEFAULT_SEED;

/** The whole simulation state: plain data, no three.js, no DOM. */
export function createState(city) {
  return {
    seed: city.seed,
    city,
    car: createCar(city.start),
    traffic: createTraffic(city, city.seed),
    peds: createPeds(city, city.seed),
    bump: -1, // sim time of the last collision, for the juice layer (Day 5)
    time: 0,
    wanted: createWanted(),
    wantedRng: createRandom(city.seed ^ 0x1a7), // description degradation rolls
    police: createPolice(city, city.seed),
    heli: createHeli(),
    cash: 120,
    day: 1,
    clock: '18:52',
    nitro: 1,
    radio: { station: 'OMBAY 92.5', track: 'Golden Hour Drive' },
    carName: 'KOMODO GT',
    carColor: null, // null = hero pink; the M3 swap changes it
    dialog: { who: 'RINA', role: 'WHEELWOMAN', line: 'Selamat datang di Dermaga Emas, Raka. Ikuti aku — dan jangan sentuh mobil pink itu dulu.' },
    prompt: '',
    mission: createMissions(city),
    searchZone: null,
    tyres: { flatUntil: 0, steeringDamaged: false },
    busted: null, // 'arrested' | 'wrecked' — a bust costs one objective
    bustedTimer: 0,
  };
}

/** The tyre limits for this step: flat tyres cap the speed at 40%. */
function tyreLimits(state) {
  const flat = state.time < state.tyres.flatUntil;
  return {
    maxSpeedMul: flat ? 0.4 : 1,
    turnMul: state.tyres.steeringDamaged ? 0.55 : 1,
  };
}

/** One fixed step of the simulation: the car, the collision, the traffic, the peds. */
export function stepState(state, drive) {
  state.time += STEP;
  driveCar(state.car, drive, STEP, tyreLimits(state));
  if (resolveCarCollision(state.car, state.city)) state.bump = state.time;
  resolvePlayerTraffic(state.car, state.traffic);
  turnBackIfOutOfBounds(state);
  stepTraffic(state.traffic, state.city, state.car, STEP, state.time);
  stepPeds(state.peds, state.city, state.car, STEP, state.time);
  // Day 3: witness calls land, the wanted level moves, the police and the
  // helicopter work it, the missions advance. A bust restores a checkpoint.
  processWitnessCalls(state.wanted, state.peds, state.time, state.wantedRng);
  updateWanted(state.wanted, state.car, state.police, state.heli.state === 'watch', state.city, STEP);
  stepPolice(state.police, state, STEP);
  stepHeli(state.heli, state, STEP);
  stepMissions(state, STEP);
  state.searchZone = state.wanted.searchZone;
  if (state.car.health <= 0 && !state.busted) {
    state.busted = 'wrecked';
    state.bustedTimer = 0;
  }
  if (state.busted) {
    state.bustedTimer += STEP;
    if (state.bustedTimer > 2) restoreCheckpoint(state);
  }
}

const container = document.getElementById('game');
const status = document.getElementById('status');
const minimapCanvas = document.getElementById('minimap');
const city = buildCity(seed);
const state = createState(city);
const renderer = createRenderer(container, city);
const hud = createHud();
// A read-only debug handle for playtesting (position, speed, camera): it
// names no secrets and changes nothing about the game.
window.__dermaga = { state, camera: renderer.camera, scene: renderer.scene };

function paint(state, screen, snap, dt) {
  renderer.draw(state, screen, snap, dt);
  updateHud(hud, state);
  drawMinimap(minimapCanvas, state);
  showScreen(hud, screen, state);
}

function runShot(name) {
  const scene = stageShot(name, state, stepState);
  let painted = 0;
  function paintFrame() {
    paint(state, scene.screen, true, STEP);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paintFrame);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paintFrame);
}

function runGame() {
  const input = createInput(container);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    // A fresh run: the whole dynamic state is rebuilt, not just the car.
    state.car = createCar(city.start);
    state.traffic = createTraffic(city, city.seed);
    state.peds = createPeds(city, city.seed);
    state.wanted = createWanted();
    state.police = createPolice(city, city.seed);
    state.heli = createHeli();
    state.mission = createMissions(city);
    state.cash = 120;
    state.carName = 'KOMODO GT';
    state.carColor = null;
    state.tyres = { flatUntil: 0, steeringDamaged: false };
    state.busted = null;
    state.bustedTimer = 0;
    state.searchZone = null;
    state.dialog = { who: 'RINA', role: 'WHEELWOMAN', line: 'Selamat datang di Dermaga Emas, Raka. Ikuti aku — dan jangan sentuh mobil pink itu dulu.' };
    state.time = 0;
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Follow Rina to the beach.');
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && (screen === SCREEN_TITLE || screen === SCREEN_PAUSED)) startGame();
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) return;
    stepState(state, input.drive());
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    accumulator += dt;
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    paint(state, screen, false, dt);
  }

  // Leaving the tab pauses a running game rather than letting the car drive unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('DERMAGA EMAS. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
