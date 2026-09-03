/**
 * Tile pathfinding, for click-to-walk.
 *
 * A* over the tile grid, using the SAME traversal predicates grid movement
 * uses -- `canStep` for an edge, `canOccupy` for a corner -- and nothing else.
 * That is the whole design constraint: a route this returns must be one the
 * walker can actually walk. The moment pathfinding grows its own idea of what
 * is passable, it starts routing players into cliffs that World says are fine
 * and refusing ramps that it says are not, and the two disagreements look
 * identical from the outside (the player just stops).
 *
 * TWO THINGS THAT ARE NOT OBVIOUS
 * ------------------------------
 * 1. THE GOAL IS USUALLY BLOCKED. "Click on a block and walk to it" means the
 *    tile you clicked is a wall, a tree, a house. So the search does not fail
 *    when the goal is unreachable -- it returns the route to the reachable tile
 *    that got CLOSEST, which is the tile beside the thing you clicked. Failing
 *    would mean every click on scenery did nothing.
 *
 * 2. PORTALS ARE ENDPOINTS, NEVER WAYPOINTS. Standing on a doorway takes you
 *    through it. A route that merely crossed one would yank you indoors on the
 *    way past, so a portal tile is expandable only when it is what you aimed at.
 *
 * Cost is distance divided by the surface's speed, so a route prefers the path
 * over the sand beside it -- the same speed multiplier the walker will actually
 * experience. The heuristic divides by the FASTEST surface in the registry,
 * which is what keeps it admissible: assume the best possible ground ahead and
 * A* can never over-estimate, so the first route it commits to is optimal.
 */

import { STEP8, isDiagonal } from '../core/constants.js';
import { SURFACES } from '../world/surfaces.js';

/** The best speed multiplier any walkable surface offers. Bounds the heuristic. */
const FASTEST = Math.max(...SURFACES.filter((s) => s.walkable).map((s) => s.speed));

/**
 * Ceiling on expansions. A town is a few thousand tiles, so this only ever
 * bites on a click at something genuinely sealed off -- and even then the
 * partial result is still the closest tile reached, which is a sane walk.
 */
const MAX_EXPANSIONS = 20000;

/** Cost multiplier for a corner step. */
const DIAG = Math.SQRT2;

/**
 * Route from one tile to another.
 *
 * `climbs` is passed straight through to those predicates and is a fact about
 * the WALKER, not about the map (see World.canStep): route somebody who cannot
 * use a ladder over one and they walk to the foot of it and stop.
 *
 * @param {World} world
 * @param {[number, number]} from  tile the walker is standing on
 * @param {[number, number]} to    tile that was clicked
 * @param {boolean} climbs         whether this walker can use a ladder
 * @returns {Array<[number, number]>} tiles to step through, START EXCLUDED and
 *   destination last. Empty when there is nowhere better to stand than here.
 */
export function findPath(world, [sx, sz], [gx, gz], climbs = false) {
  if (!world.inBounds(gx, gz) || !world.inBounds(sx, sz)) return [];
  if (sx === gx && sz === gz) return [];

  const w = world.width;
  const n = w * world.height;
  const start = sz * w + sx;
  const goal = gz * w + gx;

  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new Heap();

  g[start] = 0;
  open.push(start, heuristic(sx, sz, gx, gz));

  // The consolation prize, tracked from the first node: the reachable tile that
  // got nearest the goal, ties broken by the cheaper route to it.
  let best = start;
  let bestH = heuristic(sx, sz, gx, gz);

  let expansions = 0;
  while (open.size && expansions < MAX_EXPANSIONS) {
    const cur = open.pop();
    if (cur === goal) return unwind(came, start, goal, w);
    if (closed[cur]) continue;   // a stale duplicate left by a cheaper re-push
    closed[cur] = 1;
    expansions++;

    const cx = cur % w, cz = (cur - cx) / w;

    for (let k = 0; k < 8; k++) {
      const v = STEP8[k];
      const nx = cx + v.x, nz = cz + v.z;
      if (!world.inBounds(nx, nz)) continue;

      const next = nz * w + nx;
      if (closed[next]) continue;

      // The corner rule lives in canOccupy: a diagonal needs BOTH of the
      // orthogonal tiles it squeezes between, so no route ever cuts through
      // the seam where two buildings touch.
      if (!canTraverse(world, cx, cz, nx, nz, climbs)) continue;
      if (next !== goal && world.portalAt(nx, nz)) continue;   // see note 2

      const step = (isDiagonal(k) ? DIAG : 1) / world.surfaceAt(nx, nz).speed;
      const cost = g[cur] + step;
      if (cost >= g[next]) continue;

      g[next] = cost;
      came[next] = cur;
      const h = heuristic(nx, nz, gx, gz);
      open.push(next, cost + h);

      if (h < bestH || (h === bestH && cost < g[best])) { best = next; bestH = h; }
    }
  }

  return best === start ? [] : unwind(came, start, best, w);
}

/**
 * Find the cheapest exact route among several acceptable destinations.
 *
 * This is intentionally built on `findPath`: object interactions usually have
 * several adjacent tiles, and choosing the nearest one before checking the map
 * can select the wrong side of a wall. The returned goal makes an empty route
 * unambiguous when the walker already occupies an acceptable tile.
 */
export function findPathToAny(world, from, goals, climbs = false) {
  let best = null;
  for (const goal of goals) {
    if (!world.inBounds(...goal)) continue;
    if (from[0] === goal[0] && from[1] === goal[1]) return { route: [], goal, cost: 0 };

    const route = findPath(world, from, goal, climbs);
    const end = route.at(-1);
    if (!end || end[0] !== goal[0] || end[1] !== goal[1]) continue;

    const cost = pathCost(world, from, route);
    if (!best || cost < best.cost) best = { route, goal, cost };
  }
  return best;
}

/** The traversal predicate shared by planning and live route validation. */
export function canTraverse(world, ax, az, bx, bz, climbs = false) {
  return ax !== bx && az !== bz
    ? world.canOccupy(bx, bz, ax, az, climbs)
    : world.canStep(ax, az, bx, bz, climbs);
}

/** The same weighted travel cost A* optimises. */
function pathCost(world, from, route) {
  let cost = 0;
  let [ax, az] = from;
  for (const [bx, bz] of route) {
    cost += (ax !== bx && az !== bz ? DIAG : 1) / world.surfaceAt(bx, bz).speed;
    ax = bx;
    az = bz;
  }
  return cost;
}

/**
 * Octile distance, scaled by the best ground the walker could hope for.
 *
 * Octile rather than Euclidean because the walker moves in eight directions on
 * a grid and can never beat that bound; Euclidean would be admissible too, but
 * looser, and a looser heuristic is just more tiles expanded for the same route.
 */
function heuristic(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
  return (Math.max(dx, dz) + (DIAG - 1) * Math.min(dx, dz)) / FASTEST;
}

/** Walk the parent chain back to the start, then hand it over forwards. */
function unwind(came, start, end, w) {
  const path = [];
  for (let i = end; i !== start && i !== -1; i = came[i]) {
    const x = i % w;
    path.push([x, (i - x) / w]);
  }
  path.reverse();
  return path;
}

/**
 * Minimal binary min-heap over (node, priority) pairs.
 *
 * No decrease-key: a cheaper route to an already-open tile is pushed as a
 * duplicate and the stale copy is skipped on pop via `closed`. That is both
 * less code and, for a grid this size, faster than maintaining index positions.
 */
class Heap {
  constructor() {
    this.node = [];
    this.pri = [];
  }

  get size() { return this.node.length; }

  push(node, pri) {
    let i = this.node.length;
    this.node.push(node); this.pri.push(pri);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= pri) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  pop() {
    const top = this.node[0];
    const node = this.node.pop(), pri = this.pri.pop();
    if (this.node.length) {
      this.node[0] = node; this.pri[0] = pri;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let small = i;
        if (l < this.pri.length && this.pri[l] < this.pri[small]) small = l;
        if (r < this.pri.length && this.pri[r] < this.pri[small]) small = r;
        if (small === i) break;
        this.#swap(i, small);
        i = small;
      }
    }
    return top;
  }

  #swap(a, b) {
    [this.node[a], this.node[b]] = [this.node[b], this.node[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}
