# Tyler's World

A 3D browser world you can flip between an **Animal Crossing-style 3D view** and
a **Pokémon-style 2D top-down view** — of the same world, with an animated morph
between them.

```
npm install
npm run dev        # http://localhost:5173
```

There are four places to start, and seven kinds of animal spread between them —
chickens, ducks, rabbits, sheep, goats, cats and crows. No world has all of
them, and none of them are common, so what is living on a hillside is part of
how you tell one world from another.

**Controls** — `WASD` / arrows to move, `Shift` to run (3D only), `Tab` or `V` to
switch view. `E` picks things up and talks to people; in a conversation, `↑↓`
picks a line, `←→` switches between buying and selling, `Esc` walks away, and
`M` cycles the NPC voice (babble / spoken / off). `Q` puts down what you are
holding, `[` and `]` change which slot that is, and `F` uses it if it is a tool.
`N` sizes the corner minimap — wide, close, the whole place, off — and clicking
the map itself steps through the sizes without ever turning it off. It fades
away on the way into the 2D view, where the whole screen is already that picture.
Two tools open a screen of their own: with the **map** in hand, `F` unfolds it —
scroll or `+`/`-` to zoom, drag or `WASD` to pan, `F` again to find yourself and
once more to put it away — and with the **camera**, `F` takes the picture and
`←→` flips through the roll behind it. `Esc` closes either.
The slider at the bottom scrubs the morph by hand.
The settings gear also switches shorelines between **Natural** (wet sand,
shallows and animated foam) and the original **Blocky** tile edge, and sets how
much water the machine is asked to draw: **Plain** (a still colour), **Ripples**
(travelling waves) or **Sunlit** (a five-train swell with sky reflection, sun
glint, whitecaps, depth, glitter and shallow-water caustics). Both are shader
uniforms, so switching is instant and rebuilds nothing. Graphics preferences are
remembered across worlds and save slots.

Every world has a shopkeeper and two or three neighbours who walk around during
the day. Their conversations, the shop's prices and its stock are all data in
the world file — see [`docs/WORLD_FORMAT.md`](docs/WORLD_FORMAT.md).

**The eight worlds** — *Meadowbrook*, an island with a bluff over the town;
*Sourwood Holler*, a valley with a creek in the bottom; *Tidewrack Atoll*, a
ring of land around a lagoon you cannot cut across; *Thistledown Gap*, a pass
open at both ends with pasture stepping up either wall; *Rimrock Mesa*, a table
in the sky with the ground falling away on all four sides; *Ashkettle Caldera*,
a crater with a warm lake in it and no way out in any direction; *Sedgewater
Fen*, sedge and channels where the walk between two doors a hundred paces apart
goes back past the middle; and *Bellrock Coast*, a beach at the bottom of the
town with downs stepping up behind it. Each is one recipe in
`src/world/recipes.js`, and the same recipes build the random worlds the picker
offers, so a rolled atoll is the same kind of place as the shipped one.

What is off the EDGE of each of them is a `form` — one word in the world file
that tells the renderer what to wrap around the grid, and the answer to why you
cannot walk out. Six of them: sea, ridges, a cliff you are on top of, a rim with
no mouth, standing water, and — on a coast — sea one way and farmland the other.
See `src/world/forms.js`.

**You start with an axe and a shovel**, and both work on the tile you are facing.
Three swings of the axe fells a tree, which drops its wood where it stood and
leaves a stump; the shovel grubs the stump out, opens a hole in grass or sand,
turns up whatever was buried there, and fills the hole back in. A hole is solid
ground gone missing — you cannot walk through one, and neither can a chicken —
so it is a wall you can dig and un-dig. Both tools are ordinary items: sell them,
drop them, or buy another over any shop counter.

**Every other tool is bought.** A shop's rack is where the rest of the verbs
come from, and each one is an ordinary item that takes a slot: a **pickaxe**
breaks rocks the way the axe fells trees, four blows for a boulder and two for a
stone; a **hammer** and a **sword** both hit whatever is in front of you, the
hammer slowly and at arm's length, the sword quickly and further out; a **gun**
shoots down a line and spends a box of shot doing it, and a **machine gun** is the
same gun that keeps firing for as long as you hold `F`. Knocking somebody down
costs you their friendship and their front door until you go back and say hello.

Three of them act on nothing in the world at all. A **map** unfolds the whole
place at once — the corner minimap, full screen, with a wheel to zoom and a
drag to pan. A **camera** photographs exactly what is on screen, in either
view or halfway through the morph, and keeps a roll you can flip through and
save to disk. A **flashlight** throws a beam where you are facing, which is
worth carrying after dark and worth nothing at noon.

What you chop and dig is remembered per place and saved with the game, and it
is remembered as a LIST OF EDITS rather than as a world — the file stays the
source of truth, and a save replays what you did onto it (`sim/Edits.js`).

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

## Seven decisions worth knowing about

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
movement model, and no species-specific collision anywhere. All seven species
share the *one* wander strategy and are still unmistakable, because what
separates a rabbit from a sheep is numbers — how long it stands still, how hard
it moves when it stops standing still, and what its head does meanwhile — and
numbers belong in the species registry, not in a strategy per animal.

**A tile knows whose it is; the player knows whom they have met.** Trespassing
is those two facts meeting and nothing else. A private zone is a dense layer in
the world file naming an owner by id (`docs/WORLD_FORMAT.md`); friendship is
player state that crosses doorways in your pocket alongside your inventory
(`sim/Friends.js`). Neither half knows about the other, which is the only
arrangement where a room can belong to somebody who is not in it — and he is
not in it, because he is outside walking around, which is where you were
supposed to say hello.

**And shooting him is the inverse of saying hello.** It costs what the hello
bought — the friendship, and with it the door — and it leaves him angry for a
day, during which he is not running his own dialog at all but a *grudge script*
(`world/grudge.js`) that has no shop in it, no gossip, and one way out: hand
him whatever is in your hand. Or wait the day out. Either way you end up
strangers rather than friends, and the door opens again the way it did the
first time. A consequence you cannot undo is a punishment; one you can is a
loop.

**A chopped tree does not re-mesh the town.** Every static prop merges into a
handful of world-space buffers, which is the whole reason a town is four draw
calls — and the price of that merge has always been that nothing in it can be
addressed afterwards. So the merge now records a SPAN per object: where that
object's vertices start and how many there are. Felling a tree writes those
few hundred floats to a single point, uploads that sub-range, and leaves every
other prop in the buffer untouched. The stump was meshed at the same time as
the tree, tucked around the foot of the trunk where it reads as root flare,
because adding geometry to a merge is the one thing a merge cannot do — and
revealing something already there is free. A hole is the same argument
answered the other way: carving one out of the terrain would rebuild the whole
ground mesh, so a hole is an instanced disc drawn ON the tile, which is also
exactly what the top-down view wants.

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
public/worlds/*.json              the eight worlds (hand-editable; see docs/)
src/
  core/         constants, coordinate conventions, seeded RNG
  world/        ← no three.js anywhere in here, so the sim is headless-testable
    WorldFile.js    parse + validate JSON, with useful errors
    World.js        runtime typed arrays, derived collision, spatial buckets
    surfaces.js     ground type registry
    forms.js        what is off the edge: one band recipe per world form
    objectTypes.js  object type registry: footprint, mask, height, palette
    animalTypes.js  animal species registry: size, speeds, behaviour, palette
    npcTypes.js     npc registry: size, palette, which body mesh to build
    dialog.js       the dialog script FORMAT: vocabulary + full validation
  sim/
    body.js         the ONE movement simulation — swept circle, shared by all
    Player.js       player state, spawn and doorway placement
    inputs.js       FreeInput (3D) / GridInput (2D) — velocity requests only
    Animal.js       body + behaviour + species
    behaviors.js    Wander (animals), Stroll (villagers) — velocity requests
    Fauna.js        the live animals of one place
    Npc.js/Folk.js  the live people of one place — and what they remember
    Dialogue.js     the conversation machine: nodes, conditions, effects
    Shop.js         stock, prices as rates, and all-or-nothing trades
    Purse.js        coins
    Ground.js       the loose items lying in one place
    Edits.js        what the player has chopped and dug there — and can save
    tools.js        what a verb MEANS: what an axe reaches, what a hole turns up
  audio/
    voice.js        NPC voices: a WebAudio blip synth, or the browser's own
  render/
    CameraRig.js    the morphing camera (perspective ↔ orthographic)
    flatten.js      the shading morph, as a shared uniform
    Terrain.js      terrain mesh, cliff walls, corner AO, shoreline
    water.js        the three water levels, and what each one costs
    props.js        one mesh builder per object type
    PlayerView.js   the character (and the counter-rotation trick)
    AnimalBatch.js  instanced animal models and animation
    NpcView.js      people, same trick again
    ItemBatch.js    instanced models for the things lying on the floor
    DigBatch.js     instanced holes, drawn on the ground rather than cut into it
    Stage.js        scene assembly, morph orchestration
  ui/
    hud.js          the overlay: readouts, pockets, perf panel
    minimap.js      the corner map: a baked static layer, live dots on top
    mapscreen.js    the map tool's screen: the same picture, zoomed and panned
    icons.js        one drawn glyph per item, for the pockets
    photo.js        the camera's roll, and the Save button
    dialogue.js     the conversation box, the buy/sell panel, the typewriter
  settings/
    graphics.js     validated, persistent player graphics preferences
tools/
  genworld.mjs    regenerate the starter worlds  (npm run genworld)
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
