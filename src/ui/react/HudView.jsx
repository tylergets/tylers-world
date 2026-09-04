import { DIR_NAME, DIR_VEC } from '../../core/constants.js';
import { objectType } from '../../world/objectTypes.js';
import { itemType } from '../../world/itemTypes.js';
import { POCKET_COUNT } from '../../sim/Inventory.js';
import { fullDateLabel } from '../../sim/Clock.js';
import { PORTAL } from '../../world/World.js';
import { WEATHER_KINDS, weatherOn } from '../../world/weather.js';
import { itemIcon } from '../icons.js';
import { Svg, cssColor } from './Svg.jsx';
import { UiButton } from './UiButton.jsx';

const title = (value) => value ? value[0].toUpperCase() + value.slice(1) : '';
const DEBUG = [['tile', 'tile'], ['pos', 'pos'], ['ground', 'ground'], ['elev', 'elev'], ['facing', 'facing'], ['control', 'control']];
const PROMPTS = [['here', 'here'], ['zone', 'floor'], ['item', 'take'], ['plant', 'tend'], ['furniture', 'use'], ['mailbox', 'mail'], ['tool', 'use'], ['fixture', 'use'], ['npc', 'talk'], ['corpse', 'help'], ['errand', 'errand'], ['portal', ''], ['note', '']];
const PERF = [['fps', 'fps'], ['frame', 'frame'], ['cpusim', 'cpu sim'], ['cpudraw', 'cpu draw'], ['views', '· our nodes'], ['submit', '· three'], ['cpumap', 'cpu map'], ['gpu', 'gpu'], ['calls', 'draws'], ['tris', 'tris'], ['programs', 'programs'], ['geoms', 'geometries'], ['shadows', 'shadows'], ['render', 'render']];

function rowsFor(game) {
  if (!game?.world || !game.player) return { debug: {}, prompts: {}, perf: {} };
  const { player, world, stage } = game, tx = player.tileX, tz = player.tileZ;
  const obj = world.objectAt(tx, tz), what = game.interaction?.() ?? null;
  const item = what?.kind === 'take' ? what.item : null, npc = what?.kind === 'talk' ? what.npc : null;
  const corpse = what?.kind === 'corpse' ? what.npc : null;
  const fixture = what?.kind === 'use' ? what.fixture : null, furniture = what?.kind === 'furniture' ? what.object : null;
  const plant = what?.kind === 'plant' ? what : null, tool = game.toolAction?.() ?? null;
  const zone = world.zoneAt?.(tx, tz) ?? null, mine = zone && player.friends.has(zone.owner);
  const friends = player.friends, angry = npc && friends.hates(npc.id);
  const mood = !npc ? '' : angry ? ' · angry' : friends.tier(npc.id) !== 'stranger' ? ` · ${friends.tier(npc.id)}` : '';
  const furnitureVerb = what?.action === 'sleep' ? 'sleep'
    : what?.action === 'sit' ? 'sit'
      : what?.action === 'warm' ? 'warm up'
        : what?.action === 'lean' ? 'lean'
          : what?.action === 'store' ? 'open' : 'use';
  const v = DIR_VEC[player.facing], portal = world.portalAt(tx + v.x, tz + v.z), notice = game.notice;
  const info = stage.renderer.info.render;
  return {
    debug: { tile: `${tx}, ${tz}`, pos: `${player.x.toFixed(2)}, ${player.z.toFixed(2)}`, ground: world.surfaceAt(tx, tz).name, elev: world.elevationAt(tx, tz) + (world.isRamp(tx, tz) ? ' · ramp' : ''), facing: DIR_NAME[player.facing], control: game.input.name === 'grid' ? 'grid step' : 'free walk' },
    prompts: {
      here: [obj ? obj.props?.label ?? objectType(obj.type).label : null],
      zone: [zone ? `${zone.label ?? zone.owner}${mine ? ' · welcome' : ''}` : null],
      item: [item ? item.type.label : null, item && player.inventory.isFullFor(item.typeId) ? 'full' : 'take'],
      plant: [plant ? plant.blocked ?? plant.label : null, plant?.action === 'sow' ? 'sow' : plant?.action === 'harvest' ? 'harvest' : 'growing'],
      furniture: [furniture ? objectType(furniture.type).label : null, furnitureVerb],
      mailbox: [what?.kind === 'mailbox' ? what.label : null, 'open'],
      fixture: [fixture ? objectType(fixture.object.type).label : null, fixture ? fixture.label : 'use'],
      npc: [npc ? `${npc.name}${mood}${npc.activity ? ` · ${npc.activity}` : ''}` : null, npc?.shop && !angry ? npc.shopAvailable ? 'trade' : 'closed' : 'talk'],
      corpse: [corpse ? `${corpse.name} · dead` : null, 'take to hospital'],
      errand: [game.errands?.summary() ?? null],
      portal: [portal?.label ?? null, portal?.kind === PORTAL.EXIT ? 'leave' : 'enter'],
      note: [notice && game.time < notice.until ? notice.text : null],
      tool: [tool ? tool.blocked ?? `${tool.label}${tool.hits ? ` · ${tool.hits} of ${tool.swings}` : ''}` : null, tool?.verb],
    },
    perf: { fps: Math.round(game.fps), frame: `${game.fps ? (1000 / game.fps).toFixed(1) : '--'} ms`, cpusim: `${game.msUpdate.toFixed(2)} ms`, cpudraw: `${game.msRender.toFixed(2)} ms`, views: `${game.msViews.toFixed(2)} ms`, submit: `${game.msSubmit.toFixed(2)} ms`, cpumap: `${game.msMap.toFixed(2)} ms`, gpu: stage.gpuMs > 0 ? `${stage.gpuMs.toFixed(2)} ms` : 'n/a', calls: info.calls, tris: info.triangles.toLocaleString(), programs: stage.renderer.info.programs?.length ?? '?', geoms: stage.renderer.info.memory.geometries, shadows: stage.renderer.shadowMap.enabled ? 'on' : 'off', render: `${stage.resolution.x}×${stage.resolution.y} @ ${stage.quality.toFixed(2)}` },
  };
}
function Rows({ defs, values, prompts = false }) {
  return defs.map(([id, base]) => {
    const entry = prompts ? values[id] ?? [null] : [values[id]];
    if (entry[0] == null) return null;
    return <div className="row" key={id}><span className="k">{entry[1] ?? base}</span><span className="v">{entry[0]}</span></div>;
  });
}
function Setting({ label, value, hotkey, onClick, title: tooltip }) {
  return <UiButton className="view-toggle" title={tooltip} onClick={onClick}><span className="vt-label">{label}</span><span className="vt-key">{value ?? hotkey}</span></UiButton>;
}
function Settings({ hud }) {
  const c = hud.callbacks;
  return <div className="settings" hidden={!hud.settingsOpen}><div className="set-title">View blend</div><div className="morph"><span className="morph-end">3D</span><input type="range" id="hud-scrub" min="0" max="1000" step="1" defaultValue="0" aria-label="View morph" ref={hud.attachScrub} onInput={(e) => hud.scrubTo(e.currentTarget.value / 1000)} onMouseUp={(e) => e.currentTarget.blur()} /><span className="morph-end">2D</span></div>
    <Setting label="First person" value={hud.game?.firstPerson ? 'On' : 'Off'} hotkey="V" title="Mouse-look from the player's point of view. Click the world to capture the mouse." onClick={c.onFirstPerson} />
    <div className="set-title">Video</div><Setting label="Quality" value={title(hud.quality)} title="Low, Medium or High -- sets resolution, shadows, water and antialiasing together" onClick={c.onQuality} /><Setting label="Resolution" value={hud.resolution} title="How many pixels the frame is drawn at. Lower is faster and softer." onClick={c.onResolution} /><Setting label="Shadows" value={title(hud.shadows)} title="The sun's cast shadows. Off is the biggest single saving here." onClick={c.onShadows} /><Setting label="Antialiasing" value={title(hud.antialias) + (hud.antialiasNote ?? '')} title="Smooths jagged edges. Takes effect on the next reload." onClick={c.onAntialias} /><Setting label="Water" value={title(hud.water)} title="Still, rippling, or a full sunlit surface with glints and reflections" onClick={c.onWater} /><Setting label="Shoreline" value={hud.shoreline === 'natural' ? 'Natural' : 'Blocky'} title="Blend sand into shallow water with wet sand and foam" onClick={c.onShoreline} />
    <div className="set-title">World</div><Setting label="On death" value={hud.deathPenalty} title="What happens to your pockets when you run out of hearts: keep them, drop them where you fell, or lose them." onClick={c.onDeath} /><Setting label="Unstuck" title="Return to this place's safe arrival point" onClick={c.onUnstuck} />
    <div className="set-title">Options</div><Setting label={`Voice  ${hud.voice}`} hotkey="M" onClick={c.onVoice} /><Setting label={`Map  ${hud.mapMode}`} hotkey="N" onClick={() => c.onMap()} /><Setting label={`Readouts  ${hud.showPerf ? 'on' : 'off'}`} hotkey="P" onClick={() => hud.togglePerf()} /><Setting label={`Keymap  ${hud.keysOpen ? 'on' : 'off'}`} hotkey="K" onClick={() => hud.toggleKeys()} /><Setting label="Worlds & saves" hotkey="O" onClick={c.onWorlds} />
  </div>;
}
function Slot({ inv, index }) {
  const slot = inv.slots[index], selected = index === inv.selected;
  if (!slot) return <UiButton className={`slot empty${selected ? ' on' : ''}`} onClick={() => inv.select(index)} />;
  const type = itemType(slot.typeId), icon = itemIcon(slot.typeId);
  return <UiButton className={`slot${selected ? ' on' : ''}`} title={type.label} onClick={() => inv.select(index)}>{icon ? <Svg html={icon} /> : <span className="chip" style={{ background: cssColor(type.swatch) }} />}<span className="tally">{slot.count}</span></UiButton>;
}
function Inventory({ hud, game }) {
  const inv = game.player.inventory, held = inv.held;
  return <div className="hud hud-br"><div className="bag-head"><span className="bag-title">Pockets</span><span className="bag-held">{held ? `${itemType(held.typeId).label} ${held.count}` : 'empty'}</span><span className="bag-coins">{game.player.purse.coins} coin</span></div>{hud.bagOpen && <div className="pack">{inv.slots.map((_, i) => <Slot key={i} inv={inv} index={i} />)}</div>}<div className="bag-row"><div className="bag">{inv.slots.slice(0, POCKET_COUNT).map((_, i) => <Slot key={i} inv={inv} index={i} />)}</div><UiButton className={`bag-btn${hud.bagOpen ? ' on' : ''}${!hud.bagOpen && inv.selected >= POCKET_COUNT ? ' sel' : ''}`} title="Open bag" aria-label="Open bag" aria-expanded={hud.bagOpen} onClick={() => hud.toggleBag()}>🎒</UiButton></div></div>;
}
function Keymap({ open }) { return <div className="hud hud-bl" hidden={!open}><div className="keys"><b>WASD</b><span>Move <span className="dim">or arrows</span></span><b>Shift</b><span>Run</span><b>Click</b><span>Choose action <span className="dim">· capture mouse in first person</span></span><b>V</b><span>First person <span className="dim">· mouse-look</span></span><b>Tab</b><span>Switch 3D / 2D</span><b>, .</b><span>Turn camera <span className="dim">snaps in 2D</span></span><b>E</b><span>Talk <span className="dim">·</span> pick up <span className="dim">·</span> enter</span><b>Q</b><span>Drop</span><b>F</b><span>Use tool <span className="dim">·</span> the row above says what</span><b>[ ]</b><span>Change tool</span><b>B</b><span>Open bag</span><b>G</b><span>Wardrobe</span><b>K</b><span>Hide this keymap</span><b>Esc</b><span>Release mouse <span className="dim">·</span> cancel</span></div></div>; }

export function HudView({ controller: hud, game }) {
  const model = rowsFor(game), player = game.player, world = game.world;
  const promptCount = Object.values(model.prompts).filter(([value]) => value != null).length;
  const weather = weatherOn(world, player.clock.day), trespass = game.trespass;
  const clock = `${fullDateLabel(player.clock.day)}  ·  ${player.clock.label}${weather ? `  ·  ${WEATHER_KINDS[weather].label}` : ''}`;
  const full = player.health?.full ?? true;
  const viewLabel = game.firstPerson
    ? `First Person${game.firstPersonLocked ? '' : ' · click to look'}`
    : game.viewT < .5 ? '3D  Overworld' : '2D  Map';
  return <><div className="hud hud-tl"><div className="panel-head"><div id="hud-place"><div className="world-name">{world.meta.name ?? 'World'}</div>{hud.indoors && <div className="place-note">Inside</div>}<div className="place-note">{clock}</div></div><UiButton className={`gear${hud.settingsOpen ? ' on' : ''}`} title="Settings" aria-label="Settings" aria-expanded={hud.settingsOpen} onClick={() => hud.toggleSettings()}>⚙</UiButton></div><UiButton className="view-toggle" onClick={hud.callbacks.onToggle}><span className="vt-label">{viewLabel}</span><span className="vt-key">Tab</span></UiButton><Settings hud={hud} /></div>
    <div className="hud hud-tc warn" hidden={!trespass}><span className="warn-tag">Trespassing</span><span className="warn-where">{trespass?.zone.label ?? trespass?.zone.owner}</span><span className="warn-clock">{trespass ? trespass.stuck ? 'you should not be here' : `${Math.max(0, Math.ceil(game.trespassGrace - trespass.t))}s` : ''}</span></div>
    <div className="hud hud-hearts hearts" hidden={full}>{!full && Array.from({ length: player.health.max }, (_, i) => <span className={`heart${i < player.health.hearts ? '' : ' gone'}`} key={i}>♥</span>)}</div>
    <div className="hud-col"><div className="hud map-card" hidden={hud.mapMode === 'off'} onClick={() => hud.callbacks.onMap(true)}><canvas id="hud-map-canvas" ref={hud.attachMap} /><span className="map-north">N</span><span className="map-mode">{hud.mapMode === 'place' ? 'all' : hud.mapMode}</span></div><UiButton className="hud go-home" disabled={!hud.homeReady} title={hud.homeReady ? `Walk to ${hud.homeName ?? 'your house'}` : 'No home to walk to here'} onClick={() => hud.callbacks.onGoHome?.()}><span className="go-home-icon">🏠</span><span className="go-home-label">Go home</span></UiButton><div className="hud hud-tr" hidden={!hud.showPerf && !promptCount}>{hud.showPerf && <><div><Rows defs={DEBUG} values={model.debug} /></div><div className="hud-sep" /></>}<div><Rows defs={PROMPTS} values={model.prompts} prompts /></div>{hud.showPerf && <><div className="hud-sep" hidden={!promptCount} /><div><Rows defs={PERF} values={model.perf} /></div><div className="gpu-name">{game.stage.gpu}</div></>}</div></div>
    <Inventory hud={hud} game={game} /><Keymap open={hud.keysOpen} /></>;
}
