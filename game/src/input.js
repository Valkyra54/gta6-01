// Keyboard + mouse input. Live keys only: WASD/arrows drive, SPACE handbrake (and confirm on
// the title screen), P pause, mouse drag nudges the chase camera. There is no E, M or R key —
// nothing in the game uses them, so they are not listed anywhere.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake',
  Enter: 'confirm',
  KeyP: 'pause', Escape: 'pause',
};

export function createInput(canvas) {
  const held = { up: false, down: false, left: false, right: false, handbrake: false };
  let actions = 0;
  let cameraYaw = 0;
  let dragging = false;
  let lastX = 0;

  function onKeyDown(event) {
    const name = KEY_MAP[event.code];
    if (!name) return;
    event.preventDefault();
    if (name === 'confirm') actions |= ACTION_CONFIRM;
    else if (name === 'pause') actions |= ACTION_PAUSE;
    else if (name === 'handbrake') {
      if (!event.repeat) actions |= ACTION_CONFIRM; // SPACE also confirms on title/pause screens
      held.handbrake = true;
    } else held[name] = true;
  }

  function onKeyUp(event) {
    const name = KEY_MAP[event.code];
    if (!name) return;
    if (name === 'handbrake') held.handbrake = false;
    else if (held[name] !== undefined) held[name] = false;
  }

  function onPointerDown(event) {
    dragging = true;
    lastX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging) return;
    cameraYaw += (event.clientX - lastX) * 0.003;
    cameraYaw = Math.max(-0.9, Math.min(0.9, cameraYaw));
    lastX = event.clientX;
  }

  function onPointerUp(event) {
    dragging = false;
    if (event.pointerType === 'mouse') actions |= ACTION_CONFIRM; // click confirms on title/pause
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

  return {
    // -1 left, 0 straight, +1 right.
    direction() {
      return (held.right ? 1 : 0) - (held.left ? 1 : 0);
    },
    throttle() {
      return (held.up ? 1 : 0) - (held.down ? 1 : 0);
    },
    handbrake() {
      return held.handbrake;
    },
    cameraYaw() {
      return cameraYaw;
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
