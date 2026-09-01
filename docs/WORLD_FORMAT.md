# World file format (`tw.world` v1)

A world is one JSON file. This document is the schema and, more importantly,
the reasoning — the shape of this file is the decision everything else in the
project is built on top of.

## The core split: dense vs sparse

World data divides into two kinds that want opposite storage strategies.
Conflating them is what makes tile-game formats painful to live with, so they
are separated at the top level.

| | **Dense** (`layers`) | **Sparse** (`objects`) | **Mobile** (`animals`) |
|---|---|---|---|
| Examples | ground surface, elevation, terrain flags | buildings, trees, rocks | chickens |
| Every tile has one? | yes | no | no |
| Has identity / state? | no | yes (stable `id`, `props`) | yes |
| Covers | exactly one tile | a footprint of many tiles | nothing — it has a *position* |
| Stored as | one string per row, one char per tile | array of records | array of records |

Dense layers use char-rows because you can *see the map in the file*, edit it in
any text editor, and get line-by-line diffs in git. Sparse objects use records
because they carry identity and per-instance data that a char grid cannot hold.

Animals get their own array rather than joining `objects` because they are not
facts about a tile at all. An object's `tile` says which cells it occupies and
blocks; an animal's says where it *starts*. Folding them together would make
every consumer of `objects` — collision, the spatial buckets, the prop mesher,
the ASCII map — ask "but does this one move?", which is the branch this schema
exists to avoid.

## Derived data is never stored

The file records facts. Anything that follows *from* those facts — which tiles
are blocked, which object occupies a tile, where a footprint lands after
rotation — is computed at load time by `src/world/World.js`.

This is a hard rule. A file that stores both a fact and its consequence will
eventually disagree with itself, and you will debug a world where a tree is
invisible but still solid because someone moved it and forgot to update the
occupancy list.

## Skeleton

```jsonc
{
  "format": "tw.world",
  "version": 1,
  "meta":  { "id": "meadowbrook", "name": "Meadowbrook" },
  "grid":  { "width": 44, "height": 44, "tileSize": 1 },

  "layers": {
    "surface": {
      "palette": { "g": "grass", "c": "concrete", "s": "sand", "w": "water" },
      "data": ["ggggcccgg…", "…"]            // exactly `height` strings of `width` chars
    },
    "elevation": {
      "palette": { "0": "0", "1": "1", "2": "2" },
      "data": ["111111000…", "…"]
    },
    "flags": {
      "palette": { ".": "none", "^": "ramp.north", "v": "ramp.south",
                   "<": "ramp.west",  ">": "ramp.east" },
      "data": ["..........", "…"]
    }
  },

  "objects": [
    { "id": "home.player", "type": "building.home", "tile": [16, 19],
      "rotation": 0, "props": { "label": "Tyler's House" } }
  ],

  "animals": [
    { "id": "chicken.0", "type": "chicken", "tile": [19, 26] }
  ],

  "spawn": { "tile": [21, 14], "facing": "south" }
}
```

### `layers`

A map, not a fixed set of keys — adding a fourth layer (path decals, weather
zones) does not change the schema shape.

Every layer has a `palette` mapping a char to a *semantic name*, never a raw
number. That keeps the file self-describing and means adding a surface type is
one registry entry plus one palette line, with no code changes to the loader.
Elevation gets a palette too rather than parsing digits directly, so negative
elevations (water below grade) stay expressible.

An omitted layer is legal and means "all zeroes", which every layer defines as
its neutral value.

Three layers are terrain (`surface`, `elevation`, `flags`) and one is not:
`zones` says whose floor a tile is, and its palette points into a small
per-place table rather than into a code registry. See
[`zones`](#zones--whose-floor-this-is).

### `objects`

- **`tile` is the footprint's north-west corner.** Rotation swaps width/depth
  but keeps that corner pinned, so re-rotating an object in a world file never
  makes it drift.
- **`rotation`** is `0 | 90 | 180 | 270`, clockwise as seen on the map.
- **`type`** indexes a registry in code (`src/world/objectTypes.js`), which owns
  footprint, mask, height, squash and palette. The file owns *placement only*.
  Adding a new tree species is one registry entry and zero schema churn.
- **`id`** must be unique. It also seeds the deterministic RNG for that object's
  visual variation, so a given world always looks identical.
- **`props`** is authored, immutable-from-file data. Runtime mutable state
  belongs in a separate save file keyed by `id` — never write back to the world.

### `animals`

```jsonc
{ "id": "chicken.0", "type": "chicken", "tile": [19, 26], "props": { "range": 3 } }
```

- **`type`** indexes `src/world/animalTypes.js`, which owns the species: its
  size, its speeds, its gait, its palette, and the *behaviour* it runs. The
  seven shipped species are `chicken`, `duck`, `rabbit`, `sheep`, `goat`,
  `cat` and `crow`; every one of them runs the same `wander` behaviour and
  differs only in those numbers. Adding an eighth is one registry entry plus one
  mesh builder, and no schema change.
- **`tile`** is where the animal starts, and the centre of the patch it keeps
  to. It is not where the animal *is*: a second after the world opens it is
  somewhere else, and nothing ever writes a live position back to the file.
  A blocked start tile is not an error — the runtime stands the animal on the
  nearest walkable one — but `checkworld` flags it, because a tile you have to
  be rescued from was a guess.
- **`props.range`** overrides the species' wander radius, in tiles. That is the
  difference between a coop bird and a stray. It is a *bias*, not a fence: an
  animal shoved past the line still finds its own way back.
- **`id`** must be unique, and seeds that animal's RNG, so a world always opens
  with its chickens facing the same way.

An animal stamps **no collision**. It does not block you, it does not own an
occupancy cell, and two of them may share a tile. What it does share with you is
the movement model: animals sweep the same circle against the same world as the
player (`src/sim/body.js`), so anywhere a chicken can go, you can go.

### `npcs`

People you can talk to, and buy from.

```jsonc
{
  "id": "keep.marla",
  "type": "folk.shopkeep",
  "tile": [4, 2],
  "facing": "south",
  "props": { "name": "Marla", "title": "Keeps the store" },
  "shop": { /* see below */ },
  "dialog": { /* see below */ }
}
```

- **`type`** indexes `src/world/npcTypes.js`, which owns the body: size, turn
  rate, idle glances and palette. Placement and *personality* are the file's.
- **`tile`** is where they stand — and, if they walk, the patch they keep to.
  Unlike an animal's, this tile is **not** nudged to the nearest walkable one:
  someone is posted behind that counter on purpose, and quietly relocating them
  is how a shopkeeper ends up serving from the middle of the room.
  `checkworld` fails on a blocked one instead.
- **`facing`** is the post they return to when nothing is going on.
- **`props.roam`** makes them walk: the number is how far from `tile` they
  will wander, in tiles. Leave it out and they stand at their post and turn
  their head, which is what a shopkeeper does. It is a *bias* and not a fence,
  exactly like an animal's `props.range`, and it is per instance rather than
  per type because a shopkeeper and the villager strolling past her window are
  the same kind of body — the difference between them is this one field.
  Walking uses the same swept circle as the player and the same behaviour
  contract as a chicken (`src/sim/behaviors.js`); being spoken to stops them
  where they stand.
- **`props.name` / `props.title`** are what the dialog box and the HUD call
  them.
- **`props.voice`** overrides how they sound, over the type's default:
  `{ "pitch": 1.2, "rate": 30, "timbre": "square" }`. `pitch` multiplies a
  220 Hz base, `rate` is characters per second — which is both the babble
  tempo *and* the speed the line types itself out at, because they are one
  thing — and `timbre` is the oscillator wave (`triangle` soft, `square`
  nasal, `sawtooth` rough). Leave it out and the type's voice applies, jittered
  a few percent by a seed from the NPC's `id` so two shopkeepers do not share
  a throat. See [`src/audio/voice.js`](../src/audio/voice.js).

An NPC stamps **no collision**, exactly like an animal, and for the same reason:
collision is derived from the file at load and never mutated, so a person who
blocked a tile would have to punch a hole in that. You can walk through them.

You can talk to someone up to **2.2 tiles** away, not just the tile you are
facing — because a counter is a solid tile and the shopkeeper is always the
tile behind it. A faced NPC still wins over a nearby one, and an item in reach
wins over a merely-nearby NPC (`Game.interaction` in `src/main.js` is the one
place that decides).

### `npcs[].shop`

```jsonc
"shop": {
  "name": "Marla's Shelves",
  "hours": { "open": 8, "close": 19 }, // optional; may wrap midnight
  "markup": 1.5,          // what she charges, x the item's value
  "buyRate": 0.5,         // what she pays, x the item's value
  "takes": ["item.stick"],// what she will buy at all; omit for "anything"
  "daily": 2,             // optional: offer this many randomly chosen rows per day
  "stock": [
    { "type": "item.apple", "count": null },            // unlimited shelf
    { "type": "item.shell", "count": 1, "price": 70 }   // one, at a fixed price
  ]
}
```

Outside those hours the NPC remains present but uses the standard closed-shop
conversation, and no dialog effect can open the till.

Prices are **rates against the item's `value`** (`src/world/itemTypes.js`),
never a table. So adding a pear to the game cannot leave a shopkeeper with no
opinion about pears, and a per-entry `price` is only for the thing in the
corner that is dearer than it looks. Stock is *live state* from the moment the
place opens. Without `daily`, sold-out rows stay sold out. With `daily`, `stock`
is the catalog and exactly that many distinct rows are chosen from it each
in-game day. The choice is seeded by NPC id and day, so reloading cannot reroll
the shelf; counts and sold-out rows survive saves until the next dawn.

A `type` may name an item that came out of a **kit file** as readily as one the
game ships with — Turnip & Timber's book is three hundred `kititem.*` rows and
ten of them on the floor at a time. The only rule is the ordering every kit
already obeys: the world must `kits`-declare whatever defines those types, or
the validator rejects the stock row by name (see `docs/KIT_FORMAT.md`).

### `npcs[].schedule` and `npcs[].errands`

`schedule` is a cyclic, clock-driven list. The most recent `at` row owns the
NPC's post until the next row; the NPC walks to `tile`, faces `facing`, exposes
`activity` in the HUD, and may become unavailable for conversation.

```jsonc
"schedule": [
  { "at": 6, "tile": [18, 49], "facing": "south", "activity": "Tending beds" },
  { "at": 20, "tile": [18, 49], "facing": "north", "activity": "Inside", "available": false }
]
```

Errands are persistent player state while definitions stay in the world file.
Objectives consume actual simulation events, not inventory snapshots, so
dropping and re-picking the same object cannot satisfy gathering twice.

```jsonc
"errands": [{
  "id": "pond-supper",
  "title": "Catch trout",
  "objective": { "kind": "fish", "item": "item.trout", "count": 2 },
  "reward": { "coins": 80, "relationship": 22 }
}]
```

Objective kinds are `gather` (`item`), `fish` (`item`), `process` (`fixture`),
and `change` (`change` plus optional object `category`). Dialog uses
`{ "errand": { "id": "...", "status": "available|active|ready|completed" } }`
and the `errand` effect with action `accept` or `complete`. Relationship checks
use `{ "relationship": { "atLeast": "acquaintance|friend|close" } }`; the
legacy `friend` condition means acquaintance-or-better. Time-specific lines use
`{ "time": { "from": 5, "to": 9 } }`.

### `npcs[].dialog`

A conversation is data. The format is one screen of vocabulary, fully validated
at load, and it is written up in full at the top of
[`src/world/dialog.js`](../src/world/dialog.js). In brief:

```jsonc
"dialog": {
  "start": "open",
  "nodes": {
    // A BRANCH node routes and says nothing. The last rule is the "otherwise".
    "open": { "branch": [
      { "when": { "not": { "flag": "met" } }, "to": "hello" },
      { "when": { "visits": 6 }, "to": "regular" },
      { "to": "again" }
    ]},

    // A SAY node has text (one string, or pages), and optionally choices,
    // a `then` to fall through to, and `do` effects applied on entry.
    "hello": {
      "text": ["Well now.", "Marla. I keep the shelves."],
      "do": { "set": "met" },
      "then": "menu"
    },

    "menu": {
      "text": "What'll it be?",
      "choices": [
        { "text": "Let's trade.", "do": { "shop": true }, "to": "after" },
        { "text": "I brought you apples.",
          "when": { "has": { "type": "item.apple", "count": 3 } },
          "do": [ { "take": { "type": "item.apple", "count": 3 } }, { "coins": 40 } ],
          "to": "menu" },
        { "text": "That's all.", "to": "end" }   // "end" closes the conversation
      ]
    }
  }
}
```

**Conditions** (`when`): `flag`, `friend`, `holding`, `visits`, `coins`,
`has`, `room`, and `not` / `all` / `any`. Several keys in one object mean AND.
A choice whose `when` fails is not shown at all — an option you cannot take
should not be on screen advertising that you cannot take it. `holding` asks
whether there is *anything* in the player's hand, which is the one question
`has` cannot ask.

**Effects** (`do`): `set`, `clear`, `give`, `take`, `coins`, `shop`, `gift`,
`peace`. One key per object; a list is an order. `gift` hands over one of
whatever is held; `peace` ends a feud (below).

Flags and the visit count live on the **NPC**, not on the conversation, so they
outlive it — and the NPC outlives you leaving the room.

`{ "shop": true }` *parks* the conversation rather than ending it: the trade
panel takes the screen, and closing it resumes at that choice's `to`. That is
the whole difference between a shop and a vending machine.

There is deliberately **no expression string**. `"if": "flags.met && coins > 40"`
is shorter to write and impossible to check — it needs a parser or an `eval`,
and a typo in it is an explosion in the middle of a conversation. A closed
vocabulary of objects means every condition in every world file is validated at
load, and `checkworld` can walk the whole graph without a browser.

### `zones` — whose floor this is

Private ground: a room, or a strip behind a counter, that you are not welcome
on until you are friends with the person it belongs to. Walk onto it uninvited
and you are **trespassing** — the HUD says so, a clock starts, and when it runs
out you are shown the door.

Two halves, and the split is the point:

```jsonc
"zones": {                                            // the table: WHOSE
  "his": { "owner": "folk.bramble", "label": "Bramble's Cottage" }
},
"layers": {
  "zones": {                                          // the grid: WHERE
    "palette": { ".": "none", "h": "his" },
    "data": ["............", ".hhhhhhhhhh.", "…"]
  }
}
```

- **Dense, like surface and elevation**, because "whose is this tile" is a
  question about *every* tile — and because a char grid is the only way to
  *see*, in the file, that the private strip stops at the end of the counter.
- **`owner` is an NPC `id`**, and that person is usually somewhere else
  entirely: Bramble is out in the meadow while you are standing in his front
  room. Nothing at load time can tell a real owner from a typo, so
  `npm run checkworld` cross-checks every zone owner against the people of
  every place in the graph — the only check that sees all the files at once.
- **`none` is reserved** for public ground and is the value of an omitted
  layer, exactly like every other dense layer's neutral.
- A declared zone that covers **no tiles** is an error: it is a rule that can
  never fire, and the usual cause is a palette char renamed on one side only.

**Being welcome is not in this file, and cannot be.** Whether you may stand
here depends on who the *player* has met, which is player state that crosses
doorways with them (`src/sim/Friends.js`) — the world file says whose floor it
is and stops there. You make a friend by **talking to someone while you are
somewhere you are allowed to be**, which is why the villagers wander around
outside their houses (`props.roam`, above): meeting them out there is the
mechanic, not scenery. A dialog script can *ask* with the `friend` condition;
no effect can grant it.

### Shooting somebody, and getting over it

The inverse act, and it costs exactly what saying hello bought: the friendship,
and with it the front door. It also makes that person **angry for one day** — a
day of game time measured from the shot, not "until the next midnight", so
somebody shot at dusk forgives you at dusk.

While they are angry they are **not running the script in this file at all.**
They fall back to a grudge script (`src/world/grudge.js`), which lives in code
rather than in a world file because every person in every town can be shot,
including one in a world generated a second ago that no author has ever seen.
That single swap is what closes their shop, their errands and their gossip in
one move, and it closes them for people nobody has authored anything for yet.

There are two ways back to neutral and **neither of them is talking**: hand
them something — the grudge script's one choice, `gift` then `peace` — or wait
the day out. Both leave you *strangers* rather than friends: the feud is over,
the door is still shut, and you get back through it the way you did the first
time. Saying hello does nothing until then, which is why `Friends.add` refuses
somebody who is still angry.

There is deliberately no condition for *"is this person angry"*, because a
script never has to ask: an angry person is not running that script.

### Footprint masks

An object type declares a `w × d` footprint and a mask, one string per row,
where `#` blocks movement and `.` is walk-through:

```js
'building.gate': { footprint: { w: 5, d: 2, mask: ['#...#', '#...#'] } }
```

That is one object you can walk *under*, rather than three objects glued
together. Masks rotate with the object.

## Coordinates

Tile space and 3D world space are the same space, scaled by `tileSize`:

```
world.x = tile.x * tileSize     +x → east  (right on screen)
world.z = tile.z * tileSize     +z → south (down on screen)
world.y = elevation * STEP_HEIGHT
```

Grid arrays are row-major, `i = z * width + x`, so array row order matches
"+z is down". The top-down camera looks along −y with an up vector of
`(0, 0, −1)`, which makes the 2D view a literal orthographic projection of the
3D world with **zero conversion math**. The two views cannot drift apart,
because there is only one coordinate system.

## Elevation and ramps

Elevation is a per-tile integer. A ramp is a terrain *flag*, not a separate
mesh: the flagged tile sits at the **low** elevation and rises to `elevation+1`
at the edge it points toward.

Traversal is **edge-based**, not tile-based. `World.edgeHeight(x, z, dir)`
returns the terrain height at the edge of a tile facing a direction, and a step
from A to B is legal exactly when the two tiles agree about the edge they
share. Cliffs, ramp sides and shorelines all fall out of that one rule instead
of a pile of special cases — and it is the predicate that makes one-way ledges
possible later without touching any movement code.

## Validation

`parseWorldFile()` throws `WorldFileError` with a path (`objects[7]`,
`layers.surface`) and, for ragged grids, the offending row and column. These
files are hand-edited; a silent wrong-shaped world is miserable to debug.

Checked at load: format/version, grid dimensions, every row's length, every
char present in its palette, unique object ids, known object types, footprints
landing inside the grid after rotation, and unique animal ids of known species
starting inside the grid.

Dialog is checked at load too, and thoroughly: every `to` is resolved against
the node table, every condition and effect key is a known one, every item type
they name exists, a branch's last rule is unconditional, and a shop-opening
line on an NPC with no shop is an error. A conversation that dead-ends is a box
on screen with no button on it — one of the very few states in this game a
player cannot walk out of — and it is invisible until somebody picks that line.

Zones are checked at load too: every palette name resolves to a declared zone,
every declared zone covers at least one tile, and every zone names an owner.

`npm run checkworld` goes further on all counts. It cross-checks every zone's
owner against the NPCs of every place it can reach, and it runs each place's
animals *and its people* for a minute of simulated time, because behaviour is the one thing a static
check cannot see: an animal is legal where the file put it and illegal four
seconds later, and so is a villager — who must also actually move if the file
gave him `props.roam`, and must not if it did not. And it *walks every conversation*, driving the real dialog
machine down every choice from every reachable state against a real inventory
and purse — reporting orphaned nodes, a script with no ending, and a shop no
line of dialog opens.

## Extension points deliberately left open

- **Multiple worlds / interiors.** `World` is an instance, never a module
  singleton, and is threaded through the systems that need it. Adding a
  `WorldManager` with an active pointer and portal objects does not require
  touching the simulation.
- **New dense layers** — `layers` is an open map.
- **Runtime object state** — keyed by `id` in a separate save file.
