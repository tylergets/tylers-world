/** Raw keyboard state, normalised to named actions. */

/**
 * A keypress meant for a text field is not a keypress meant for the game.
 *
 * This listens on the window, which is what makes movement work no matter what
 * the player last clicked -- and which also means that without this test,
 * typing a seed into the worlds panel walks you across the map, and every
 * `preventDefault` above eats the character you were trying to type. The test
 * is on the event's target rather than on `document.activeElement` because a
 * keydown is delivered to the focused element and that is the thing that
 * settles it.
 */
const typing = (e) => {
  const el = e.target;
  return !!el && (el.isContentEditable === true
    || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

const MAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

export class Keyboard {
  constructor(target = window) {
    this.state = { up: false, down: false, left: false, right: false, run: false };
    this._press = new Set();

    target.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      const a = MAP[e.code];
      if (a) { this.state[a] = true; e.preventDefault(); }
      this._press.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      if (typing(e)) return;
      const a = MAP[e.code];
      if (a) { this.state[a] = false; e.preventDefault(); }
    });
    // Held keys would otherwise stick down across a tab switch.
    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.state)) this.state[k] = false;
    });
  }

  /** True once per physical press. */
  pressed(code) {
    if (!this._press.has(code)) return false;
    this._press.delete(code);
    return true;
  }

  endFrame() { this._press.clear(); }
}
