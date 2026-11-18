// The DOM HUD, updated from simulation state. Dense per the top-10 cover grammar: mission
// panel top-left, wanted stars + cash + clock top-right, round minimap bottom-left (minimap.js),
// speed + NITRO bar + radio bottom-right, NPC dialog strip bottom-centre, contextual prompt.
// Text is ≥20px at 1280×720 and inset ≥24px from the frame edge. Nothing here claims a system
// the game does not have: 3 story jobs, radio names only, no save, no garage, no on-foot.
import { CLOCK, FONT, MISSIONS, NAMES, START_CASH } from './config.js';
import { speedKmh } from './car.js';
import { descriptionLines } from './wanted.js';
import { missionStageText } from './missions.js';

function money(value) {
  return '$' + value.toLocaleString('en-US');
}

export function createHud(document, minimap) {
  const el = (id) => document.getElementById(id);
  const missionTitle = el('mission-title');
  const missionObjective = el('mission-objective');
  const missionStage = el('mission-stage');
  const starsEl = el('stars');
  const descEl = el('desc');
  const healthEl = el('health');
  const cashEl = el('cash');
  const clockEl = el('clock');
  const speedEl = el('speed');
  const radioEl = el('radio');
  const dialogEl = el('dialog');
  const promptEl = el('prompt');
  const titleScreen = el('title-screen');
  const pauseScreen = el('pause-screen');

  let last = {};
  function setIf(key, element, value) {
    if (last[key] !== value) {
      last[key] = value;
      element.textContent = value;
    }
  }

  return {
    update(state) {
      const mission = MISSIONS[Math.min(state.missionIndex, MISSIONS.length - 1)];
      setIf('missionTitle', missionTitle, state.missionIndex < MISSIONS.length
        ? `MISSION ${mission.id} / ${MISSIONS.length}` : 'SEMUA JOB SELESAI');
      setIf('missionObjective', missionObjective, state.missionIndex < MISSIONS.length
        ? `${mission.name} — ${missionStageText(state.missions)}` : 'Legenda Dermaga');
      setIf('missionStage', missionStage, state.missionIndex < MISSIONS.length
        ? `STAGE ${state.stage} / ${mission.stages}` : '3 / 3 JOB SELESAI');
      // Star states: solid gold in line of sight, flashing while searching, solid red
      // near the scene, hollow when reported without a description.
      const w = state.wanted;
      const stars = w && w.state === 'hollow'
        ? '☆☆☆'
        : '★'.repeat(state.stars) + '☆'.repeat(3 - state.stars);
      setIf('stars', starsEl, stars);
      const starClass = !w || w.state === 'none' || w.state === 'los' ? ''
        : w.state === 'search' ? 'blink' : w.state;
      if (starsEl.className !== starClass) starsEl.className = starClass;
      const desc = w ? descriptionLines(w).map((l) => (l.hint ? `${l.label} — ${l.hint}` : l.label)).join('\n') : '';
      setIf('desc', descEl, desc);
      setIf('health', healthEl, state.health < 100 ? `HP ${Math.max(0, Math.round(state.health))}` : '');
      setIf('cash', cashEl, money(state.cash));
      setIf('clock', clockEl, CLOCK);
      setIf('speed', speedEl, String(Math.round(speedKmh(state.car))));
      setIf('radio', radioEl, `♪ ${NAMES.radioMusic}`);
      setIf('dialog', dialogEl, state.dialog);
      setIf('prompt', promptEl, state.prompt);
      minimap.draw(state);
    },
    showTitle() {
      titleScreen.style.display = 'flex';
      pauseScreen.style.display = 'none';
    },
    showPlay() {
      titleScreen.style.display = 'none';
      pauseScreen.style.display = 'none';
    },
    showPaused() {
      titleScreen.style.display = 'none';
      pauseScreen.style.display = 'flex';
    },
  };
}

// Static title-screen text, written once at boot (it never changes during play).
export function fillTitleScreen(document) {
  document.getElementById('title-name').textContent = 'DERMAGA EMAS';
  document.getElementById('title-sub').textContent = 'GOLDEN WHARF · AN OPEN-WORLD CRIME GAME';
  document.getElementById('title-tagline').textContent = NAMES.tagline;
  document.getElementById('title-mission').textContent = 'MISSION 1 / 3 — Selamat Datang';
  document.getElementById('title-controls').textContent = 'WASD / ARROWS drive · SPACE handbrake · P pause · MOUSE camera';
  document.getElementById('title-start').textContent = 'Press SPACE or click to start';
  document.getElementById('pause-controls').textContent = 'WASD / ARROWS drive · SPACE handbrake · P resume · MOUSE camera';
}
