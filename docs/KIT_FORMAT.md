# Kit format (`tw.kit` v1)

A kit is a piece of furniture defined in a **file** instead of in code — its
footprint, its shape, how it moves, and what happens when you press `E` on it.
The fountain in Meadowbrook's plaza is one, and adding a second fixture to the
game is two files and no patch to `src/`.

This document is the schema and the reasoning. The short version of the
reasoning: everything here that could be a closed vocabulary **is** one, and the
one thing that could not is confined to a sandbox.

## Two files

```
public/kits/fountain.kit.json     what the thing IS     — validated, completely
public/kits/fountain.js           what the thing DOES   — sandboxed, budgeted
```

The line between them is not "declarative vs imperative". It is **how often the
code runs**:

| | runs | so it is |
|---|---|---|
| footprint, palette, parts | once, at bake | data |
| animation channels | 60×/sec, per part, forever | data |
| `interact.when` | ~10×/sec, from the HUD | data |
| `interact.run` | once, on a key press | **script** |

Shape and animation are data because a frame budget that depends on what a kit
author wrote is not a frame budget. `when` is data because `Game.interaction()`
is polled by the HUD to decide what prompt to draw, and answering it must not
start a JavaScript engine or be able to have side effects. What is left — the
body of an interaction — is the only place where a closed vocabulary would keep
costing its author a new registry entry for every idea they had, and it is
somewhere a step budget is affordable.

## Skeleton

```jsonc
{
  "format": "tw.kit",
  "version": 1,
  "meta": { "id": "fountain", "name": "Fountain" },

  "types": {
    "fixture.fountain": {
      "kind": "object",
      "label": "Fountain",
      "footprint": { "w": 2, "d": 2, "mask": ["##", "##"] },
      "height": 1.35,
      "squash": 0.34,

      "palette": { "stone": "#b9b3a6", "water": "#5fa8c9" },

      "parts": [
        { "prim": "cyl", "at": [0, 0.30, 0], "size": [0.94, 0.24, 0.94],
          "color": "stone" },
        { "prim": "cyl", "at": [0, 0.46, 0], "size": [0.74, 0.06, 0.74],
          "color": "water",
          "anim": { "bob": { "amp": 0.012, "rate": 0.45 } } }
      ],

      "state": { "wishes": 0 },

      "interact": {
        "label": "Make a wish",
        "when": { "coins": 1 },
        "run": "fountain.js"
      }
    }
  }
}
```

A world file then places one exactly as it places a tree, and declares the kit
at the top so it is registered before the world is validated:

```jsonc
{
  "kits": ["kits/fountain.kit.json"],
  "objects": [
    { "id": "fountain.plaza", "type": "fixture.fountain", "tile": [30, 44] }
  ]
}
```

**A kit says what a fountain is; a world file says where one stands.** The two
halves never blur, which is why a kit is reusable across worlds and why
`docs/WORLD_FORMAT.md` gains no new concepts — a fixture is an `object`, and
every consumer of that array already handles it.

### Type ids must start with `fixture.`

Enforced at parse, and again in `registerObjectType`. A kit that could define
`building.store` could silently repaint a town by being loaded next to it.

## `parts` — the model

Each part is one primitive placed in the fixture's local space: origin at the
centre of the footprint, base at `y = 0`, unrotated.

- **`prim`** — `box`, `cyl`, `taper`, `cone`, `pyr`, `blob`, `chunk`. Names, not
  geometry: `src/world/kit.js` must stay loadable in node, where there is no
  WebGL, so the mapping to actual shapes lives in `src/render/props.js`.
- **`at`** / **`size`** — `[x, y, z]`, world units.
- **`rot`** — `[x, y, z]` in **degrees**. Nobody writes `1.5708` in a file on
  purpose; it is stored in radians after parsing.
- **`color`** — a key into `palette`, never a literal. A kit can then be
  re-skinned in one place, which is the same rule that makes a cottage and a
  cabin one mesh builder in `objectTypes.js`.

`palette` values are `"#rrggbb"` strings rather than JSON numbers, because
`"#a8a49c"` survives a round trip through a text editor recognisably and
`11027612` does not.

**`squash`** is how far the model collapses in the top-down view, and it
defaults to `0.34` rather than to `1`: an author who has not thought about the
map view has authored a thing that hides its own tile.

## `anim` — the parts that move

A part carrying an `anim` is **excluded from the merged prop bake** and drawn
instead by `src/render/FixtureBatch.js`, one `InstancedMesh` per primitive per
place. This is the third reason something stays out of that bake, and it is a
new one: loose items keep out because they *stop existing*, animals because they
*go somewhere*, and a fountain's water because the bake's whole trick is that
its vertices never move.

A fixture therefore costs the town **one extra draw call per primitive it
animates with**, and nothing at all if it animates with none.

| channel | effect | `amp` |
|---|---|---|
| `spin` | turn about local Y | — (`rate` is turns/sec) |
| `bob` | slide along local Y | world units |
| `pulse` | scale about the part's origin | fraction |
| `flow` | fall and repeat — water | drop distance |

Every channel takes `rate` (cycles/sec) and `phase` (a shift within its own
cycle). `phase` is the whole difference between four jets and one jet drawn four
times.

Every channel is a **pure function of the shared clock**. No state, no
per-instance branching, and two players looking at the same fountain see the
same fountain.

## `interact` — the script

```jsonc
"interact": {
  "label": "Make a wish",     // what the HUD prompts. Required.
  "when": { "coins": 1 },     // data. Polled ~10×/sec.
  "run": "fountain.js"        // a plain filename beside the kit.
}
```

`when` takes `coins`, `has`, `room`, `state` (a key of this fixture's own state
that must be truthy), and `not` / `all` / `any`. Deliberately **not**
`dialog.js`'s table, though it reads the same: that vocabulary is about a person
— `flag`, `visits`, `friend` — and a fountain remembers nothing of the sort.

`run` must be a plain `.js` filename in the kit's own directory. It is fetched
as **text** and handed to `src/script/Sandbox.js`. It is never `import()`ed,
never injected into a `<script>`, and never touched by the page's own engine.
That is the single most important sentence in this document: the moment a kit's
script becomes a module, every other precaution here is decoration.

### Where it runs

QuickJS, compiled to WebAssembly. Its heap is a block of linear memory and its
globals are the table below and nothing else — no DOM, no `fetch`, no `window`,
no module loader. `Date.now` and `Math.random` are **deleted**, because every
other source of variety in this codebase is a seeded stream (`core/rng.js`) and
a town has to behave the same on every load.

The engine is fetched lazily, only when a kit that actually carries a script is
loaded, and it lands in its own chunk (~264 KB gzipped). A world of plain
fixtures downloads none of it.

### The API

```js
// READ  — host functions, return copies of primitives
coins()              // how many coins the player is carrying
has(type, n)         // the bag holds at least n
room(type, n)        // the bag could take n more
random()             // seeded 0..1

// ASK   — appended to a list; see below
give(type, n)   take(type, n)   earn(n)   spend(n)   say(text)

// STATE — `state` is this fixture's memory. Scalars only. It is saved.
```

### Writes are proposed, not performed

Nothing in that second row happens when it is written. Each call appends to a
list inside the sandbox, and the host applies the list **only if the script ran
to completion** — through the same small vocabulary a dialog's `do` block uses.

Three things follow, and they are the reason the design is shaped this way:

1. A script that spends a coin and then throws, or runs out of budget, costs the
   player **nothing**. There is no half-applied interaction.
2. The effects of *any* script are a flat list of vetted verbs rather than a
   sequence of live mutations interleaved with someone else's code. Item ids,
   counts and coin amounts are validated on the way out of the sandbox exactly
   as a world file is validated on the way in — at that point the values were
   produced by code we did not write.
3. The code that can spend your coins is code in this repository. The untrusted
   half can only ever ask.

**The engine is not the security boundary — the API is.** Running arbitrary JS
safely buys nothing on its own; what a script can *do* is that table, and that
table is the thing worth reviewing. QuickJS buys expressiveness and resource
bounds, not confinement you weren't going to have to design anyway.

### Budgets

A runaway loop is interrupted, not awaited. A memory bomb hits a ceiling. Both
surface as a warning in the console and "nothing happened" on screen.

| | limit |
|---|---|
| interrupt ticks per press | 200,000 |
| sandbox heap | 4 MB |
| script source | 64 KB |
| effects per press | 16 |
| item count per effect | 99 |
| coins per effect | 9,999 |
| `state`, once written back | 4 KB of JSON |

The caps on effects are not politeness. They are the difference between a buggy
kit and a kit that can empty a save file. They do **not** make a hostile kit
polite — a kit can still `earn(9999)` — because the threat model here is the
host, not the economy. Loading a kit is trusting its author with your save the
way loading a world file is; what it is *not* is trusting them with your browser.

## State, and what is in the save

`state` is a flat object of numbers, strings and booleans, initialised from the
kit and thereafter owned by `src/sim/Fixtures.js` — the fourth thing a place
remembers, alongside its loose items (`Ground.js`), what its people know about
you (`Folk.js`), and what you have chopped out of it (`Edits.js`). All four
exist for one reason: **a file is what a place opens as, never what has happened
to it since.**

Saved per fixture id, laid *over* the kit's defaults on restore — so adding a
field to a kit does not break every save that already had one of its fixtures
in it. A fixture that has never been touched has no entry at all.

`uses` — how many times a fixture has been used — is saved too, because it seeds
`random()`. `Edits.js` makes the opposite call about axe swings and both are
right: two chops into an oak is a thing your arms remember, but a fountain's use
count is the seed of what it gives you next, and dropping it means a reloaded
save re-rolls the same "random" wish forever.

## Validation

Everything a kit can get wrong that is knowable without running it is caught at
load, with a path: an unknown primitive, a `color` with no palette entry, a mask
row of the wrong length, an unknown animation channel, an item type that does
not exist, a script path that climbs out of its own directory.

What is left over is the script, and `npm run checkworld` handles that the only
honest way available — **it presses `E` on every fixture in every place twelve
times**, against a stocked bag and a full purse, and reports what happens. This
is the counterpart to the dialog walk, and it is deliberately not called a
proof. It is a smoke test, and what it catches is the everyday class: a typo, an
item id that does not exist, a runaway loop, a `when` that can never hold, an
effect the host will refuse.

That is the real cost of the script half of this format, stated plainly: a
dialog graph can be walked exhaustively without executing anything, and a kit
cannot. The trade bought a definition that travels.

## Not in v1

- **`kind: "item"`.** The format is shaped to take loose items — same parts, same
  palette, same script — but an item stamps no collision and stacks, so it is a
  different set of required fields and should arrive with its own validation
  rather than by loosening `checkType`.
- **Unloading a kit.** `fixture.fountain` means the same thing in every world,
  the registry is keyed by type rather than by place, and a type unregistered
  while a world still references it is a world that can no longer be parsed.
  Kits are load-once, per session.
- **Fixtures in generated worlds.** `world/generate.js` places no fixtures, so a
  generated island has none. Nothing prevents it; nothing asks for it yet.
