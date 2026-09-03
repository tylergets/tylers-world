import { UiButton } from './UiButton.jsx';

export function PhotoView({ controller }) {
  const shot = controller.roll[controller.at];
  return <div className="photoview" hidden={!controller.open}>
    <div className="pv-card" role="dialog" aria-modal="false" aria-label="Photo">
      <div className="pv-head">
        <span className="pv-title" id="pv-caption">{shot?.caption}</span>
        <span className="pv-count" id="pv-count">{controller.roll.length > 1 ? `${controller.at + 1} of ${controller.roll.length}` : ''}</span>
        <span className="pv-spacer" />
        <UiButton className="pv-btn" id="pv-prev" aria-label="Older" onClick={() => controller.step(1)}>‹</UiButton>
        <UiButton className="pv-btn" id="pv-next" aria-label="Newer" onClick={() => controller.step(-1)}>›</UiButton>
        <UiButton className="pv-btn" id="pv-save" onClick={() => controller.save()}>Save</UiButton>
        <UiButton className="pv-btn pv-close" id="pv-close" onClick={() => controller.close()}>Close</UiButton>
      </div>
      <div className="pv-frame"><img id="pv-img" src={shot?.url} alt="The picture you took" /></div>
      <div className="pv-foot"><b>← →</b> flip through the roll <span className="pv-dim">·</span> <b>Esc</b> put the camera down</div>
    </div>
  </div>;
}
