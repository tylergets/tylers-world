import { withMenuChoice } from '../world/dialog.js';

export const PURCHASE_INTERVALS = Object.freeze({
  1: 'Every morning',
  7: 'Every 7 days',
});

/** Persistent agreements between shopkeepers and named player storage. */
export class Logistics {
  constructor() {
    this.schedules = new Map();
    this.version = 0;
  }

  get(npcId) { return this.schedules.get(npcId) ?? null; }

  shopForContainer(worldId, containerId, exceptNpcId = null) {
    return [...this.schedules.values()].find((schedule) => schedule.npcId !== exceptNpcId
      && schedule.containerWorldId === worldId && schedule.containerId === containerId) ?? null;
  }

  configure(npcId, shopWorldId, container, intervalDays, today) {
    if (typeof npcId !== 'string' || typeof shopWorldId !== 'string' || !container?.name
      || !PURCHASE_INTERVALS[intervalDays]
      || this.shopForContainer(container.worldId, container.containerId, npcId)) return false;
    this.schedules.set(npcId, {
      npcId,
      shopWorldId,
      containerWorldId: container.worldId,
      containerId: container.containerId,
      containerName: container.name,
      placeName: container.placeName ?? 'Storage',
      intervalDays,
      nextDay: Math.max(1, Math.floor(today) + intervalDays),
      last: null,
    });
    this.version++;
    return true;
  }

  disable(npcId) {
    if (!this.schedules.delete(npcId)) return false;
    this.version++;
    return true;
  }

  /** Settle every due agreement whose shop and container have been loaded. */
  settle(today, purse, resolveShop, resolveContainer) {
    const results = [];
    for (const schedule of this.schedules.values()) {
      if (schedule.nextDay > today) continue;
      const shop = resolveShop(schedule);
      const edits = resolveContainer(schedule);
      // Lazy place state stays lazy. The due purchase catches up as soon as
      // entering either place makes both ends of the agreement available.
      if (!shop || !edits) continue;
      const config = edits.containerConfig(schedule.containerId);
      if (!config?.name) {
        this.schedules.delete(schedule.npcId);
        const result = { ok: false, reason: 'container unavailable' };
        results.push({ schedule, result });
        this.version++;
        continue;
      }
      schedule.containerName = config.name;
      const result = shop.buyStored(edits, schedule.containerId, purse);
      schedule.nextDay += (Math.floor((today - schedule.nextDay) / schedule.intervalDays) + 1)
        * schedule.intervalDays;
      schedule.last = {
        day: today,
        ok: result.ok,
        quantity: result.quantity ?? 0,
        coins: result.coins ?? 0,
        reason: result.reason ?? null,
      };
      results.push({ schedule, result });
      this.version++;
    }
    return results;
  }

  snapshot() {
    return [...this.schedules.values()].map((schedule) => ({
      ...schedule,
      last: schedule.last ? { ...schedule.last } : null,
    }));
  }

  restore(rows) {
    this.schedules.clear();
    for (const row of rows ?? []) {
      if (!row || typeof row.npcId !== 'string' || typeof row.shopWorldId !== 'string'
        || typeof row.containerWorldId !== 'string' || typeof row.containerId !== 'string'
        || typeof row.containerName !== 'string' || !PURCHASE_INTERVALS[row.intervalDays]
        || !Number.isInteger(row.nextDay) || row.nextDay < 1) continue;
      this.schedules.set(row.npcId, {
        npcId: row.npcId,
        shopWorldId: row.shopWorldId,
        containerWorldId: row.containerWorldId,
        containerId: row.containerId,
        containerName: row.containerName.slice(0, 40),
        placeName: typeof row.placeName === 'string' ? row.placeName : 'Storage',
        intervalDays: row.intervalDays,
        nextDay: row.nextDay,
        last: row.last && Number.isInteger(row.last.day) ? {
          day: row.last.day,
          ok: row.last.ok === true,
          quantity: Math.max(0, row.last.quantity | 0),
          coins: Math.max(0, row.last.coins | 0),
          reason: typeof row.last.reason === 'string' ? row.last.reason : null,
        } : null,
      });
    }
    this.version++;
  }
}

/**
 * Add a shopkeeper-owned setup flow to an ordinary parsed conversation.
 *
 * The line goes on the keeper's MENU -- "What'll it be?" -- through
 * world/dialog.js `withMenuChoice`, not on `start`, which for every shop in
 * the game is a branch picking the opening line. Applied before the greeting
 * is stitched on, so it is where the trade line is and not on the hello.
 */
export function withLogisticsChat(script, schedule, containers) {
  if (!script?.nodes || script.nodes['~logistics'] || !script.nodes[script.start]) return script;
  const stitched = withMenuChoice(script, {
    text: schedule ? 'About the pickups from my storage.' : 'Would you buy straight out of my storage?',
    when: null, do: [], to: '~logistics',
  }, "That's all for now.");
  const nodes = stitched.nodes;
  const node = (id, text, choices = []) => ({ id, text: [].concat(text), choices, then: null, do: [] });
  const choice = (text, to, logistics = null) => ({
    text, to, when: null, do: logistics ? [{ logistics }] : [],
  });
  const last = schedule?.last
    ? schedule.last.ok
      ? ` Last time I took ${schedule.last.quantity} item${schedule.last.quantity === 1 ? '' : 's'} and paid you ${schedule.last.coins} coin.`
      : ` Last time I came away with nothing: ${schedule.last.reason}.`
    : '';
  const current = schedule
    ? [
        `We have an arrangement: I clear out "${schedule.containerName}" ${PURCHASE_INTERVALS[schedule.intervalDays].toLowerCase()}, and I'm due there on day ${schedule.nextDay}.${last}`,
        'Want it moved to a different container, or stopped?',
      ]
    : containers.length
      ? 'I can. Point me at one of your named containers and I\'ll come by on a schedule, take whatever is in it that I\'d buy over this counter, and pay you the same as I would here.'
      : 'I could, but I need to know which one. Give one of your storage containers a name -- open it and there\'s a box for it -- and then come and tell me.';
  const rootChoices = containers.map((container, index) => choice(
    `${container.name} (${container.placeName})`, `~logistics-${index}`,
  ));
  if (schedule) rootChoices.push(choice('Stop the pickups.', '~logistics-disabled', { action: 'disable' }));
  rootChoices.push(choice(schedule ? 'Leave it as it is.' : 'Never mind.', 'end'));
  nodes['~logistics'] = node('~logistics', current, rootChoices);
  containers.forEach((container, index) => {
    const choices = Object.entries(PURCHASE_INTERVALS).map(([days, label]) => choice(
      label, '~logistics-saved', {
        action: 'configure',
        containerWorldId: container.worldId,
        containerId: container.containerId,
        intervalDays: Number(days),
      },
    ));
    choices.push(choice('A different container, actually.', '~logistics'));
    nodes[`~logistics-${index}`] = node(`~logistics-${index}`,
      `"${container.name}", then. How often do you want me round?`, choices);
  });
  nodes['~logistics-saved'] = node('~logistics-saved',
    "Settled. Each visit I'll take what I'd buy anyway, at my usual prices, and the coin goes straight to your purse. You'll get a note when it's done.");
  nodes['~logistics-disabled'] = node('~logistics-disabled', "Fair enough. I'll stop coming round; say the word if you want it back on.");
  return { ...stitched, nodes };
}
