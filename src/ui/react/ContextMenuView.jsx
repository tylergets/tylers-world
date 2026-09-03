import { UiButton } from './UiButton.jsx';

export function ContextMenuView({ game, version }) {
  void version;
  const menu = game.contextMenu;
  if (!menu) return null;

  const width = 220;
  const height = 39 + menu.actions.length * 37;
  const left = Math.max(8, Math.min(menu.x + 8, innerWidth - width - 8));
  const top = Math.max(8, Math.min(menu.y + 8, innerHeight - height - 8));

  return <div className="context-menu" role="menu" aria-label={`Actions for ${menu.title}`}
    style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>
    <div className="context-title">{menu.title}</div>
    {menu.actions.map((action) => <UiButton key={action.id} role="menuitem"
      className="context-action" disabled={action.disabled}
      title={action.reason ?? undefined} onClick={() => game.chooseContextAction(action.id)}>
      <span>{action.label}</span>{action.reason && <small>{action.reason}</small>}
    </UiButton>)}
  </div>;
}
