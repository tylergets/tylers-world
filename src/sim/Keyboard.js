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
  // Held for a continuous orbit in the 3D view. The same two keys are ALSO read
  // as single presses, for the flat view's quarter turns -- see Game.turnCamera.
  Comma: 'turnLeft', Period: 'turnRight',
};

export class Keyboard {
  constructor(target = window) {
    this.state = {
      up: false, down: false, left: false, right: false, run: false,
      turnLeft: false, turnRight: false,
    };
    this._press = new Set();
    /**
     * Every code physically down right now.
     *
     * A SECOND record beside `_press`, and the two answer different questions.
     * `pressed` is an EDGE and is consumed by whoever reads it, which is what
     * makes one keystroke do one thing; this is a LEVEL, and nothing consumes
     * it. An automatic weapon is the only thing in the game that wants the
     * level -- see itemTypes.js on `auto` -- and giving it the edge instead
     * would make a machine gun a gun you have to press eleven times a second.
     */
    this._down = new Set();

    target.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      const a = MAP[e.code];
      if (a) { this.state[a] = true; e.preventDefault(); }
      this._press.add(e.code);
      this._down.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      if (typing(e)) return;
      const a = MAP[e.code];
      if (a) { this.state[a] = false; e.preventDefault(); }
      this._down.delete(e.code);
    });
    // Held keys would otherwise stick down across a tab switch.
    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.state)) this.state[k] = false;
      this._down.clear();
    });
  }

  /** True once per physical press. */
  pressed(code) {
    if (!this._press.has(code)) return false;
    this._press.delete(code);
    return true;
  }

  /** True for as long as the key is physically down. Consumes nothing. */
  held(code) { return this._down.has(code); }

  endFrame() { this._press.clear(); }
}
