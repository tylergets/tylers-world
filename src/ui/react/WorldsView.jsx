import { worldChoices, ago } from '../picks.js';
import { UiButton } from './UiButton.jsx';

export function WorldsView({ controller }) {
  return <div className="modal" hidden={!controller.open} onPointerDown={(event) => { if (event.target === event.currentTarget) controller.close(); }}>
    <div className="modal-card" role="dialog" aria-modal="true" aria-label="Worlds and saves">
      <div className="modal-head"><span className="modal-title">Worlds</span><span className="modal-esc">Esc</span><UiButton className="modal-x" aria-label="Close" onClick={() => controller.close()}>✕</UiButton></div>
      <div className="set-title">Start a new world</div>
      <div id="worlds-choices">{worldChoices().map((row) => <UiButton className={`pick${row.id === controller.choice ? ' on' : ''}`} key={row.id} onClick={() => controller.select(row.id)}><span className="pick-body"><div className="pick-name">{row.name}</div><div className="pick-note">{row.note}</div></span></UiButton>)}</div>
      <div className="seed-row" hidden={!controller.form()}><span className="seed-label">Seed</span><input id="worlds-seed" type="text" inputMode="numeric" spellCheck="false" aria-label="World seed" value={controller.seedText} onChange={(event) => controller.setSeed(event.target.value)} /><UiButton className="btn" style={{ flex: 'none' }} title="Roll a new seed" onClick={() => controller.reroll()}>↻</UiButton></div>
      <div className="modal-actions"><UiButton className="btn go" disabled={controller.busy} onClick={() => controller.start()}>Start</UiButton></div>
      <div className={`modal-note${controller.bad ? ' bad' : ''}`} role="status">{controller.note}</div>
      <div className="modal-sep" /><div className="set-title">Saved games</div>
      <div id="worlds-saves">{controller.saves.length ? controller.saves.map((save) => <div className="pick" key={save.id} onClick={() => controller.load(save.id)}><span className="pick-body"><div className="pick-name">{save.name}</div><div className="pick-note">{save.kind === 'seed' ? 'generated' : 'starter'}{save.place ? ` · ${save.place}` : ''}</div></span><span className="pick-when">{ago(save.savedAt ?? 0)}</span><UiButton className="pick-kill" title="Delete" aria-label="Delete" onClick={(event) => { event.stopPropagation(); controller.delete(save.id); }}>✕</UiButton></div>) : <div className="modal-empty">Nothing saved yet.</div>}</div>
      <div className="modal-actions"><UiButton className="btn" disabled={controller.busy} onClick={() => controller.save()}>Save this world</UiButton></div>
    </div>
  </div>;
}
