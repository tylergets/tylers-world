/** Persistent, event-driven work accepted from NPCs. */

const keyOf = (npcId, id) => `${npcId}:${id}`;

function matches(objective, event) {
  if (objective.kind !== event.kind) return false;
  if (objective.item && objective.item !== event.item) return false;
  if (objective.fixture && objective.fixture !== event.fixture) return false;
  if (objective.change && objective.change !== event.change) return false;
  if (objective.category && objective.category !== event.category) return false;
  return true;
}

export class Errands {
  constructor(relationships) {
    this.relationships = relationships;
    this.definitions = new Map();
    this.states = new Map();
    this.version = 0;
  }

  register(npc) {
    for (const errand of npc.errands ?? []) {
      this.definitions.set(keyOf(npc.id, errand.id), { ...errand, npcId: npc.id, npcName: npc.name });
    }
  }

  state(npcId, id) {
    return this.states.get(keyOf(npcId, id)) ?? { status: 'available', progress: 0, events: [] };
  }

  status(npcId, id) {
    const state = this.state(npcId, id);
    if (state.status === 'active') {
      const goal = this.definitions.get(keyOf(npcId, id))?.objective.count ?? 1;
      if (state.progress >= goal) return 'ready';
    }
    return state.status;
  }

  accept(npcId, id) {
    const key = keyOf(npcId, id);
    if (!this.definitions.has(key) || this.status(npcId, id) !== 'available') return false;
    this.states.set(key, { status: 'active', progress: 0, events: [] });
    this.version++;
    return true;
  }

  record(event) {
    if (!event?.kind) return 0;
    let advanced = 0;
    for (const [key, state] of this.states) {
      if (state.status !== 'active') continue;
      const definition = this.definitions.get(key);
      if (!definition || !matches(definition.objective, event)) continue;
      if (event.token && state.events.includes(event.token)) continue;
      if (event.token) state.events.push(event.token);
      state.progress = Math.min(definition.objective.count, state.progress + (event.count ?? 1));
      advanced++;
    }
    if (advanced) this.version++;
    return advanced;
  }

  complete(npc, id, ctx) {
    const key = keyOf(npc.id, id);
    if (this.status(npc.id, id) !== 'ready') return false;
    const definition = this.definitions.get(key);
    if (!definition || !this.canComplete(npc.id, id, ctx.inventory)) return false;
    const state = this.states.get(key);
    state.status = 'completed';
    const reward = definition.reward ?? {};
    if (reward.coins) ctx.purse.earn(reward.coins);
    if (reward.item) ctx.inventory.add(reward.item.type, reward.item.count);
    if (reward.relationship) this.relationships.reward(npc.id, reward.relationship);
    this.version++;
    return true;
  }

  canComplete(npcId, id, inventory) {
    if (this.status(npcId, id) !== 'ready') return false;
    const item = this.definitions.get(keyOf(npcId, id))?.reward?.item;
    return !item || inventory.room(item.type) >= item.count;
  }

  summary() {
    for (const [key, state] of this.states) {
      if (state.status !== 'active') continue;
      const d = this.definitions.get(key);
      if (d) return `${d.npcName}: ${d.title} · ${state.progress}/${d.objective.count}`;
    }
    return null;
  }

  snapshot() {
    return Object.fromEntries([...this.states].map(([key, state]) => [key, {
      status: state.status,
      progress: state.progress,
      events: [...state.events],
    }]));
  }

  restore(snap) {
    this.states.clear();
    for (const [key, state] of Object.entries(snap ?? {})) {
      if (!state || !['active', 'completed'].includes(state.status)) continue;
      this.states.set(key, {
        status: state.status,
        progress: Math.max(0, state.progress | 0),
        events: Array.isArray(state.events) ? [...new Set(state.events.filter((e) => typeof e === 'string'))] : [],
      });
    }
    this.version++;
  }
}
