import { useState } from 'react';
import { PLANNER_POINT_TOOLS, PLANNER_TOOLS } from '../townhall.js';
import { TOWN_EXPANSION_TILES } from '../../sim/Edits.js';
import { animalPreview } from '../preview.js';
import { Svg } from './Svg.jsx';
import { UiButton } from './UiButton.jsx';

function Planner({ controller }) {
  const world = controller.context.world;
  const elevation = controller.elevationRange();
  const pointTool = PLANNER_POINT_TOOLS.has(controller.tool);
  return <><div className="to-intro"><b>Shape {world.meta.name}.</b> Paint surfaces, set landscaping, move buildings, or rotate them by quarter-turns. New footprints need clear, level ground.</div>
    <div className="to-planner"><div className="to-tools" role="toolbar" aria-label="Map surfaces">
      {PLANNER_TOOLS.map(([id, label, color]) => <UiButton key={id} className={controller.tool === id ? 'selected' : ''} style={{ '--swatch': color }} onClick={() => controller.setTool(id)}><i />{label}</UiButton>)}
      <div className="to-tool-label">Brush</div><div className="to-brushes" role="group" aria-label="Brush size">{[1, 2, 3].map((size) => <UiButton key={size} disabled={pointTool || controller.tool === 'move' || controller.tool === 'rotate'} className={controller.brush === size ? 'selected' : ''} onClick={() => controller.setBrush(size)}>{size}×</UiButton>)}</div>
      <div className="to-tool-label">Elevation</div><div className="to-elevation-key"><span>Low {elevation.min}</span><i /><span>High {elevation.max}</span></div>
    </div><div className="to-map-wrap"><canvas className="to-map" aria-label="Editable town map" ref={controller.attachCanvas} /></div><div className="to-status" aria-live="polite" ref={controller.attachStatus}>{controller.tool === 'move' ? 'Drag a building to move it.' : controller.tool === 'rotate' ? 'Click a building to rotate it clockwise.' : pointTool ? 'Click one clear, level tile.' : 'Select a surface and paint.'}</div></div></>;
}
const BIRDS = new Set(['chicken', 'duck', 'crow']);
const WILDLIFE_CATEGORIES = [
  ['all', 'All'], ['bird', 'Birds'], ['mammal', 'Mammals'], ['fish', 'Fish'],
];
const speciesCategory = (id, type) => type.swims ? 'fish'
  : type.fig?.form === 'bird' || BIRDS.has(id) ? 'bird' : 'mammal';

function SpeciesArt({ id, type }) {
  const html = animalPreview(id, type);
  return html ? <Svg html={html} /> : null;
}

function Wildlife({ controller }) {
  const world = controller.context.world;
  const [category, setCategory] = useState('all');
  const rows = controller.speciesRows().filter(({ id, type }) =>
    category === 'all' || speciesCategory(id, type) === category);
  return <><div className="to-intro"><b>Set healthy populations for {world.meta.name}.</b> Stock ponds or release and bait wildlife. Managed counts recover to this level after each dawn.</div>
    <div className="shop-categories to-taxonomy" role="tablist" aria-label="Species category">{WILDLIFE_CATEGORIES.map(([id, label]) => <UiButton key={id} className={`shop-category${category === id ? ' on' : ''}`} role="tab" aria-selected={category === id} onClick={() => setCategory(id)}>{label}</UiButton>)}</div>
    <div className="to-wildlife">{rows.map(({ id, type, count, managed, target }) => <div className="to-species" key={id}><span className="to-species-art"><SpeciesArt id={id} type={type} /></span><div className="to-species-name"><b>{type.label}</b><span>{type.swims ? 'Ponds & waterways' : 'Town habitat'} · {count} present{managed ? ' · managed' : ''}</span></div><UiButton aria-label={`Remove one ${type.label}`} onClick={() => controller.population(id, -1)}>−</UiButton><output title="Population target">{target}</output><UiButton aria-label={`Add one ${type.label}`} onClick={() => controller.population(id, 1)}>+</UiButton></div>)}</div><div className="to-status" aria-live="polite">{controller.message ?? 'Choose a species to adjust its population.'}</div></>;
}
function Residents({ controller }) {
  const { world, recruits, recruited, homeBuildQueue, residentCount } = controller.context;
  return <><div className="to-intro"><b>Invite new neighbors to {world.meta.name}.</b> Approved applicants arrive immediately. Their homes are built one per dawn, in queue order.</div>
    <div className="to-recruits">{recruits.map(({ id, name, title }) => {
      const livesHere = recruited.has(id);
      const queued = homeBuildQueue.indexOf(id);
      const status = queued >= 0 ? `QUEUED ${queued + 1}` : 'HOUSED';
      return <div className={`to-recruit${livesHere ? ' active' : ''}`} key={id}><span className="to-recruit-monogram">{name.split(' ').map((part) => part[0]).join('')}</span><span><b>{name}</b><small>{title}</small></span><UiButton disabled={livesHere} onClick={() => controller.recruit(id)}>{livesHere ? status : 'RECRUIT'}</UiButton></div>;
    })}</div><div className="to-intro"><b>Expand the town limits.</b> Add {TOWN_EXPANSION_TILES} tiles of terrain at one edge, or at every edge.</div><div className="to-brushes" role="group" aria-label="Expand town limits">{[['north', 'NORTH'], ['east', 'EAST'], ['south', 'SOUTH'], ['west', 'WEST'], ['all', 'EVERY SIDE']].map(([direction, label]) => <UiButton key={direction} onClick={() => controller.expand(direction)}>{label} +{TOWN_EXPANSION_TILES}</UiButton>)}</div><div className="to-status" aria-live="polite">{controller.message ?? `${residentCount()} neighbors currently live in town.`}</div></>;
}
function Employment({ controller }) {
  const rows = controller.workerRows();
  const completed = rows.reduce((total, row) => total + row.completedCount, 0);
  const paid = rows.reduce((total, row) => total + row.pay, 0);
  const bbs = controller.context.ammoAvailable();
  return <><div className="to-intro"><b>Every hire is different.</b> Review each worker's pace and specialty, track completed work, or issue a hunter more BBs. Firing costs up to 20 relationship points.</div>
    <div className="to-workforce-summary"><span><b>{rows.length}</b><small>WORKERS</small></span><span><b>{completed}</b><small>JOBS DONE</small></span><span><b>{paid}</b><small>COIN PAID</small></span><span><b>{bbs}</b><small>BBS IN BAG</small></span></div>
    {rows.length ? <div className="to-workers">{rows.map((row) => <article className="to-worker" key={row.id}><header><span className="to-recruit-monogram">{row.name.split(' ').map((part) => part[0]).join('')}</span><span><b>{row.name}</b><small>{row.job}</small></span><UiButton title="Firing damages this relationship" onClick={() => controller.dismissWorker(row.id)}>FIRE</UiButton></header><dl><div><dt>Current status</dt><dd>{row.status}</dd></div><div><dt>Completed work</dt><dd>{row.completed}</dd></div><div><dt>Movement pace</dt><dd>{row.speedPercent}%</dd></div><div><dt>{row.specialtyLabel}</dt><dd>{row.specialtyValue}</dd></div><div><dt>Hiring pay</dt><dd>{row.pay} coin</dd></div><div><dt>{row.supplyLabel}</dt><dd>{row.supplyValue}</dd></div></dl>{row.jobId === 'hunter' && <div className="to-worker-actions"><span>{bbs} BBs available</span><UiButton disabled={bbs < 10} onClick={() => controller.supplyWorker(row.id, 10)}>GIVE 10</UiButton><UiButton disabled={bbs < 1} onClick={() => controller.supplyWorker(row.id, 'all')}>GIVE ALL</UiButton></div>}</article>)}</div> : <div className="to-workers-empty"><b>No active workers</b><span>Hire a resident and their record will appear here.</span></div>}
    <div className="to-status" aria-live="polite">{controller.message ?? 'Worker status updates while this desk is open.'}</div></>;
}
const CHEATS = [['money', 'Unlimited money', 'Purchases and investments cost no coin.'], ['ammo', 'Unlimited ammo', 'Guns fire without ammunition in the bag.'], ['invulnerable', 'No damage', 'Hostile BBs still land, but remove no hearts.']];
const ACTIONS = [['tools', 'Give every tool', 'Add every missing tool the bag can hold.', 'GRANT'], ['heal', 'Restore health', 'Refill every heart immediately.', 'HEAL'], ['house', 'Max out home', 'Approve all three stories without payment.', 'BUILD']];
function Cheats({ controller }) {
  const cheats = controller.context.cheats;
  return <><div className="to-intro"><b>Rules are optional in this office.</b> Toggle persistent cheats or issue one-time grants for this save.</div><div className="to-cheats">
    {CHEATS.map(([key, title, detail]) => <UiButton key={key} className={`to-cheat${cheats[key] ? ' active' : ''}`} onClick={() => controller.cheat(key)}><span><b>{title}</b><small>{detail}</small></span><strong>{cheats[key] ? 'ON' : 'OFF'}</strong></UiButton>)}
    {ACTIONS.map(([action, title, detail, verb]) => <UiButton key={action} className="to-cheat" onClick={() => controller.cheat(undefined, action)}><span><b>{title}</b><small>{detail}</small></span><strong>{verb}</strong></UiButton>)}
  </div><div className="to-status" aria-live="polite">{controller.message ?? 'The Office of Cheats accepts no responsibility for consequences.'}</div></>;
}
export function TownOfficeView({ controller }) {
  const title = controller.office === 'planner' ? 'The Urban Planner' : controller.office === 'wildlife' ? 'Fish & Wildlife' : controller.office === 'mayor' ? 'Resident Services' : controller.office === 'employment' ? 'Worker Records' : 'Office of Cheats';
  const kicker = controller.office === 'employment' ? 'Employment Office' : 'Town Hall';
  const content = controller.office === 'planner' ? <Planner controller={controller} /> : controller.office === 'wildlife' ? <Wildlife controller={controller} /> : controller.office === 'mayor' ? <Residents controller={controller} /> : controller.office === 'employment' ? <Employment controller={controller} /> : <Cheats controller={controller} />;
  return <div className="town-office" data-office={controller.office ?? undefined} hidden={!controller.open}><section className="to-card" role="dialog" aria-modal="false" aria-labelledby="to-title"><header className="to-head"><div><div className="to-kicker">{kicker}</div><h2 id="to-title">{title}</h2></div><UiButton className="to-close" onClick={() => controller.close()}>Close</UiButton></header><div className="to-body">{controller.context && content}</div><footer className="to-foot">Changes take effect immediately and are kept with this town. <b>Esc</b> closes the desk.</footer></section></div>;
}
