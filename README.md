# Tyler's World

A 3D browser world you can flip between an **Animal Crossing-style 3D view** and
a **Pokémon-style 2D top-down view** — of the same world, with an animated morph
between them.

```
npm install
npm run dev        # http://localhost:5173
```

The town has chickens in it. They run around.

**Controls** — `WASD` / arrows to move, `Shift` to run (3D only), `Tab` or `V` to
switch view. `E` picks things up and talks to people; in a conversation, `↑↓`
picks a line, `←→` switches between buying and selling, `Esc` walks away, and
`M` cycles the NPC voice (babble / spoken / off).
The slider at the bottom scrubs the morph by hand.
The settings gear also switches shorelines between **Natural** (wet sand,
shallows and animated foam) and the original **Blocky** tile edge. Graphics
preferences are remembered across worlds and save slots.

There is a shopkeeper in the general store, and three neighbours who walk around
town during the day. Their conversations, the shop's prices and its stock are
all data in the world file — see
[`docs/WORLD_FORMAT.md`](docs/WORLD_FORMAT.md).

**Say hello before you walk in.** Every house belongs to somebody, and their
front door is shut to you until you have met them — talk to Bramble, Wren or
Tobin out where they live and you are welcome inside afterwards. Walk in first
and you are trespassing: the HUD says so, and you have a few seconds before you
are shown the door. The same goes for the strip behind a shop counter.

---

## The idea

The two views are not two renderers. They are **one scene**, one camera, and one
simulation, with a single scalar `t` morphing between two presentations:

| | `t = 0` — 3D | `t = 1` — 2D |
|---|---|---|
| Camera pitch | 38° | 90° (straight down) |
| Projection | perspective | orthographic |
| Shading | lit, shadowed, fogged | flat unlit albedo |
| Props | full height | squashed toward the ground |
| Ground | plain | tile grid lines fade in |
| Input | analog free walking | turn-in-place, step one tile |

The key realisation: **a top-down orthographic view of a 3D model already *is*
that model's top-down map icon.** The roof of the house seen from overhead is
the Pokémon-map house. So there is exactly *one* representation of every object
— no paired mesh/sprite, no crossfade, and therefore no way for the two views to
disagree about what is in the world.

What separates the two looks is **shading**, not geometry.

## Six decisions worth knowing about

**One coordinate system.** Tile space *is* 3D world space (`x → x`, `z → z`,
`elevation → y`). The top-down camera looks down −y with up = `(0,0,−1)`, so the
2D view is a literal orthographic projection of the 3D world with zero
conversion math. See [`docs/WORLD_FORMAT.md`](docs/WORLD_FORMAT.md).

**One physics.** There is a single continuous swept-circle collision model,
always — and *everything* that moves runs it, the player and every animal alike
(`sim/body.js`). The 2D view does not get its own grid-locked physics; it swaps
the *input filter* (`GridInput` seeks tile centres and turns in place) while the
shared sweep still owns collision. Two collision implementations would mean
every corridor has to satisfy both, toggling views mid-step could strand the
player somewhere one of them considers impossible, and a chicken would sooner or
later find a gap you cannot fit through.

**Edge-based traversal.** A step from tile A to tile B is legal when the two
tiles agree on the height of the edge they share. Cliffs, ramps and shorelines
all fall out of that one rule.

**Behaviours are input filters.** A keyboard filter turns held keys into a
requested velocity; an animal *behaviour* turns the world into one. Same
signature, same physics underneath, neither one allowed to move anything itself.
A chicken wanders, a villager strolls, a dog will follow: three behaviours, one
movement model, and no species-specific collision anywhere.

**A tile knows whose it is; the player knows whom they have met.** Trespassing
is those two facts meeting and nothing else. A private zone is a dense layer in
the world file naming an owner by id (`docs/WORLD_FORMAT.md`); friendship is
player state that crosses doorways in your pocket alongside your inventory
(`sim/Friends.js`). Neither half knows about the other, which is the only
arrangement where a room can belong to somebody who is not in it — and he is
not in it, because he is outside walking around, which is where you were
supposed to say hello.

**Conversations are data, not code.** A shopkeeper's greeting, the line that
only appears when you are carrying three apples, the effect that takes them and
pays you for them, and the choice that opens the till are all JSON in the world
file next to the shelves she stands behind (`world/dialog.js` owns the format,
`sim/Dialogue.js` runs it). The vocabulary is closed — objects, not expression
strings — so every condition and effect in every world file is validated at
load, and `npm run checkworld` walks every conversation to exhaustion and fails
on one the player could not leave.

## Layout

```
public/worlds/meadowbrook.json   the world (hand-editable; see docs/)
src/
  core/         constants, coordinate conventions, seeded RNG
  world/        ← no three.js anywhere in here, so the sim is headless-testable
    WorldFile.js    parse + validate JSON, with useful errors
    World.js        runtime typed arrays, derived collision, spatial buckets
    surfaces.js     ground type registry
    objectTypes.js  object type registry: footprint, mask, height, palette
    animalTypes.js  animal species registry: size, speeds, behaviour, palette
    npcTypes.js     npc registry: size, palette, which body mesh to build
    dialog.js       the dialog script FORMAT: vocabulary + full validation
  sim/
    body.js         the ONE movement simulation — swept circle, shared by all
    Player.js       player state, spawn and doorway placement
    inputs.js       FreeInput (3D) / GridInput (2D) — velocity requests only
    Animal.js       body + behaviour + species
    behaviors.js    Wander (chickens), Stroll (villagers) — velocity requests
    Fauna.js        the live animals of one place
    Npc.js/Folk.js  the live people of one place — and what they remember
    Dialogue.js     the conversation machine: nodes, conditions, effects
    Shop.js         stock, prices as rates, and all-or-nothing trades
    Purse.js        coins
  audio/
    voice.js        NPC voices: a WebAudio blip synth, or the browser's own
  render/
    CameraRig.js    the morphing camera (perspective ↔ orthographic)
    flatten.js      the shading morph, as a shared uniform
    Terrain.js      terrain mesh, cliff walls, corner AO, water
    props.js        one mesh builder per object type
    PlayerView.js   the character (and the counter-rotation trick)
    AnimalBatch.js  instanced animal models and animation
    NpcView.js      people, same trick again
    Stage.js        scene assembly, morph orchestration
  ui/
    hud.js          the overlay: readouts, pockets, perf panel
    dialogue.js     the conversation box, the buy/sell panel, the typewriter
  settings/
    graphics.js     validated, persistent player graphics preferences
tools/
  genworld.mjs    regenerate the starter town   (npm run genworld)
  checkworld.mjs  validate + ASCII-preview a world, headless
  shoot.mjs       screenshot both views in headless Chrome
```

`src/world/` and `src/sim/` import nothing from `src/render/` and no three.js at
all. That line is what makes "one simulation, two views" true rather than
aspirational — `npm run checkworld` loads a world, flood-fills it, *and runs its
chickens for a minute*, with no browser involved.

## Two implementation notes

**Never call `lookAt` on the morphing camera.** At exactly pitch 90° the forward
axis is parallel to the default up vector — a degenerate basis, a NaN matrix, a
black screen — and pitch 90° is precisely the `t = 1` endpoint. The camera's
orientation is built from a `YXZ` Euler instead.

**Roof winding is load-bearing.** Materials are `FrontSide`, so a roof plane
wound the wrong way is invisible. That bug hides almost completely in the 3D
view and eats the entire building in the 2D view, where the roof is the *only*
surface you can see.
