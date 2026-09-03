import { objectType } from '../world/objectTypes.js';
import { plantType, yieldOf } from '../world/plantTypes.js';
import { angleDelta } from '../core/constants.js';
import { makeRng, range } from '../core/rng.js';
import { sweep, turnToward } from './body.js';
import { canTraverse, findPath, findPathToAny } from './pathfind.js';
import { AMMO, chopDrops, clearLine, killDrops, mineDrops } from './tools.js';
import { withMenuChoice } from '../world/dialog.js';

export const WORKER_JOBS = Object.freeze({
  picker: { label: 'Picker-Upper', cost: 100 },
  farmer: { label: 'Farmer', cost: 150 },
  lumberjack: { label: 'Lumberjack', cost: 200 },
  miner: { label: 'Miner', cost: 225 },
  hunter: { label: 'Hunter', cost: 250 },
});
export const HUNTER_INITIAL_BBS = 40;

function workerTraits(npcId, job) {
  return {
    speed: Math.round(range(makeRng(`worker-speed:${npcId}`), 0.85, 1.2) * 100) / 100,
    capacity: job === 'picker' ? 3 + Math.floor(makeRng(`worker-capacity:${npcId}`)() * 13) : null,
    accuracy: job === 'hunter'
      ? Math.round(range(makeRng(`worker-accuracy:${npcId}`), 0.55, 0.95) * 100) / 100 : null,
    efficiency: ['farmer', 'lumberjack', 'miner'].includes(job)
      ? Math.round(range(makeRng(`worker-efficiency:${npcId}`), 0.75, 1.25) * 100) / 100 : null,
  };
}

function workerDetail(worker) {
  const pace = Math.round(worker.traits.speed * 100);
  if (worker.job === 'picker') return `I can carry ${worker.traits.capacity} items and move at ${pace}% pace.`;
  if (worker.job === 'hunter') {
    return `My accuracy is ${Math.round(worker.traits.accuracy * 100)}%, I move at ${pace}% pace, and I have ${worker.ammo} BBs.`;
  }
  return `I work at ${Math.round(worker.traits.efficiency * 100)}% efficiency and move at ${pace}% pace.`;
}

/**
 * Stitch employment choices into an ordinary parsed conversation.
 *
 * The line goes on the person's MENU (world/dialog.js `withMenuChoice`), not
 * on `start`: for nearly everyone `start` is a branch choosing an opening
 * line, and a line glued to the opening would never be seen. Applied before
 * any greeting is stitched on the front, so it lands on their own menu and
 * not on the hello.
 */
export function withWorkerChat(script, worker, hireable) {
  const currentJob = worker?.job ?? null;
  if (!script?.nodes || script.nodes['~employment'] || (!currentJob && !hireable)) return script;

  const stitched = withMenuChoice(script, {
    text: currentJob ? 'About the job I gave you.' : 'Would you take on some paid work?',
    when: null, do: [], to: '~employment',
  }, "That's all for now.");
  const nodes = stitched.nodes;

  const node = (id, text, choices = [], then = null) => ({ id, text: [text], choices, then, do: [] });
  const choice = (text, to, effect = null, when = null) => ({
    text, to, when, do: effect ? [{ work: effect }] : [],
  });

  if (currentJob) {
    const label = WORKER_JOBS[currentJob].label;
    const detail = workerDetail(worker);
    const choices = [
      choice('Carry on as you are.', 'end'),
      choice("I'm ending the job.", '~dismissed', { action: 'dismiss' }),
    ];
    if (currentJob === 'hunter') {
      choices.splice(1, 0,
        choice('Take 10 BBs.', '~supplied', { action: 'supply', count: 10 }, { has: { type: AMMO, count: 10 } }),
        choice('Take my last BB.', '~supplied', { action: 'supply', count: 1 }, {
          all: [{ has: { type: AMMO, count: 1 } }, { not: { has: { type: AMMO, count: 10 } } }],
        }));
      nodes['~supplied'] = node('~supplied', 'Thanks. Those go in the pouch with the rest.');
    }
    nodes['~employment'] = node('~employment', `I'm still on as your ${label}. ${detail} Anything you want changed?`, choices);
    nodes['~dismissed'] = node('~dismissed', "Right you are. I'll down tools and leave it there.");
  } else {
    nodes['~employment'] = node('~employment', "I could use the coin, if it's honest work. What needs doing?", [
      choice('Pick up loose items. (100 coins)', '~hired-picker',
        { action: 'hire', job: 'picker' }, { coins: WORKER_JOBS.picker.cost }),
      choice('Pick up loose items. (100 coins)', '~poor-picker', null,
        { not: { coins: WORKER_JOBS.picker.cost } }),
      choice('Harvest ready crops. (150 coins)', '~hired-farmer',
        { action: 'hire', job: 'farmer' }, { coins: WORKER_JOBS.farmer.cost }),
      choice('Harvest ready crops. (150 coins)', '~poor-farmer', null,
        { not: { coins: WORKER_JOBS.farmer.cost } }),
      choice('Fell trees for wood. (200 coins)', '~hired-lumberjack',
        { action: 'hire', job: 'lumberjack' }, { coins: WORKER_JOBS.lumberjack.cost }),
      choice('Fell trees for wood. (200 coins)', '~poor-lumberjack', null,
        { not: { coins: WORKER_JOBS.lumberjack.cost } }),
      choice('Break rocks for stone. (225 coins)', '~hired-miner',
        { action: 'hire', job: 'miner' }, { coins: WORKER_JOBS.miner.cost }),
      choice('Break rocks for stone. (225 coins)', '~poor-miner', null,
        { not: { coins: WORKER_JOBS.miner.cost } }),
      choice('Hunt animals with an airsoft gun. (250 coins)', '~hired-hunter',
        { action: 'hire', job: 'hunter' }, { coins: WORKER_JOBS.hunter.cost }),
      choice('Hunt animals with an airsoft gun. (250 coins)', '~poor-hunter', null,
        { not: { coins: WORKER_JOBS.hunter.cost } }),
      choice('Nothing just now.', 'end'),
    ]);
    nodes['~hired-picker'] = node('~hired-picker',
      "Done. I'll gather up whatever is lying loose and put it in your storage -- so set out a crate or a shelf with room in it, or I'll have nowhere to put things.");
    nodes['~hired-hunter'] = node('~hired-hunter',
      `Done. I'll go after game with the airsoft gun. The first ${HUNTER_INITIAL_BBS} BBs are on the fee; after that I'll need you to bring me more.`);
    nodes['~hired-farmer'] = node('~hired-farmer',
      "Done. I'll pull anything that's ready in your beds and leave it beside them for you to collect.");
    nodes['~hired-lumberjack'] = node('~hired-lumberjack',
      "Done. I'll fell what trees I can reach and leave the wood where it drops.");
    nodes['~hired-miner'] = node('~hired-miner',
      "Done. I'll break rocks and leave the stone by the rubble for you.");
    for (const job of Object.keys(WORKER_JOBS)) {
      nodes[`~poor-${job}`] = node(`~poor-${job}`,
        `That's ${WORKER_JOBS[job].cost} coin, paid up front, and you're short. Come back with it and I'll start.`);
    }
  }
  return { ...stitched, nodes };
}

const HUNT_RANGE = 6;
const HUNT_RELOAD = 1.9;
const WORK_SECONDS = { farmer: 2, lumberjack: 4, miner: 5 };

/** Persistent hired jobs plus their transient routes and targets. */
export class Workers {
  constructor() {
    this.assignments = new Map();
    this.states = new Map();
    this.version = 0;
  }

  has(npcId) { return this.assignments.has(npcId); }
  job(npcId) { return this.assignments.get(npcId)?.job ?? null; }
  assignment(npcId) { return this.assignments.get(npcId) ?? null; }
  ids() { return new Set(this.assignments.keys()); }

  supplyAmmo(npcId, count) {
    const assignment = this.assignments.get(npcId);
    if (assignment?.job !== 'hunter' || !Number.isSafeInteger(count) || count < 1) return false;
    assignment.ammo += count;
    this.version++;
    return true;
  }

  reports(resolveNpc = () => null) {
    return [...this.assignments.values()].map((assignment) => {
      const state = this.states.get(assignment.npcId);
      const npc = resolveNpc(assignment.npcId);
      let status;
      if (state?.unreachable) status = 'Having trouble reaching the current job.';
      else if (assignment.job === 'picker') {
        if (assignment.carrying && state?.targetId) status = 'Adding to the current pickup load.';
        else if (assignment.carrying) status = 'Delivering a collected load.';
        else if (state?.targetId) status = 'Collecting a loose item.';
        else status = 'Waiting for loose items and available storage.';
      } else if (assignment.job === 'hunter') {
        if (assignment.ammo <= 0) status = 'Out of BBs.';
        else if (state?.reload > 0) status = 'Reloading while tracking game.';
        else if (state?.targetId) status = 'Hunting game.';
        else status = 'Looking for game.';
      } else if (state?.work > 0) status = `Working on the current ${assignment.job === 'farmer' ? 'crop' : 'target'}.`;
      else if (state?.targetId) status = `Heading to the next ${assignment.job === 'farmer' ? 'ready crop' : assignment.job === 'lumberjack' ? 'tree' : 'rock'}.`;
      else status = assignment.job === 'farmer' ? 'Waiting for a crop to ripen.'
        : assignment.job === 'lumberjack' ? 'Waiting for a reachable tree.' : 'Waiting for a reachable rock.';
      const count = assignment.completed ?? 0;
      const completed = assignment.job === 'picker' ? `${count} item${count === 1 ? '' : 's'} stored.`
        : assignment.job === 'hunter' ? `${count} animal${count === 1 ? '' : 's'} hunted.`
          : assignment.job === 'farmer' ? `${count} crop${count === 1 ? '' : 's'} harvested.`
            : assignment.job === 'lumberjack' ? `${count} tree${count === 1 ? '' : 's'} felled.`
              : `${count} rock${count === 1 ? '' : 's'} broken.`;
      const efficiency = assignment.traits.efficiency === null
        ? null : Math.round(assignment.traits.efficiency * 100);
      return {
        id: assignment.npcId,
        name: npc?.name ?? assignment.npcId,
        job: WORKER_JOBS[assignment.job].label,
        jobId: assignment.job,
        status,
        speedPercent: Math.round(assignment.traits.speed * 100),
        capacity: assignment.traits.capacity,
        accuracyPercent: assignment.traits.accuracy === null
          ? null : Math.round(assignment.traits.accuracy * 100),
        ammo: assignment.ammo,
        load: assignment.carrying?.count ?? 0,
        completedCount: count,
        completed,
        specialtyLabel: assignment.job === 'picker' ? 'Carry capacity'
          : assignment.job === 'hunter' ? 'Accuracy' : 'Work efficiency',
        specialtyValue: assignment.job === 'picker' ? `${assignment.traits.capacity} items`
          : assignment.job === 'hunter' ? `${Math.round(assignment.traits.accuracy * 100)}%` : `${efficiency}%`,
        supplyLabel: assignment.job === 'picker' ? 'Current load'
          : assignment.job === 'hunter' ? 'BB supply' : 'Current task',
        supplyValue: assignment.job === 'picker' ? `${assignment.carrying?.count ?? 0} / ${assignment.traits.capacity}`
          : assignment.job === 'hunter' ? `${assignment.ammo} BBs` : state?.targetId ? 'Assigned' : 'Waiting',
        pay: WORKER_JOBS[assignment.job].cost,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  hire(npcId, job, worldId) {
    if (!WORKER_JOBS[job] || this.assignments.has(npcId)) return false;
    this.assignments.set(npcId, {
      npcId, job, worldId, carrying: null, completed: 0,
      traits: workerTraits(npcId, job),
      ammo: job === 'hunter' ? HUNTER_INITIAL_BBS : null,
      shotsFired: 0,
    });
    this.version++;
    return true;
  }

  dismiss(npcId) {
    const assignment = this.assignments.get(npcId);
    if (!assignment) return null;
    this.assignments.delete(npcId);
    this.states.delete(npcId);
    this.version++;
    return assignment;
  }

  snapshot() {
    return [...this.assignments.values()].map((assignment) => ({
      ...assignment,
      carrying: assignment.carrying ? { ...assignment.carrying } : null,
      traits: { ...assignment.traits },
    }));
  }

  restore(rows) {
    this.assignments.clear();
    this.states.clear();
    for (const row of rows ?? []) {
      if (!row || typeof row.npcId !== 'string' || typeof row.worldId !== 'string'
        || !WORKER_JOBS[row.job] || this.assignments.has(row.npcId)) continue;
      const generated = workerTraits(row.npcId, row.job);
      const traits = {
        speed: Number.isFinite(row.traits?.speed) && row.traits.speed >= 0.5 && row.traits.speed <= 2
          ? row.traits.speed : generated.speed,
        capacity: row.job === 'picker' && Number.isInteger(row.traits?.capacity)
          && row.traits.capacity >= 3 && row.traits.capacity <= 15 ? row.traits.capacity : generated.capacity,
        accuracy: row.job === 'hunter' && Number.isFinite(row.traits?.accuracy)
          && row.traits.accuracy >= 0 && row.traits.accuracy <= 1 ? row.traits.accuracy : generated.accuracy,
        efficiency: ['farmer', 'lumberjack', 'miner'].includes(row.job)
          && Number.isFinite(row.traits?.efficiency) && row.traits.efficiency >= 0.5 && row.traits.efficiency <= 2
          ? row.traits.efficiency : generated.efficiency,
      };
      let carrying = null;
      if (typeof row.carrying === 'string') carrying = { typeId: row.carrying, count: 1 };
      else if (typeof row.carrying?.typeId === 'string' && Number.isInteger(row.carrying.count)
        && row.carrying.count >= 1 && row.carrying.count <= 15) carrying = { ...row.carrying };
      this.assignments.set(row.npcId, {
        npcId: row.npcId,
        job: row.job,
        worldId: row.worldId,
        carrying,
        completed: Number.isSafeInteger(row.completed) && row.completed >= 0 ? row.completed : 0,
        traits,
        ammo: row.job === 'hunter' && Number.isSafeInteger(row.ammo) && row.ammo >= 0
          ? row.ammo : row.job === 'hunter' ? HUNTER_INITIAL_BBS : null,
        shotsFired: Number.isSafeInteger(row.shotsFired) && row.shotsFired >= 0 ? row.shotsFired : 0,
      });
    }
    this.version++;
  }

  /** Discard transient routes compiled against a grid that has been resized. */
  resetWorld(worldId) {
    for (const [npcId, assignment] of this.assignments) {
      if (assignment.worldId === worldId) this.states.delete(npcId);
    }
  }

  updateNpc(dt, npc, { world, ground, edits, fauna, bodies, onShot }) {
    const assignment = this.assignments.get(npc.id);
    if (!assignment || assignment.worldId !== world.meta.id) return false;
    const state = this.#state(npc.id);
    npc.attention = null;
    npc.leaveFurniture();
    npc.activity = WORKER_JOBS[assignment.job].label;

    if (assignment.job === 'picker') this.#pick(dt, npc, assignment, state, world, ground, edits, bodies);
    else if (assignment.job === 'hunter') this.#hunt(dt, npc, assignment, state, world, ground, edits, fauna, bodies, onShot);
    else if (assignment.job === 'farmer') this.#farm(dt, npc, assignment, state, world, ground, edits, bodies);
    else this.#breakLandscape(dt, npc, assignment, state, world, ground, edits, bodies);
    return true;
  }

  #state(npcId) {
    let state = this.states.get(npcId);
    if (!state) {
      state = {
        targetId: null, route: [], goal: null, repath: 0, reload: 0, work: 0, stuckT: 0, unreachable: false,
      };
      this.states.set(npcId, state);
    }
    return state;
  }

  #pick(dt, npc, assignment, state, world, ground, edits, bodies) {
    if (assignment.carrying) {
      const load = assignment.carrying;
      if (load.count < assignment.traits.capacity) {
        let item = state.targetId
          ? ground.items.find((entry) => entry.id === state.targetId && entry.typeId === load.typeId)
          : null;
        if (!item || !this.#container(world, edits, npc, load.typeId, load.count + 1)) {
          item = this.#item(world, ground, edits, npc, load.typeId, load.count + 1);
          state.targetId = item?.id ?? null;
          state.goal = null;
          state.route = [];
        }
        if (item) {
          if (!this.#arrive(dt, npc, assignment, state, world, item.tile, `item:${item.id}`, bodies)) {
            if (state.unreachable) state.targetId = null;
            return;
          }
          if (ground.take(item)) {
            load.count++;
            state.targetId = null;
            state.goal = null;
            state.route = [];
            this.version++;
          }
          return;
        }
      }
      const container = this.#container(world, edits, npc, load.typeId, load.count);
      if (!container) return this.#stand(npc, world);
      if (!this.#arrive(dt, npc, assignment, state, world, container.stand, `container:${container.obj.id}`, bodies)) return;
      if (edits.addStored(container.obj.id, load.typeId, load.count)) {
        assignment.carrying = null;
        assignment.completed += load.count;
        state.targetId = null;
        this.version++;
      }
      return;
    }

    let item = state.targetId ? ground.items.find((entry) => entry.id === state.targetId) : null;
    if (!item || !this.#container(world, edits, npc, item.typeId)) {
      item = this.#item(world, ground, edits, npc);
      state.targetId = item?.id ?? null;
      state.goal = null;
      state.route = [];
    }
    if (!item) return this.#stand(npc, world);
    if (!this.#arrive(dt, npc, assignment, state, world, item.tile, `item:${item.id}`, bodies)) {
      if (state.unreachable) state.targetId = null;
      return;
    }
    if (ground.take(item)) {
      assignment.carrying = { typeId: item.typeId, count: 1 };
      state.targetId = null;
      state.goal = null;
      state.route = [];
      this.version++;
    }
  }

  #item(world, ground, edits, npc, typeId = null, room = 1) {
    const from = [npc.tileX, npc.tileZ];
    let best = null;
    for (const item of ground.items) {
      if (typeId && item.typeId !== typeId) continue;
      if (!this.#container(world, edits, npc, item.typeId, room)) continue;
      const path = findPathToAny(world, from, [item.tile]);
      if (path && (!best || path.cost < best.cost)) best = { item, cost: path.cost };
    }
    return best?.item ?? null;
  }

  #container(world, edits, npc, typeId, count = 1) {
    let best = null;
    const from = [npc.tileX, npc.tileZ];
    for (const obj of world.objects) {
      if (world.felled.has(obj.id) || !edits.isPlaced(obj.id) || objectType(obj.type).use !== 'store') continue;
      if (!edits.pickerAllows(obj.id, typeId)) continue;
      if (edits.roomStored(obj.id, typeId) < count) continue;
      const path = findPathToAny(world, from, approachTiles(world, obj));
      if (!path) continue;
      if (!best || path.cost < best.cost) best = { obj, stand: path.goal, cost: path.cost };
    }
    return best;
  }

  #hunt(dt, npc, assignment, state, world, ground, edits, fauna, bodies, onShot) {
    state.reload = Math.max(0, state.reload - dt);
    if (assignment.ammo <= 0) return this.#stand(npc, world);
    let animal = state.targetId
      ? fauna.animals.find((entry) => entry.id === state.targetId && entry.dying === null && !entry.swims)
      : null;
    if (!animal) {
      let best = null;
      const from = [npc.tileX, npc.tileZ];
      for (const candidate of fauna.animals) {
        if (candidate.dying !== null || candidate.swims) continue;
        const distance = Math.sqrt(distance2(npc, candidate));
        const hasShot = distance <= HUNT_RANGE
          && clearLine(world, npc.x, npc.z, candidate.x, candidate.z, HUNT_RANGE);
        const path = hasShot ? { cost: 0 } : findPathToAny(world, from, [[candidate.tileX, candidate.tileZ]]);
        if (path && (!best || path.cost < best.cost)) best = { animal: candidate, cost: path.cost };
      }
      animal = best?.animal ?? null;
      state.targetId = animal?.id ?? null;
      state.goal = null;
      state.route = [];
    }
    if (!animal) return this.#stand(npc, world);

    const dx = animal.x - npc.x, dz = animal.z - npc.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 1e-3) {
      npc.yaw = Math.atan2(dx, dz);
      npc._target = npc.yaw;
    }
    if (distance <= HUNT_RANGE && clearLine(world, npc.x, npc.z, animal.x, animal.z, HUNT_RANGE)) {
      this.#stand(npc, world);
      if (state.reload > 0 || assignment.ammo <= 0) return;
      state.reload = HUNT_RELOAD;
      assignment.ammo--;
      assignment.shotsFired++;
      this.version++;
      const shotRng = makeRng(`worker-shot:${assignment.npcId}:${assignment.shotsFired}`);
      const accurate = shotRng() < assignment.traits.accuracy;
      if (!accurate) {
        onShot?.(npc, animal, {
          hit: false,
          yaw: npc.yaw + (shotRng() < 0.5 ? -1 : 1) * range(shotRng, 0.14, 0.38),
          distance: HUNT_RANGE,
        });
        return;
      }
      const hit = fauna.shoot(animal.id);
      if (!hit) return;
      onShot?.(npc, animal, { hit: true, yaw: npc.yaw, distance });
      if (!hit.killed) return;
      edits.cull(animal.id);
      assignment.completed++;
      for (const typeId of killDrops(animal)) dropNear(ground, typeId, animal.tileX, animal.tileZ);
      state.targetId = null;
      this.version++;
      return;
    }

    state.repath -= dt;
    const tile = [animal.tileX, animal.tileZ];
    if (state.repath <= 0) {
      state.repath = 0.6;
      state.goal = null;
    }
    this.#arrive(dt, npc, assignment, state, world, tile, `animal:${animal.id}:${tile.join(',')}`, bodies);
    if (state.unreachable) {
      state.targetId = null;
      state.goal = null;
    }
  }

  #farm(dt, npc, assignment, state, world, ground, edits, bodies) {
    let planting = state.targetId
      ? edits.plantingList.find((entry) => entry.stage >= 2 && entry.tile.join(',') === state.targetId)
      : null;
    let stand = planting ? nearestStand(world, npc, planting.tile) : null;
    if (!planting || !stand) {
      const target = nearestTarget(world, npc, edits.plantingList.filter((entry) => entry.stage >= 2),
        (entry) => entry.tile);
      planting = target?.entry ?? null;
      stand = target?.stand ?? null;
      state.targetId = planting?.tile.join(',') ?? null;
      state.goal = null;
      state.route = [];
      state.work = 0;
    }
    if (!planting || !stand) return this.#stand(npc, world);
    if (!this.#arrive(dt, npc, assignment, state, world, stand,
      `crop:${state.targetId}:${stand.join(',')}`, bodies)) return;
    this.#stand(npc, world);
    state.work += dt * assignment.traits.efficiency;
    if (state.work < WORK_SECONDS.farmer) return;
    const harvested = edits.harvest(...planting.tile);
    if (harvested) {
      const plant = plantType(harvested.type);
      const count = yieldOf(plant, makeRng(
        `harvest:${world.meta.id}:${planting.tile[0]}:${planting.tile[1]}:${harvested.plantedDay}`)());
      for (let i = 0; i < count; i++) dropNear(ground, plant.yields.type, ...planting.tile);
      assignment.completed++;
      this.version++;
    }
    this.#clearTarget(state);
  }

  #breakLandscape(dt, npc, assignment, state, world, ground, edits, bodies) {
    const category = assignment.job === 'lumberjack' ? 'tree' : 'rock';
    let obj = state.targetId ? world.objectById(state.targetId) : null;
    let stand = obj && objectType(obj.type).category === category ? nearestStand(world, npc, obj.tile, obj) : null;
    if (!obj || objectType(obj.type).category !== category || !stand) {
      const targets = world.objects.filter((entry) => !world.felled.has(entry.id)
        && objectType(entry.type).category === category);
      const target = nearestTarget(world, npc, targets, (entry) => entry.tile, true);
      obj = target?.entry ?? null;
      stand = target?.stand ?? null;
      state.targetId = obj?.id ?? null;
      state.goal = null;
      state.route = [];
      state.work = 0;
    }
    if (!obj || !stand) return this.#stand(npc, world);
    if (!this.#arrive(dt, npc, assignment, state, world, stand,
      `${category}:${obj.id}:${stand.join(',')}`, bodies)) return;
    this.#stand(npc, world);
    state.work += dt * assignment.traits.efficiency;
    const seconds = WORK_SECONDS[assignment.job] + (category === 'rock' && obj.shape.w * obj.shape.d > 1 ? 2 : 0);
    if (state.work < seconds) return;
    if (edits.fell(obj)) {
      const drops = category === 'tree' ? chopDrops(obj) : mineDrops(obj);
      for (const typeId of drops) dropNear(ground, typeId, ...obj.tile);
      assignment.completed++;
      this.version++;
    }
    this.#clearTarget(state);
  }

  #clearTarget(state) {
    state.targetId = null;
    state.goal = null;
    state.route = [];
    state.work = 0;
    state.unreachable = false;
  }

  #arrive(dt, npc, assignment, state, world, tile, goal, bodies) {
    const tx = tile[0] + 0.5, tz = tile[1] + 0.5;
    if (Math.hypot(tx - npc.x, tz - npc.z) < 0.35) {
      state.unreachable = false;
      this.#stand(npc, world);
      return true;
    }
    if (state.goal !== goal) {
      state.goal = goal;
      state.route = findPath(world, [npc.tileX, npc.tileZ], tile);
      state.stuckT = 0;
      const end = state.route.at(-1);
      state.unreachable = !end || end[0] !== tile[0] || end[1] !== tile[1];
      if (state.unreachable) state.route = [];
    }
    const next = state.route[0];
    if (!next) {
      this.#stand(npc, world);
      return false;
    }
    const nx = next[0] + 0.5, nz = next[1] + 0.5;
    const dx = nx - npc.x, dz = nz - npc.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.16) {
      state.route.shift();
      return this.#arrive(dt, npc, assignment, state, world, tile, goal, bodies);
    }
    const stepX = next[0] - npc.tileX, stepZ = next[1] - npc.tileZ;
    if (Math.abs(stepX) > 1 || Math.abs(stepZ) > 1
      || (stepX !== 0 || stepZ !== 0)
        && !canTraverse(world, npc.tileX, npc.tileZ, next[0], next[1])) {
      state.goal = null;
      state.route = [];
      state.stuckT = 0;
      state.unreachable = false;
      this.#stand(npc, world);
      return false;
    }
    const heading = Math.atan2(dx, dz);
    turnToward(npc, heading, dt, npc.type.turnRate);
    const aligned = Math.max(0, Math.cos(angleDelta(npc.yaw, heading)));
    const speed = npc.type.walkSpeed * assignment.traits.speed
      * world.surfaceAt(npc.tileX, npc.tileZ).speed * aligned;
    const moved = sweep(world, npc, dt,
      Math.sin(npc.yaw) * speed, Math.cos(npc.yaw) * speed, bodies);
    state.stuckT = aligned > 0.5 && moved < 0.01 * dt ? state.stuckT + dt : 0;
    if (state.stuckT > 0.3) {
      state.goal = null;
      state.route = [];
      state.stuckT = 0;
      state.unreachable = false;
      this.#stand(npc, world);
      return false;
    }
    npc._target = npc.yaw;
    npc.lean = 0;
    return false;
  }

  #stand(npc, world) {
    npc.speed = 0;
    npc.y = world.groundHeight(npc.x, npc.z);
  }
}

function distance2(a, b) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

function approachTiles(world, obj) {
  const [ax, az] = obj.tile;
  const tiles = [];
  for (let tx = ax - 1; tx <= ax + obj.shape.w; tx++) {
    for (let tz = az - 1; tz <= az + obj.shape.d; tz++) {
      if (tx >= ax && tx < ax + obj.shape.w && tz >= az && tz < az + obj.shape.d) continue;
      if (!world.inBounds(tx, tz) || world.isBlocked(tx, tz) || world.portalAt(tx, tz)) continue;
      tiles.push([tx, tz]);
    }
  }
  return tiles;
}

function nearestStand(world, npc, tile, obj = null) {
  const goals = obj ? approachTiles(world, obj) : adjacentTiles(world, tile);
  return findPathToAny(world, [npc.tileX, npc.tileZ], goals)?.goal ?? null;
}

function nearestTarget(world, npc, entries, tileOf, objects = false) {
  let best = null;
  const from = [npc.tileX, npc.tileZ];
  for (const entry of entries) {
    const goals = objects ? approachTiles(world, entry) : adjacentTiles(world, tileOf(entry));
    const path = findPathToAny(world, from, goals);
    if (path && (!best || path.cost < best.cost)) best = { entry, stand: path.goal, cost: path.cost };
  }
  return best;
}

function adjacentTiles(world, [x, z]) {
  const tiles = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dz) || !world.inBounds(x + dx, z + dz)
      || world.isBlocked(x + dx, z + dz) || world.portalAt(x + dx, z + dz)) continue;
    tiles.push([x + dx, z + dz]);
  }
  return tiles;
}

function dropNear(ground, typeId, cx, cz) {
  for (let radius = 0; radius <= 3; radius++) {
    for (let z = cz - radius; z <= cz + radius; z++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== radius) continue;
        if (ground.drop(typeId, x, z)) return true;
      }
    }
  }
  return false;
}
