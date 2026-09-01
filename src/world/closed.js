import { parseDialog } from './dialog.js';

/** Generic replacement conversation while a clock-controlled shop is shut. */
export function closedFor(npc) {
  const hours = npc.shopHours;
  const open = hours ? `${String(hours.open).padStart(2, '0')}:00` : 'later';
  return parseDialog({
    start: 'closed',
    nodes: {
      closed: {
        text: `${npc.shop.name} is closed. Doors open at ${open}.`,
        choices: [{ text: 'I will come back.', to: 'end' }],
      },
    },
  }, `closed shop ${npc.id}`);
}
