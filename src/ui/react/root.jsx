import { memo, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { HudView } from './HudView.jsx';
import { ChatView } from './ChatView.jsx';
import { WorldsView } from './WorldsView.jsx';
import { WardrobeView } from './WardrobeView.jsx';
import { TownOfficeView } from './TownOfficeView.jsx';
import { MapScreenView } from './MapScreenView.jsx';
import { PhotoView } from './PhotoView.jsx';
import { ContextMenuView } from './ContextMenuView.jsx';
import '../react.css';

let root;
let nextIdentity = 1;
const identities = new WeakMap();
const MemoHud = memo(HudView);
const MemoChat = memo(ChatView);
const MemoWorlds = memo(WorldsView);
const MemoWardrobe = memo(WardrobeView);
const MemoTownOffice = memo(TownOfficeView);
const MemoMapScreen = memo(MapScreenView);
const MemoPhoto = memo(PhotoView);
const MemoContextMenu = memo(ContextMenuView);

function UI({ game }) {
  useSyncExternalStore(game.ui.subscribe, game.ui.getSnapshot);
  return <>
    <MemoHud controller={game.hud} game={game} version={game.hud.version}
      hudTick={game.ui.hudTick} inventoryVersion={game.player.inventory.version}
      purseVersion={game.player.purse.version} healthVersion={game.player.health?.version} />
    <MemoChat controller={game.chat} version={game.chat.version} />
    <MemoWorlds controller={game.worlds} version={game.worlds.version} />
    <MemoWardrobe controller={game.wardrobe} version={game.wardrobe.version} />
    <MemoTownOffice controller={game.townOffice} version={game.townOffice.version}
      faunaVersion={game.townOffice.context?.fauna?.version}
      editsVersion={game.townOffice.context?.edits?.version} />
    <MemoMapScreen controller={game.mapScreen} version={game.mapScreen.version} />
    <MemoPhoto controller={game.photos} version={game.photos.version} />
    <MemoContextMenu game={game} version={game.contextVersion} />
  </>;
}

export function presentUi(game) {
  const host = document.querySelector('#ui-react') ?? Object.assign(document.createElement('div'), { id: 'ui-react' });
  if (!host.isConnected) document.querySelector('#hud').append(host);
  root ??= createRoot(host);
  if (!identities.has(game)) identities.set(game, nextIdentity++);
  // The chat typewriter must own its childless div before gameplay can open a line.
  flushSync(() => root.render(<UI key={identities.get(game)} game={game} />));
}
