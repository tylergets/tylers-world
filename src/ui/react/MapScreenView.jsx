import { MAP_KEY_STEP } from '../mapscreen.js';
import { UiButton } from './UiButton.jsx';

export function MapScreenView({ controller }) {
  return <div className="mapscreen" hidden={!controller.open}>
    <div className="ms-card" role="dialog" aria-modal="false" aria-label="Map">
      <div className="ms-head"><span className="ms-title">{controller.title}</span><span className="ms-zoom" ref={controller.attachZoomLabel} /><span className="ms-spacer" />
        <UiButton className="ms-btn" aria-label="Zoom out" onClick={() => controller.zoomBy(1 / MAP_KEY_STEP)}>−</UiButton>
        <UiButton className="ms-btn" aria-label="Zoom in" onClick={() => controller.zoomBy(MAP_KEY_STEP)}>+</UiButton>
        <UiButton className="ms-btn" onClick={() => controller.fit()}>Fit</UiButton>
        <UiButton className="ms-btn ms-close" onClick={() => controller.close()}>Close</UiButton>
      </div>
      <canvas id="ms-canvas" ref={controller.attachCanvas} />
      <div className="ms-foot"><b>Scroll</b> zoom <span className="ms-dim">·</span> <b>Drag</b> pan <span className="ms-dim">·</span> <b>WASD</b> pan <span className="ms-dim">·</span> <b>+ −</b> zoom <span className="ms-dim">·</span> <b>F</b> follow you <span className="ms-dim">·</span> <b>Esc</b> put it away</div>
    </div>
  </div>;
}
