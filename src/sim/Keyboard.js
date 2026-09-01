/** Raw keyboard state, normalised to named actions. */

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
      const a = MAP[e.code];
      if (a) { this.state[a] = true; e.preventDefault(); }
      this._press.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
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
