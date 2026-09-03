import { itemIcon } from '../icons.js';
import { WEAR_SLOTS, SLOT_LABEL } from '../../sim/Outfit.js';
import { Svg, cssColor } from './Svg.jsx';
import { UiButton } from './UiButton.jsx';

function Art({ row }) {
  const icon = itemIcon(row.typeId);
  return icon ? <Svg html={icon} /> : <i className="wr-chip" style={{ background: cssColor(row.type.swatch) }} />;
}
export function WardrobeView({ controller }) {
  const outfit = controller.ctx?.outfit;
  const count = outfit ? WEAR_SLOTS.filter((slot) => outfit.get(slot)).length : 0;
  const choices = controller.rows.some((row) => !row.header);
  const chosen = controller.rows[controller.at];
  return <div className="wardrobe" hidden={!controller.open}>
    <div className="wr-card" role="dialog" aria-modal="false" aria-label="Wardrobe">
      <div className="wr-head"><span className="wr-title">Wardrobe</span><span className="wr-count" id="wr-count">{count} of {WEAR_SLOTS.length} worn</span><span className="wr-spacer" /><UiButton className="wr-btn wr-close" onClick={() => controller.close()}>Close</UiButton></div>
      <div className="wr-list" id="wr-list">
        {choices ? controller.rows.map((row, index) => row.header
          ? <div className="wr-group" key={`${row.slot}-head`}>{SLOT_LABEL[row.slot]}</div>
          : <UiButton key={`${row.slot}-${row.typeId}-${row.from ?? 'worn'}`} className={`wr-row${index === controller.at ? ' is-at' : ''}${row.worn ? ' is-worn' : ''}`} onClick={() => controller.select(index)}>
              <span className="wr-art"><Art row={row} /></span><span className="wr-name">{row.type.label}</span><span className="wr-tag">{row.worn ? 'worn' : 'in your bag'}</span>
            </UiButton>)
          : <div className="wr-empty">Nothing to wear yet. The clothes shop puts a rail out every morning.</div>}
      </div>
      <div className="wr-foot"><b>↑ ↓</b> choose <span className="wr-dim">·</span> <b>E</b> {chosen?.worn ? 'take off' : 'put on'} <span className="wr-dim">·</span> <b>Esc</b> close</div>
    </div>
  </div>;
}
