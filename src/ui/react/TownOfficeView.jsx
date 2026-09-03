import { PLANNER_TOOLS } from '../townhall.js';
import { UiButton } from './UiButton.jsx';

function Planner({ controller }) {
  const world = controller.context.world;
  const elevation = controller.elevationRange();
  return <><div className="to-intro"><b>Shape {world.meta.name}.</b> Paint surfaces, move buildings, or rotate them by quarter-turns. New footprints need clear, level ground.</div>
    <div className="to-planner"><div className="to-tools" role="toolbar" aria-label="Map surfaces">
      {PLANNER_TOOLS.map(([id, label, color]) => <UiButton key={id} className={controller.tool === id ? 'selected' : ''} style={{ '--swatch': color }} onClick={() => controller.setTool(id)}><i />{label}</UiButton>)}
      <div className="to-tool-label">Brush</div><div className="to-brushes" role="group" aria-label="Brush size">{[1, 2, 3].map((size) => <UiButton key={size} disabled={controller.tool === 'move' || controller.tool === 'rotate'} className={controller.brush === size ? 'selected' : ''} onClick={() => controller.setBrush(size)}>{size}×</UiButton>)}</div>
      <div className="to-tool-label">Elevation</div><div className="to-elevation-key"><span>Low {elevation.min}</span><i /><span>High {elevation.max}</span></div>
    </div><div className="to-map-wrap"><canvas className="to-map" aria-label="Editable town map" ref={controller.attachCanvas} /></div><div className="to-status" aria-live="polite" ref={controller.attachStatus}>{controller.tool === 'move' ? 'Drag a building to move it.' : controller.tool === 'rotate' ? 'Click a building to rotate it clockwise.' : 'Select a surface and paint.'}</div></div></>;
}
function Wildlife({ controller }) {
  const world = controller.context.world;
  return <><div className="to-intro"><b>Set healthy populations for {world.meta.name}.</b> Stock ponds or release and bait wildlife. Managed counts recover to this level after each dawn.</div><div className="to-wildlife">{controller.speciesRows().map(({ id, type, count, managed, target }) => <div className="to-species" key={id}><div className="to-species-name"><b>{type.label}</b><span>{type.swims ? 'Ponds & waterways' : 'Town habitat'} · {count} present{managed ? ' · managed' : ''}</span></div><UiButton aria-label={`Remove one ${type.label}`} onClick={() => controller.population(id, -1)}>−</UiButton><output title="Population target">{target}</output><UiButton aria-label={`Add one ${type.label}`} onClick={() => controller.population(id, 1)}>+</UiButton></div>)}</div><div className="to-status" aria-live="polite">{controller.message ?? 'Choose a species to adjust its population.'}</div></>;
}
const CHEATS = [['money', 'Unlimited money', 'Purchases and investments cost no coin.'], ['ammo', 'Unlimited shot', 'Guns fire without ammunition in the bag.'], ['invulnerable', 'No damage', 'Hostile shots still land, but remove no hearts.']];
const ACTIONS = [['tools', 'Give every tool', 'Add every missing tool the bag can hold.', 'GRANT'], ['heal', 'Restore health', 'Refill every heart immediately.', 'HEAL'], ['house', 'Max out home', 'Approve all three stories without payment.', 'BUILD']];
function Cheats({ controller }) {
  const cheats = controller.context.cheats;
  return <><div className="to-intro"><b>Rules are optional in this office.</b> Toggle persistent cheats or issue one-time grants for this save.</div><div className="to-cheats">
    {CHEATS.map(([key, title, detail]) => <UiButton key={key} className={`to-cheat${cheats[key] ? ' active' : ''}`} onClick={() => controller.cheat(key)}><span><b>{title}</b><small>{detail}</small></span><strong>{cheats[key] ? 'ON' : 'OFF'}</strong></UiButton>)}
    {ACTIONS.map(([action, title, detail, verb]) => <UiButton key={action} className="to-cheat" onClick={() => controller.cheat(undefined, action)}><span><b>{title}</b><small>{detail}</small></span><strong>{verb}</strong></UiButton>)}
  </div><div className="to-status" aria-live="polite">{controller.message ?? 'The Office of Cheats accepts no responsibility for consequences.'}</div></>;
}
export function TownOfficeView({ controller }) {
  const title = controller.office === 'planner' ? 'The Urban Planner' : controller.office === 'wildlife' ? 'Fish & Wildlife' : 'Office of Cheats';
  return <div className="town-office" data-office={controller.office ?? undefined} hidden={!controller.open}><section className="to-card" role="dialog" aria-modal="false" aria-labelledby="to-title"><header className="to-head"><div><div className="to-kicker">Town Hall</div><h2 id="to-title">{title}</h2></div><UiButton className="to-close" onClick={() => controller.close()}>Close</UiButton></header><div className="to-body">{controller.context && (controller.office === 'planner' ? <Planner controller={controller} /> : controller.office === 'wildlife' ? <Wildlife controller={controller} /> : <Cheats controller={controller} />)}</div><footer className="to-foot">Changes take effect immediately and are kept with this town. <b>Esc</b> closes the desk.</footer></section></div>;
}
