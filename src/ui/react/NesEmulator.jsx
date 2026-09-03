import { useEffect, useRef, useState } from 'react';
import { Controller, NES } from 'jsnes';
import { UiButton } from './UiButton.jsx';

const KEYS = {
  ArrowUp: Controller.BUTTON_UP,
  ArrowDown: Controller.BUTTON_DOWN,
  ArrowLeft: Controller.BUTTON_LEFT,
  ArrowRight: Controller.BUTTON_RIGHT,
  KeyZ: Controller.BUTTON_B,
  KeyX: Controller.BUTTON_A,
  Enter: Controller.BUTTON_START,
  ShiftLeft: Controller.BUTTON_SELECT,
  ShiftRight: Controller.BUTTON_SELECT,
};

export function NesEmulator({ active }) {
  const canvasRef = useRef(null);
  const nesRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Insert a .nes cartridge to begin.');

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const image = context.createImageData(256, 240);
    const pixels = new Uint32Array(image.data.buffer);
    context.imageSmoothingEnabled = false;
    nesRef.current = new NES({
      emulateSound: false,
      onFrame(frame) {
        for (let i = 0; i < frame.length; i++) {
          const color = frame[i];
          pixels[i] = 0xff000000 | (color & 0xff) << 16 | (color & 0xff00) | color >>> 16 & 0xff;
        }
        context.putImageData(image, 0, 0);
      },
    });
    return () => { nesRef.current = null; };
  }, []);

  useEffect(() => {
    if (!active || !loaded) return undefined;
    let request = 0;
    let previous = performance.now();
    let owed = 0;
    const frame = (now) => {
      owed = Math.min(3, owed + (now - previous) / (1000 / 60));
      previous = now;
      while (owed >= 1) { nesRef.current?.frame(); owed--; }
      request = requestAnimationFrame(frame);
    };
    request = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(request);
  }, [active, loaded]);

  useEffect(() => {
    if (!active || !loaded) return undefined;
    const button = (event, down) => {
      const key = KEYS[event.code];
      if (key === undefined) return;
      event.preventDefault();
      nesRef.current?.[down ? 'buttonDown' : 'buttonUp'](1, key);
    };
    const down = (event) => button(event, true);
    const up = (event) => button(event, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      for (const key of new Set(Object.values(KEYS))) nesRef.current?.buttonUp(1, key);
    };
  }, [active, loaded]);

  const load = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      nesRef.current.loadROM(await file.arrayBuffer());
      setLoaded(true);
      setStatus(`${file.name} loaded. Audio is muted.`);
    } catch (error) {
      setLoaded(false);
      setStatus(`Cartridge could not be read: ${error.message}`);
    }
  };
  const press = (key, down) => (event) => {
    event.preventDefault();
    nesRef.current?.[down ? 'buttonDown' : 'buttonUp'](1, key);
  };
  const control = (label, key, className = '') => <button type="button" className={className}
    disabled={!loaded} aria-label={label} onPointerDown={press(key, true)}
    onPointerUp={press(key, false)} onPointerCancel={press(key, false)}>{label}</button>;

  return <div className="nes-emulator">
    <div className="nes-console">
      <div className="nes-bezel"><canvas ref={canvasRef} width="256" height="240" aria-label="NES display" /></div>
      <div className="nes-status" aria-live="polite">{status}</div>
      <div className="nes-actions">
        <label className="nes-load">Insert cartridge<input type="file" accept=".nes,application/octet-stream" onChange={load} /></label>
        <UiButton disabled={!loaded} onClick={() => nesRef.current?.reset()}>Reset</UiButton>
      </div>
    </div>
    <div className="nes-controller" aria-label="NES controller">
      <div className="nes-dpad">
        {control('Up', Controller.BUTTON_UP, 'up')}
        {control('Left', Controller.BUTTON_LEFT, 'left')}
        {control('Right', Controller.BUTTON_RIGHT, 'right')}
        {control('Down', Controller.BUTTON_DOWN, 'down')}
      </div>
      <div className="nes-system">
        {control('Select', Controller.BUTTON_SELECT)}
        {control('Start', Controller.BUTTON_START)}
      </div>
      <div className="nes-face">
        {control('B', Controller.BUTTON_B)}
        {control('A', Controller.BUTTON_A)}
      </div>
    </div>
    <p className="nes-help"><b>Keyboard:</b> arrows move, Z is B, X is A, Shift selects, Enter starts.</p>
  </div>;
}
