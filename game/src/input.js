// Keyboard and pointer input. Held keys give a driving input; one-shot presses
// (start, pause, radio, map, exit) are queued as bit flags and taken once by the
// loop, so a press between two frames is never lost and never counted twice.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RADIO = 4;
export const ACTION_MAP = 8;
export const ACTION_EXIT = 16;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const BRAKE = new Set(['Space']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RADIO = new Set(['KeyR']);
const MAP = new Set(['KeyM']);
const EXIT = new Set(['KeyE']);

export function createInput(target) {
  let up = false;
  let down = false;
  let left = false;
  let right = false;
  let brake = false;
  let actions = 0;
  let mouseDX = 0;

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code)) up = true;
    else if (DOWN.has(event.code)) down = true;
    else if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (BRAKE.has(event.code)) {
      brake = true;
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (RADIO.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RADIO;
    } else if (MAP.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MAP;
    } else if (EXIT.has(event.code)) {
      if (!event.repeat) actions |= ACTION_EXIT;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) up = false;
    else if (DOWN.has(event.code)) down = false;
    else if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (BRAKE.has(event.code)) brake = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    up = false; down = false; left = false; right = false; brake = false;
  });
  target.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });
  window.addEventListener('mousemove', (event) => {
    mouseDX += event.movementX || 0;
  });

  return {
    /** The driving input for this step: throttle 0..1, steer -1..1, brake, handbrake. */
    drive() {
      return {
        throttle: up ? 1 : 0,
        steer: (right ? 1 : 0) - (left ? 1 : 0),
        brake: down ? 1 : 0,
        handbrake: brake,
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Horizontal mouse movement since the last call, for the camera. */
    takeMouseDX() {
      const dx = mouseDX;
      mouseDX = 0;
      return dx;
    },
  };
}
