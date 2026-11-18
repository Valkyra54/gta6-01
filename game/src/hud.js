// The HUD: DOM panels over the 3D view. The renderer draws the world; this
// file writes the numbers and the words. Every value here comes from the sim
// state, and nothing here allocates on the frame path beyond text updates.
import { speedKmh } from './car.js';
import { districtAt } from './city.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';

/** Grab the HUD elements once; the game updates them in place. */
export function createHud() {
  const el = (id) => document.getElementById(id);
  return {
    missionNo: el('mission').querySelector('.no'),
    missionTitle: el('mission').querySelector('.title'),
    missionObj: el('mission').querySelector('.obj'),
    missionStage: el('mission').querySelector('.stage'),
    stars: el('stars'),
    desc: el('desc'),
    air1: el('air1'),
    tyres: el('tyres'),
    cash: el('cash'),
    clock: el('clock'),
    mapLabel: el('maplabel'),
    speed: el('speed'),
    nitro: el('nitrofill'),
    radio: el('radio'),
    carName: el('carname'),
    dialogWho: el('dialog').querySelector('.who'),
    dialogLine: el('dialog').querySelector('.line'),
    dialog: el('dialog'),
    prompt: el('prompt'),
    screen: el('screen'),
    status: el('status'),
  };
}

/**
 * The star row, per state: solid gold while a cop sees you, flashing gold
 * while they search, solid red near the scene, hollow when the crime was
 * reported with no description. Rebuilt only when the row changes.
 */
function starRow(hud, wanted) {
  const key = `${wanted.stars}|${wanted.display}`;
  if (hud._starsKey === key) return;
  hud._starsKey = key;
  const cls = wanted.display === 'seen' ? 'st-on'
    : wanted.display === 'searching' ? 'st-flash'
    : wanted.display === 'near' ? 'st-red'
    : wanted.display === 'reported' ? 'st-hollow' : 'st-off';
  let row = '';
  for (let i = 0; i < 3; i += 1) {
    const filled = i < wanted.stars;
    row += `<span class="${filled ? cls : 'st-off'}">${filled ? '★' : '☆'}</span>`;
  }
  hud.stars.innerHTML = row;
}

/** The description panel: what the police know, and how to lose each part. */
function descLines(wanted) {
  if (wanted.stars === 0) return '';
  const d = wanted.description;
  const known = d && (d.carColor || d.carModel || d.jacket || d.weapon);
  let html = '';
  if (known) {
    if (d.carColor || d.carModel) {
      html += `<div>CAR: ${[d.carColor, d.carModel].filter(Boolean).join(' ').toUpperCase()} <span>— respray [CAT BARU]</span></div>`;
    }
    if (d.jacket) html += `<div>JACKET: ${d.jacket.toUpperCase()} <span>— ganti jaket</span></div>`;
    if (d.weapon) html += `<div>WEAPON: ${d.weapon.toUpperCase()} <span>— buang senjata</span></div>`;
  } else {
    html += '<div>TANPA DESKRIPSI — mereka hanya tahu ada kejahatan</div>';
  }
  if (wanted.heliWatching) html += '<div class="blocked">AIR-1 DI ATAS — ganti mobil/pakaian TIDAK BERGUNA</div>';
  return html;
}

/** Write the sim state into the HUD. Call once a frame; cheap text updates. */
export function updateHud(hud, state) {
  hud.missionNo.textContent = `MISSION ${state.mission.number} / 3`;
  hud.missionTitle.textContent = state.mission.title;
  hud.missionObj.textContent = state.mission.objective;
  hud.missionStage.textContent = state.mission.stage;
  starRow(hud, state.wanted);
  hud.desc.innerHTML = descLines(state.wanted);
  hud.desc.style.display = state.wanted.stars > 0 ? 'block' : 'none';
  hud.air1.style.display = state.heli.active ? 'block' : 'none';
  const flat = state.time < state.tyres.flatUntil;
  hud.tyres.style.display = flat || state.tyres.steeringDamaged ? 'block' : 'none';
  hud.tyres.textContent = flat
    ? 'BAN KEMPIS — MAX 40%'
    : 'KEMUDI RUSAK — cari BENGKEL BUDI';
  hud.cash.textContent = `$${state.cash.toLocaleString('en-US')}`;
  hud.clock.textContent = `HARI ${state.day} · ${state.clock}`;
  hud.mapLabel.textContent = districtAt(state.car.x, state.car.z).toUpperCase();
  hud.speed.innerHTML = `${speedKmh(state.car)} <small>KM/H</small>`;
  hud.nitro.style.width = `${Math.round(state.nitro * 100)}%`;
  hud.radio.textContent = `${state.radio.station} · ${state.radio.track}`;
  hud.carName.textContent = state.carName;
  hud.dialogWho.textContent = `${state.dialog.who} — ${state.dialog.role}`;
  hud.dialogLine.textContent = state.dialog.line;
  hud.dialog.style.display = state.dialog.line ? 'block' : 'none';
  if (state.prompt) {
    hud.prompt.style.display = 'block';
    hud.prompt.textContent = state.prompt;
  } else {
    hud.prompt.style.display = 'none';
  }
}

/** Show the title or pause screen, or hide the overlay for play. */
export function showScreen(hud, screen, state) {
  if (screen === SCREEN_PLAY) {
    hud.screen.style.display = 'none';
    return;
  }
  hud.screen.style.display = 'flex';
  const title = hud.screen.querySelector('h1');
  const sub = hud.screen.querySelector('h2');
  const go = hud.screen.querySelector('.go');
  if (screen === SCREEN_TITLE) {
    title.textContent = 'DERMAGA EMAS';
    sub.textContent = 'GOLDEN WHARF · AN OPEN-WORLD CRIME GAME';
    go.textContent = 'PRESS SPACE OR CLICK TO START';
  } else {
    title.textContent = 'PAUSED';
    sub.textContent = `MISSION ${state.mission.number} / 3 — ${state.mission.title}`;
    go.textContent = 'PRESS P OR CLICK TO RESUME';
  }
}
