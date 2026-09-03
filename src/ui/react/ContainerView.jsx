import { useEffect, useRef } from 'react';
import { itemType } from '../../world/itemTypes.js';
import { itemIcon } from '../icons.js';
import { Svg, cssColor } from './Svg.jsx';
import { UiButton } from './UiButton.jsx';

const DRAG_TYPE = 'application/x-tylers-world-stack';

function Slot({ controller, side, index, stack }) {
  const dragged = useRef(false);
  const type = stack ? itemType(stack.typeId) : null;
  const icon = stack ? itemIcon(stack.typeId) : null;
  const label = stack
    ? `${type.label}, ${stack.count}. Move to ${side === 'bag' ? 'container' : 'bag'}.`
    : `Empty ${side} slot ${index + 1}`;
  const start = (event) => {
    if (!stack) return;
    dragged.current = true;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ side, index, generation: controller.generation }));
  };
  const drop = (event) => {
    event.preventDefault();
    try {
      const source = JSON.parse(event.dataTransfer.getData(DRAG_TYPE));
      if (source.generation === controller.generation) controller.transfer(source.side, source.index, side, index);
    } catch { /* Foreign or stale drag: leave both inventories untouched. */ }
  };
  return <UiButton className={`container-slot slot${stack ? '' : ' empty'}`} draggable={!!stack}
    aria-label={label} title={stack ? `${type.label} × ${stack.count}` : label}
    onDragStart={start} onDragEnd={() => setTimeout(() => { dragged.current = false; }, 0)}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
    onDrop={drop} onClick={() => stack && !dragged.current && controller.transferFirst(side, index)}>
    {stack && (icon ? <Svg html={icon} /> : <span className="chip" style={{ background: cssColor(type.swatch) }} />)}
    {stack && <span className="tally">{stack.count}</span>}
  </UiButton>;
}

function Grid({ controller, side, title }) {
  const slots = controller.slots(side);
  return <section className="container-side" aria-labelledby={`container-${side}-title`}>
    <h2 id={`container-${side}-title`}>{title}</h2>
    <div className={`container-grid container-grid-${side}`}>
      {slots.map((stack, index) => <Slot key={index} controller={controller} side={side} index={index} stack={stack} />)}
    </div>
  </section>;
}

export function ContainerView({ controller }) {
  const dialog = useRef(null);
  const config = controller.config();
  const represented = controller.representedTypes();
  useEffect(() => {
    if (controller.open) dialog.current?.focus();
  }, [controller.open, controller.generation]);
  return <div className="container-panel" hidden={!controller.open}>
    <div className="container-card" role="dialog" aria-modal="false" aria-labelledby="container-title"
      aria-describedby="container-help" tabIndex="-1" ref={dialog}>
      <header className="container-head"><h1 id="container-title">{config.name ?? controller.context?.label ?? 'Storage'}</h1>
        <UiButton className="container-close" onClick={() => controller.close()}>Close</UiButton></header>
      <section className="container-settings" aria-label="Container settings">
        <label className="container-name"><span>Name</span><input type="text" maxLength="40"
          placeholder="Name this container" value={controller.nameDraft}
          onChange={(event) => controller.setNameDraft(event.target.value)} onBlur={() => controller.commitName()}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); controller.commitName(); event.currentTarget.blur(); } }} /></label>
        <fieldset className="container-filter"><legend>Picker-upper allow-list</legend>
          <label><input type="checkbox" checked={config.allow === null}
            onChange={(event) => controller.setUnfiltered(event.target.checked)} /> Accept any item type</label>
          {represented.length > 0 && <div className="container-filter-types">
            {represented.map((typeId) => <label key={typeId}><input type="checkbox"
              disabled={config.allow === null} checked={config.allow?.includes(typeId) ?? false}
              onChange={(event) => controller.toggleType(typeId, event.target.checked)} /> {itemType(typeId).label}</label>)}
          </div>}
          <small>{represented.length
            ? 'Uncheck “any” to choose which of these item types workers may put here.'
            : 'Put an item type in this container to add its checkbox.'}</small>
        </fieldset>
      </section>
      <div className="container-columns">
        <Grid controller={controller} side="container" title="Container" />
        <Grid controller={controller} side="bag" title="Bag" />
      </div>
      <p className="container-help" id="container-help">Drag a stack, or click/tap it, to move it. Named containers can be assigned to shopkeepers. <b>E</b> / <b>Esc</b> closes.</p>
    </div>
  </div>;
}
