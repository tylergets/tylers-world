/**
 * The two recipes: what Meadowbrook is, and what Sourwood is.
 *
 * Split out of tools/genworld.mjs alongside draft.js so that the browser can
 * run them too -- `npm run genworld` writes the starter files from these, and
 * world/generate.js calls the same functions with a different seed and a
 * jittered shape to make a place nobody has seen before. One recipe, two
 * callers, so a generated island is the same KIND of thing as the shipped one:
 * same cast, same interiors, same rules about who lets you in the front door.
 *
 * EVERY SHAPE NUMBER IS AN ARGUMENT, and every one of them defaults to what the
 * shipped world was authored with. That is what makes the split safe to check:
 * regenerate with no options and the JSON on disk has to come back byte for
 * byte, or the refactor changed a world while claiming not to.
 *
 * The people, their dialog and the interiors they link to are NOT parameters.
 * A generated island moves the coastline, the trees and the houses; it does not
 * invent a villager, because a villager without a script to speak is worse
 * than no villager at all.
 */

import { Draft } from './draft.js';

const HOUSE_PRICE = { 2: 1800, 3: 3600 };

/** Place a recipe-specific housewright on the proven-open approach to the home. */
function addHousewright(d, home, { id, name, title, voice, flavor }) {
  const candidates = [
    [home[0] + 2, home[1] + 3], [home[0], home[1] + 3],
    [home[0] + 3, home[1] + 3], [home[0] + 2, home[1] + 4],
  ];
  const tile = candidates.find(([x, z]) => d.free(x, z, 1, 1, ['g', 'c', 's']));
  if (!tile) throw new Error(`${id}: no open tile beside the player home`);

  d.person({
    id, type: 'folk.villager', tile, facing: 'north',
    props: { name, title, voice },
    dialog: {
      start: 'hello',
      nodes: {
        hello: { text: flavor, then: 'menu' },
        menu: {
          text: 'The footprint stays exactly where it is. We build upward, and every new floor is yours to use.',
          choices: [
            {
              text: `Add a second story — ${HOUSE_PRICE[2]} coin.`,
              when: { houseStories: 1, coins: HOUSE_PRICE[2] },
              do: [{ coins: -HOUSE_PRICE[2] }, { houseStories: 2 }],
              to: 'second',
            },
            {
              text: `I need ${HOUSE_PRICE[2]} coin for the second story.`,
              when: { all: [{ houseStories: 1 }, { not: { coins: HOUSE_PRICE[2] } }] },
              to: 'short',
            },
            {
              text: `Add a third story — ${HOUSE_PRICE[3]} coin.`,
              when: { houseStories: 2, coins: HOUSE_PRICE[3] },
              do: [{ coins: -HOUSE_PRICE[3] }, { houseStories: 3 }],
              to: 'third',
            },
            {
              text: `I need ${HOUSE_PRICE[3]} coin for the third story.`,
              when: { all: [{ houseStories: 2 }, { not: { coins: HOUSE_PRICE[3] } }] },
              to: 'short',
            },
            { text: 'Is the house finished?', when: { houseStories: 3 }, to: 'complete' },
            { text: 'Not today.', to: 'endline' },
          ],
        },
        second: { text: 'Two stories, sound and square. The new stair is ready inside.', then: 'end' },
        third: { text: 'Three stories. Roof raised, chimney drawn, top floor ready. That house is complete.', then: 'end' },
        complete: { text: 'Complete at three stories. Any higher and it stops being a house and starts arguing with the weather.', then: 'end' },
        short: { text: 'Keep the plan. Come back when the purse is ready; the ground will not move.', then: 'end' },
        endline: { text: 'No harm done. A measured house waits better than people do.', then: 'end' },
      },
    },
  });
}

// ===========================================================================
// MEADOWBROOK -- an island
// ===========================================================================
// A round island with a beach all the way round, a bluff over its north half,
// and the town on the flat ground south of it. Everything is laid out from the
// coastline inward, so moving the coast moves the town with it.
export function meadowbrook({
  seed = 0x5eed1234,
  // 64 across, where it used to be 44. The island is a fixed FRACTION of its
  // grid (R/W is unchanged), so everything below is still authored against the
  // centre and the radius -- growing the world is these two numbers and the
  // counts at the bottom, not a re-survey of the town.
  size = 64,
  radius = 27,
  // Three harmonics of the bearing from the centre, as [times round, how far,
  // where it starts]: enough to read as a natural shore, few enough that no bay
  // ever pinches the island in two. A generator may move all nine numbers; what
  // it must not do is add a fourth, faster harmonic, which is where a coastline
  // stops being a coastline and starts being a gear.
  wobble = [[3, 0.10, 0.6], [5, 0.07, 2.1], [8, 0.045, 4.0]],
  // The bluff, as an offset north of centre and a radius. It has to stay over
  // the middle columns: `rampNorth` cuts the only way up it at cx and cx-1, and
  // a bluff that has slid east of those is a cliff with no path.
  bluff = [0, -10, 9.6],
  // Discs of fresh water, offset from the centre. Two, overlapping, because one
  // circle reads as a puddle someone drew with a compass.
  pond = [[-12, 6, 4.3], [-9, 9, 2.7]],
  meta = {
    id: 'meadowbrook',
    name: 'Meadowbrook',
    note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
  },
} = {}) {
  const d = new Draft(size, size, seed);
  const cx = Math.round(size / 2), cz = Math.round(size / 2), R = radius;

  // Coastline.
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) {
      const nx = (x + 0.5 - cx) / R, nz = (z + 0.5 - cz) / R;
      const a = Math.atan2(nz, nx);
      let wob = 1;
      for (const [k, amp, phase] of wobble) wob += amp * Math.sin(k * a + phase);
      const r = Math.hypot(nx, nz) / wob;
      d.surf[z][x] = r < 0.70 ? 'g' : r < 0.84 ? 's' : 'w';
    }
  }

  // The bluff: raised ground over the north half, whose south face is the cliff
  // the whole town sits under. One way down, which is what makes it a landmark
  // rather than a hill.
  d.disc(d.elev, cx + bluff[0], cz + bluff[1], bluff[2], '1');
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) if (d.surf[z][x] === 'w') d.elev[z][x] = '0';
  }

  // Freshwater pond in the west meadow, well inside the shore.
  for (const [dx, dz, r] of pond) d.disc(d.surf, cx + dx, cz + dz, r, 'w');

  const rampZ = d.rampNorth(cx - 1);
  d.rampNorth(cx);

  // Paving, aimed generously; `pave` trims it wherever it overshoots the land.
  d.pave(cx - 6, cz - 18, cx + 5, cz - 13, { level: '1' });   // lookout apron, up top
  d.pave(cx - 1, cz - 13, cx, cz - 3, { level: '1' });        // bluff spine, to the cliff
  d.pave(cx - 1, rampZ, cx, cz + 15, { level: '0' });         // road off the ramp, into town
  d.pave(cx - 11, cz + 10, cx + 13, cz + 15, { level: '0' }); // town plaza
  d.pave(cx - 3, cz + 16, cx + 2, cz + 28, { level: '0' });   // boardwalk to the south beach

  const lookout = d.placeNear('gate.north', 'building.gate', cx - 4, cz - 16, ['c', 'g'], 8,
    { label: 'Meadowbrook Lookout' }, '1');
  const home = d.placeNear('home.player', 'building.home', cx - 10, cz + 4, ['g'], 10,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.nook', 'building.store', cx + 8, cz + 3, ['g'], 10,
    { label: 'General Store', interior: 'worlds/interiors/store-nook.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', cx + 15, cz + 3, ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');

  // THE NEIGHBOURS. Three houses round the plaza, each with somebody living in
  // it, and each interior a place you are not welcome until you have met them
  // (the private zone is declared in the interior file -- see
  // docs/WORLD_FORMAT.md). They are spread deliberately: the whole feature is
  // walking up to a stranger, so the three of them must not be findable from
  // one spot on the square.
  const cottage = d.placeNear('home.bramble', 'building.cottage', cx - 14, cz + 14, ['g'], 10,
    { label: "Bramble's Cottage", interior: 'worlds/interiors/home-bramble.json' }, '0');
  const cabin = d.placeNear('home.wren', 'building.cabin', cx + 4, cz + 19, ['g', 's'], 10,
    { label: "Wren's Cabin", interior: 'worlds/interiors/home-wren.json' }, '0');
  const bungalow = d.placeNear('home.tobin', 'building.bungalow', cx + 15, cz + 8, ['g'], 10,
    { label: "Tobin's Bungalow", interior: 'worlds/interiors/home-tobin.json' }, '0');

  // Approaches, drawn AFTER placement so a building that had to shuffle takes
  // its path with it. Doors face south, so the approach starts below them.
  d.pathL(home[0] + 1, home[1] + 3, cx - 1, cz + 11, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, cx, cz + 11, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, cx + 7, cz + 11, { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, cx - 10, cz + 12, { level: '0' });
  d.pathL(cabin[0] + 2, cabin[1] + 3, cx + 1, cz + 20, { level: '0' });
  d.pathL(bungalow[0] + 2, bungalow[1] + 3, cx + 11, cz + 12, { level: '0' });
  d.pathL(lookout[0] + 2, lookout[1] + 2, cx - 1, cz - 13, { level: '1' });
  addHousewright(d, home, {
    id: 'folk.renna', name: 'Renna', title: 'Meadowbrook Housewright',
    voice: { pitch: 1.08, rate: 23, timbre: 'triangle' },
    flavor: 'Renna. I set rafters by the wind off the meadow. Your foundations will carry two floors more without stealing another inch of garden.',
  });

  // The people, standing on their own doorsteps -- the tile directly south of
  // the door, which is the one tile outside every house that placement has
  // already proved you can walk to. `roam` is what sends them
  // wandering (sim/behaviors.js), and it is sized to keep each of them within
  // sight of their own front garden: someone you have to hunt for is someone
  // whose house you will burgle instead.
  d.person({
    id: 'folk.pim',
    type: 'folk.villager',
    tile: [cx + 1, cz + 12],
    facing: 'west',
    props: {
      name: 'Pim',
      title: 'Loiterer',
      roam: 6,
      voice: { pitch: 0.84, rate: 20, timbre: 'sawtooth' },
    },
    schedule: [
      { at: 6, tile: [cx + 1, cz + 12], facing: 'west', activity: 'Watching the square' },
      { at: 12, tile: [cx - 1, cz + 11], facing: 'south', activity: 'Taking the long way nowhere' },
      { at: 20, tile: [cx + 1, cz + 12], facing: 'north', activity: 'Gone quiet', available: false },
    ],
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { time: { from: 5, to: 9 } }, to: 'early' },
            { when: { visits: 9 }, to: 'ninth' },
            { when: { flag: 'gave' }, to: 'after' },
            { when: { visits: 3 }, to: 'third' },
            { to: 'hello' },
          ],
        },
        early: { text: 'You are up early. I would say I was too, but I have not been to bed yet.', then: 'menu' },
        hello: {
          text: [
            'Morning. Chickens been at the flowerbed again. Third time this week, and it is Tuesday.',
            "Pim. I'm not doing anything, before you ask. Nobody round here believes that either.",
            "Marla's shop is the blue roof, if you're looking. She's fair. Fairer than she needs to be.",
          ],
          then: 'menu',
        },
        third: {
          text: "You do walk about a lot, don't you. I like that in a person. Saves me doing it.",
          then: 'menu',
        },
        ninth: {
          text: [
            "Here's a thing. I've watched you go past this spot more times than I've seen Tobin leave his house.",
            'And I have lived here longer than he has.',
          ],
          then: 'menu',
        },
        after: {
          text: "Flowerbed's holding up. Mind the chickens. They know your face now and they have opinions.",
          then: 'menu',
        },
        menu: {
          text: 'Anything else?',
          choices: [
            {
              text: 'Could you spare a flower?',
              when: {
                all: [
                  { room: { type: 'item.flower', count: 1 } },
                  { not: { flag: 'gave' } },
                ],
              },
              to: 'gift',
            },
            { text: 'Where does that gate go?', to: 'gate' },
            { text: 'Who else lives here?', to: 'folk' },
            {
              text: 'What do you do all day?',
              when: { not: { flag: 'asked.day' } },
              to: 'day',
            },
            { text: "What's the fountain for?", to: 'fountain' },
            {
              text: 'Anyone fallen out with anyone?',
              when: { visits: 4 },
              to: 'gossip',
            },
            { text: "I'll let you get on.", to: 'bye' },
          ],
        },
        gift: {
          text: "Take one, they grow back faster than I can pick them. Don't tell Bramble where you got it.",
          do: [{ give: { type: 'item.flower', count: 1 } }, { set: 'gave' }],
          then: 'menu',
        },
        gate: {
          text: [
            'North, out of town. Long walk and nothing at the end of it yet.',
            'I say yet. I have been saying yet for eleven years.',
          ],
          then: 'menu',
        },
        folk: {
          text: [
            "Bramble's the one in the green apron, west side. Cottage with the green roof, and half of it is glass -- he grows things in there he will not talk about.",
            "Wren's down on the sand. Low cabin. She has a boat indoors, upside down, and has had for two summers.",
            "Tobin you'll smell before you see -- solder. Long house, orange roof. Two rooms and a wall between them, which is unusual round here.",
            "Say hello before you go walking into their houses. They're funny about that, and I'd be too.",
          ],
          then: 'menu',
        },
        day: {
          text: [
            'This. I stand here and things happen in front of me, and then I know about them.',
            "It is not much of a trade but there's no season for it.",
          ],
          do: { set: 'asked.day' },
          then: 'menu',
        },
        fountain: {
          text: [
            'Coin in, wish out. That is the arrangement, and the fountain has never signed anything.',
            'It gave Tobin his money back once. He put it straight in again, which tells you about Tobin.',
          ],
          then: 'menu',
        },
        gossip: {
          text: [
            'Bramble thinks Wren leaves the tide out on purpose. Wren thinks Bramble talks to his vegetables.',
            'They are both right, and they are civil about it, which is the most you get from neighbours.',
          ],
          then: 'menu',
        },
        bye: { text: 'Right you are.' },
      },
    },
  });

  d.person({
    id: 'folk.bramble',
    type: 'folk.gardener',
    tile: [cottage[0] + 1, cottage[1] + 3],
    facing: 'south',
    props: {
      name: 'Bramble',
      title: 'Grows things',
      roam: 6,
      voice: { pitch: 0.78, rate: 20, timbre: 'triangle' },
    },
    schedule: [
      { at: 6, tile: [cottage[0] + 1, cottage[1] + 3], facing: 'south', activity: 'Tending the beds' },
      { at: 13, tile: [cx - 10, cz + 12], facing: 'east', activity: 'Checking the roadside soil' },
      { at: 20, tile: [cottage[0] + 1, cottage[1] + 3], facing: 'north', activity: 'Inside for the night', available: false },
    ],
    errands: [
      { id: 'shade-crop', title: 'Gather mushrooms', objective: { kind: 'gather', item: 'item.mushroom', count: 3 }, reward: { coins: 45, relationship: 18 } },
      { id: 'winter-bundle', title: 'Dry flowers', objective: { kind: 'process', fixture: 'fixture.dryrack', count: 1 }, reward: { coins: 30, relationship: 12 } },
    ],
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { errand: { id: 'shade-crop', status: 'ready' } }, to: 'mushrooms.done' },
            { when: { errand: { id: 'winter-bundle', status: 'ready' } }, to: 'drying.done' },
            {
              when: { relationship: { atLeast: 'friend' } },
              to: 'regular',
            },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            "Don't mind me, I'm up to my wrists in it.",
            "Bramble. That's my cottage behind you -- green roof, glass along the north side. Door's open to you now we've met.",
            "Wipe your feet or don't, it is all soil in there anyway.",
          ],
          then: 'menu',
        },
        welcome: {
          text: "Back again. Go on in if you like, I'll be out here a while yet. Lift the frame if you want, just put the glass down gently.",
          then: 'menu',
        },
        regular: {
          text: [
            "There you are. I told the beans you'd be by.",
            "They don't answer. That is not the point of telling them.",
          ],
          then: 'menu',
        },
        menu: {
          text: 'Something you wanted?',
          choices: [
            { text: 'Need anything gathered?', when: { errand: { id: 'shade-crop', status: 'available' } }, to: 'mushrooms.offer' },
            { text: 'Any work at the drying rack?', when: { errand: { id: 'winter-bundle', status: 'available' } }, to: 'drying.offer' },
            {
              text: 'Anything growing worth having?',
              when: { room: { type: 'item.mushroom', count: 2 } },
              to: 'gift',
            },
            {
              text: "What's under the glass?",
              when: { not: { flag: 'asked.frame' } },
              to: 'frame',
            },
            { text: 'What is all that hanging up inside?', to: 'rack' },
            { text: 'What is there to do round here?', to: 'advice' },
            {
              text: 'How are the neighbours?',
              when: { visits: 3 },
              to: 'neighbours',
            },
            {
              text: 'I found this. Any use to you?',
              when: { has: { type: 'item.stone', count: 1 } },
              to: 'stone',
            },
            { text: 'Just passing.', to: 'bye' },
          ],
        },
        'mushrooms.offer': { text: 'Three mushrooms from the wild shade. Picked by you, not borrowed from my trays.', do: { errand: { id: 'shade-crop', action: 'accept' } }, then: 'menu' },
        'mushrooms.done': { text: 'Those are the ones. Good caps, clean stems. You have an eye for the damp places.', do: { errand: { id: 'shade-crop', action: 'complete' } }, then: 'menu' },
        'drying.offer': { text: 'Take two flowers to my rack indoors and turn them into one dry bundle. The rack will show you.', do: { errand: { id: 'winter-bundle', action: 'accept' } }, then: 'menu' },
        'drying.done': { text: 'A proper dry bundle. That will hold its colour through winter.', do: { errand: { id: 'winter-bundle', action: 'complete' } }, then: 'menu' },
        gift: {
          text: 'Take these. Came up under the pines after the rain, and the rain did all the work.',
          do: [{ give: { type: 'item.mushroom', count: 2 } }],
          then: 'menu',
        },
        frame: {
          text: [
            'Seed frame. Brick sides, glass on top, and about four degrees of difference -- which is the whole of it in March.',
            'There is a shady corner of it I did not sow and something keeps coming up in it. I have stopped arguing.',
          ],
          do: { set: 'asked.frame' },
          then: 'menu',
        },
        rack: {
          text: [
            'Drying. Everything in this village is either growing or drying and I am the reason for both.',
            'Do not eat the bundle on the left. It is not food yet and it may never be.',
          ],
          then: 'menu',
        },
        advice: {
          text: [
            "Walk about. Talk to folk. Half the doors in this town open once you've said hello to whoever's behind them.",
            "The other half you can try, but you'll not be in there long.",
          ],
          then: 'menu',
        },
        neighbours: {
          text: [
            'Wren is good company if you can stand being told the tide. Which you cannot change, so why she tells me I do not know.',
            'Tobin is the best of us and would deny it, at length, with numbers.',
          ],
          then: 'menu',
        },
        stone: {
          text: [
            'A pebble. Aye, I will have that -- goes in the bottom of a pot so the water knows where to leave.',
            "Here's a coin for it, which is more than it is worth and less than it does.",
          ],
          do: [{ take: { type: 'item.stone', count: 1 } }, { coins: 7 }],
          then: 'menu',
        },
        bye: { text: 'Mind the beds on your way past.' },
      },
    },
  });

  d.person({
    id: 'folk.wren',
    type: 'folk.fisher',
    tile: [cabin[0] + 2, cabin[1] + 3],
    facing: 'south',
    props: {
      name: 'Wren',
      title: 'Works the shallows',
      roam: 7,
      voice: { pitch: 1.28, rate: 32, timbre: 'square' },
    },
    schedule: [
      { at: 5, tile: [cabin[0] + 2, cabin[1] + 3], facing: 'south', activity: 'Reading the tide' },
      { at: 11, tile: [cx + 1, cz + 20], facing: 'west', activity: 'Working the shallows' },
      { at: 19, tile: [cabin[0] + 2, cabin[1] + 3], facing: 'north', activity: 'Mending gear', available: false },
    ],
    errands: [
      { id: 'pond-supper', title: 'Catch trout', objective: { kind: 'fish', item: 'item.trout', count: 2 }, reward: { coins: 80, relationship: 22 } },
    ],
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { errand: { id: 'pond-supper', status: 'ready' } }, to: 'trout.done' },
            {
              when: { all: [{ friend: true }, { flag: 'boat' }] },
              to: 'boatagain',
            },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Careful, you nearly went in.',
            "Wren. Cabin's mine, the low one on the sand. Come in out of the weather whenever, now I know your face.",
            'Step up at the far end. Everything I care about is on the dry half.',
          ],
          then: 'menu',
        },
        welcome: {
          text: "Tide's out. Good day for it. Don't say anything nice, I've had a good morning and I'd like to keep it.",
          then: 'menu',
        },
        boatagain: {
          text: 'Boat is still upside down, before you ask. It is not a question, it is a season.',
          then: 'menu',
        },
        menu: {
          text: 'Well?',
          choices: [
            { text: 'Need anything from the water?', when: { errand: { id: 'pond-supper', status: 'available' } }, to: 'trout.offer' },
            {
              text: 'Found any shells?',
              when: { room: { type: 'item.shell', count: 1 } },
              to: 'gift',
            },
            {
              text: "There's a boat in your house.",
              when: { not: { flag: 'boat' } },
              to: 'boat',
            },
            { text: "What's in the barrel?", to: 'barrel' },
            { text: 'Marla buys shells, I hear.', to: 'trade' },
            { text: 'What is the weather doing?', to: 'weather' },
            {
              text: 'I have sticks, if you need them.',
              when: { has: { type: 'item.stick', count: 3 } },
              to: 'sticks',
            },
            { text: "I'll leave you to it.", to: 'bye' },
          ],
        },
        'trout.offer': { text: 'Two trout, caught on your line. Not bought and not found on a floor. Bring me the story; keep the fish.', do: { errand: { id: 'pond-supper', action: 'accept' } }, then: 'menu' },
        'trout.done': { text: 'Two clean catches. You listened to the water instead of fighting it. That is rarer than trout.', do: { errand: { id: 'pond-supper', action: 'complete' } }, then: 'menu' },
        gift: {
          text: "Here. I've a bucket of them and one pair of hands. Don't thank me.",
          do: [{ give: { type: 'item.shell', count: 1 } }],
          then: 'menu',
        },
        boat: {
          text: [
            'There is. Two planks off her port side and one of them is the one that matters.',
            'She goes back in when she is right and not a day before. You can look under her. Everybody does.',
          ],
          do: { set: 'boat' },
          then: 'menu',
        },
        barrel: {
          text: [
            'Bait. You asked.',
            'It has been in there since the last time it was cold and it is doing something I have decided not to look at.',
          ],
          then: 'menu',
        },
        trade: {
          text: "She does, and she pays properly for them. Don't tell her I said so.",
          then: 'menu',
        },
        weather: {
          text: [
            'Coming round to the north by evening, and that means nothing to you and everything to me.',
            'Ask me again tomorrow and I will tell you I said so.',
          ],
          then: 'menu',
        },
        sticks: {
          text: [
            'Three? I will take two. One is for the fire and one is going in that hull whether it likes it or not.',
            'Here. That is trade, not thanks.',
          ],
          do: [{ take: { type: 'item.stick', count: 2 } }, { coins: 12 }],
          then: 'menu',
        },
        bye: { text: 'Aye. Watch the current.' },
      },
    },
  });

  d.person({
    id: 'folk.tobin',
    type: 'folk.tinker',
    tile: [bungalow[0] + 2, bungalow[1] + 3],
    facing: 'south',
    props: {
      name: 'Tobin',
      title: 'Mends what he can',
      roam: 5,
      voice: { pitch: 0.94, rate: 16, timbre: 'sawtooth' },
    },
    schedule: [
      { at: 7, tile: [bungalow[0] + 2, bungalow[1] + 3], facing: 'south', activity: 'Sorting repairs' },
      { at: 14, tile: [cx + 11, cz + 12], facing: 'west', activity: 'Looking for straight timber' },
      { at: 21, tile: [bungalow[0] + 2, bungalow[1] + 3], facing: 'north', activity: 'Workshop closed', available: false },
    ],
    errands: [
      { id: 'clearfall', title: 'Fell trees', objective: { kind: 'change', change: 'fell', category: 'tree', count: 2 }, reward: { item: { type: 'furnitem.crate', count: 1 }, relationship: 20 } },
    ],
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { errand: { id: 'clearfall', status: 'ready' } }, to: 'timber.done' },
            {
              when: { all: [{ friend: true }, { flag: 'orrery' }] },
              to: 'orreryagain',
            },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Hm? Oh. Hello.',
            "Tobin. The long house with the orange roof. You're welcome in it, though I warn you there's nowhere to sit.",
            'Two rooms. Work in the front, live in the back. The wall was not my idea but it was the right one.',
          ],
          then: 'menu',
        },
        welcome: {
          text: "It's you. Mind the crates. Second one from the door is heavier than it looks and I have stopped apologising for it.",
          then: 'menu',
        },
        orreryagain: {
          text: [
            'You wound it again.',
            'It does not mind. Nothing in this house minds being used, that is the entire point of a house.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Was there something?',
          choices: [
            { text: 'Need timber work done?', when: { errand: { id: 'clearfall', status: 'available' } }, to: 'timber.offer' },
            {
              text: 'Could you use a few sticks?',
              when: { has: { type: 'item.stick', count: 2 } },
              to: 'trade',
            },
            { text: 'What are you making?', to: 'making' },
            {
              text: 'What is the brass thing on the stand?',
              when: { not: { flag: 'orrery' } },
              to: 'orrery',
            },
            {
              text: 'The bench with the pedal -- what does that do?',
              to: 'treadle',
            },
            {
              text: 'Could you look at this pebble?',
              when: {
                all: [
                  { has: { type: 'item.stone', count: 1 } },
                  { not: { flag: 'pebble' } },
                ],
              },
              to: 'pebble',
            },
            {
              text: 'You should charge more.',
              when: { coins: 200 },
              to: 'charge',
            },
            { text: 'Nothing. Sorry.', to: 'bye' },
          ],
        },
        'timber.offer': { text: 'Fell two trees anywhere they need clearing. I need the work measured, not the wood; keep what drops.', do: { errand: { id: 'clearfall', action: 'accept' } }, then: 'menu' },
        'timber.done': { text: 'Two trees down and room left where they stood. Take this crate flat-pack. A room should be allowed to change its mind.', do: { errand: { id: 'clearfall', action: 'complete' } }, then: 'menu' },
        trade: {
          text: "I could. Ash, is it. Yes. Here's for your trouble.",
          do: [{ take: { type: 'item.stick', count: 2 } }, { coins: 18 }],
          then: 'menu',
        },
        making: {
          text: "Nothing. Mending. There's a difference and it's most of my week.",
          then: 'menu',
        },
        orrery: {
          text: [
            'That is not for anything.',
            'It goes round. Six turns of the key and it goes round for about a minute, and none of it is labelled.',
            'I built it the winter I came here, when there was nothing to mend yet. It is the only thing I have made that was not asked for.',
          ],
          do: { set: 'orrery' },
          then: 'menu',
        },
        treadle: {
          text: [
            'Foot goes on the bar, bar drives the cord, cord turns the plate. Then both my hands are free, which is the whole invention.',
            'Two hundred years old, that idea, and still nobody has improved on having hands.',
          ],
          then: 'menu',
        },
        pebble: {
          text: [
            'Hm. Turn it over. There -- see the line. That has been through a fire and come out the other side.',
            'Keep it. I would like to know where you found it, when you remember.',
          ],
          do: [{ set: 'pebble' }, { coins: 5 }],
          then: 'menu',
        },
        charge: {
          text: [
            'For mending? No. A thing that is broken is already costing somebody something.',
            'I am not short. There are coins in the case of that orrery I have not bothered to get out.',
          ],
          then: 'menu',
        },
        bye: { text: 'Right. Mind the step.' },
      },
    },
  });

  // Counts scale with the island, not with the old grid: a 64-tile world with
  // a 44-tile world's worth of trees in it reads as a lawn.
  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 11, ['g', 's']),
    oak: d.scatter('oak', 'tree.oak', 70, ['g']),
    pine: d.scatter('pine', 'tree.pine', 38, ['g']),
    palm: d.scatter('palm', 'tree.palm', 40, ['s']),
    rock: d.scatter('rock', 'rock.small', 36, ['g', 's']),
    // Last, so the birds dodge the scenery rather than the other way round:
    // trees claim tiles, and a chicken is only ever standing on one.
    //
    // FOUR SPECIES, FOUR PLACES, AND NOT MANY OF ANY OF THEM. A handful per
    // species, seeded over a wide patch, is doing something a crowd cannot:
    // rounding a hedge and finding two rabbits is a small event, and walking
    // through a field with twenty in it is weather. The counts are low enough
    // that most of the island has no animal on it at all, which is the only
    // way the parts that do can read as somewhere in particular.
    //
    // An animal keeps to the patch it starts in, so
    // where a flock is seeded is the whole of what the player learns from it:
    // ducks mean there is water here, rabbits mean nobody comes out this far,
    // and a cat on the square means somebody feeds it. Scattering all four
    // evenly over the island would say none of that, and would also make the
    // three other worlds indistinguishable from this one from ten feet up.
    chicken: d.flock('chicken', 'chicken', 4, home[0] + 1, home[1] + 5, 5, ['g', 'c']),
    // Seeded ON the pond: water is not in `allow`, so every one of them lands
    // on the ring of grass around it, which is exactly where a duck stands.
    duck: d.flock('duck', 'duck', 3, cx + pond[0][0], cz + pond[0][1], 6, ['g']),
    // The far west meadow, which otherwise has nothing in it and no reason to
    // be walked to.
    rabbit: d.flock('rabbit', 'rabbit', 2, cx - 17, cz - 2, 7, ['g']),
    cat: d.flock('cat', 'cat', 1, cx + 2, cz + 13, 5, ['c', 'g']),

    // Foraging, sorted by where the thing would actually be: shells wash up on
    // the beach, mushrooms come up in the shade of the woods, apples fall near
    // the house someone planted the trees behind. Scattering all five kinds
    // uniformly over the island would be quicker to write and would make the
    // whole map read as one undifferentiated place to hoover up.
    shell: d.litter('shell', 'item.shell', 16, ['s']),
    stone: d.litter('stone', 'item.stone', 12, ['s', 'g']),
    stick: d.litter('stick', 'item.stick', 14, ['g']),
    flower: d.litter('flower', 'item.flower', 14, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 9, ['g'], { cx: cx + 8, cz: cz + 16, radius: 12 }),
    apple: d.litter('apple', 'item.apple', 8, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta,
      terrain: { form: 'island' },
      spawn: { tile: [cx - 1, rampZ + 3], facing: 'south' },
    }),
  };
}

// ===========================================================================
// SOURWOOD -- a holler
// ===========================================================================
// Long and narrow, because that is the shape of the landform: a creek in the
// bottom, a road beside it, benches stepping up both walls, the head closed off
// at the north and the mouth open at the south. The two walls are what the
// renderer continues into ridges, so the layout's job is to be climbing by the
// time it reaches the east and west edges.
export function sourwood({
  seed = 0xc0ffee31,
  // 42 x 84, where it used to be 30 x 60: the same holler, longer and with
  // more bottomland in it. Everything below is written against W, H and FLOOR,
  // so the shape survives the change -- the creek keeps the same number of
  // bends over a longer run, and the walls still reach the top bench before
  // they reach the edge.
  width = 42,
  height = 84,
  floor = 9,                     // half-width of the bottomland, in tiles
  // Two tiles per bench, not one. A single-tile bench is severed by the first
  // tree that lands on it -- and a bench you cannot walk along is scenery the
  // player can see, stand next to, and never use.
  bench = 2.2,
  // The creek's wander, as [per-row frequency, half-width, phase]. Frequencies
  // are per ROW so they scale with the length: a longer valley with a fixed
  // bend count would be a corkscrew.
  creekWave = [[0.0786, 4.5, 0.5], [0.193, 1.3, 1.9]],
  // Rows where the creek is forded, and rows where a trail climbs a wall as
  // [row, which way]. Both are given rather than derived because both are about
  // the SHAPE of the valley -- where it is worth crossing, where the wall is
  // climbable -- and a generator that moves the length has to move them too.
  fords = [24, 45, 64, 77],
  trails = [[28, -1], [52, 1]],
  // Which row each landmark wants to stand on. `placeNear` does the rest.
  sites = { gate: 73, home: 36, store: 62 },
  spawnRow = 42,
  meta = {
    id: 'sourwood',
    name: 'Sourwood Holler',
    note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
  },
} = {}) {
  const d = new Draft(width, height, seed);
  const axis = d.W / 2;          // the valley runs due south
  const FLOOR = floor;
  const BENCH = bench;

  /**
   * WHY THE WALLS RUN STRAIGHT
   * --------------------------
   * A bench's elevation depends on x alone, so every bench is one unbroken
   * strip from the head to the mouth. Let the wall wander with the creek
   * instead and each bench acquires a north-south step every few rows -- a
   * cliff, since two tiles at different heights never share an edge height --
   * which chops the hillside into a few hundred flat shelves you can see and
   * cannot reach. The wander belongs to the creek, which has it; the walls
   * just have to hold the valley.
   */
  const creek = (z) => creekWave.reduce((c, [k, amp, phase]) => c + amp * Math.sin(z * k + phase), axis);

  /**
   * The mouth. Flaring the bottomland outward over the last rows is what makes
   * the south edge genuinely open: the benches are pushed off the map rather
   * than lowered, so no shelf is ever stranded above a step it cannot descend.
   */
  // Linear, and deliberately slower than one tile per row: a boundary that
  // sweeps outward faster than that skips over a bench, stranding it above a
  // step with nothing beside it at the same height.
  const flare = (z) => (z < d.H - 22 ? 0 : 0.9 * (z - (d.H - 22)));

  for (let z = 0; z < d.H; z++) {
    const c = creek(z), fh = FLOOR + flare(z);
    // The head of the holler, where the ground closes over the top of it.
    const head = z < 13 ? Math.min(4, Math.round((13 - z) * 0.44)) : 0;
    for (let x = 0; x < d.W; x++) {
      const wall = Math.min(4, Math.max(0, Math.ceil((Math.abs(x + 0.5 - axis) - fh) / BENCH)));
      const e = Math.max(wall, head);
      d.elev[z][x] = String(e);

      // Creek in the bottom, gravel bar beside it. Both only where it is flat,
      // so the creek rises out of the head rather than running down a cliff.
      const dc = Math.abs(x + 0.5 - c);
      d.surf[z][x] = e > 0 ? 'g' : dc < 1.15 ? 'w' : dc < 1.95 ? 's' : 'g';
    }
  }

  // Low-water crossings. The creek runs the whole length of the only flat
  // ground there is, so without a ford the two banks are two different places
  // -- and the one with the house on it is the one you cannot reach.
  for (const z of fords) {
    for (let dz = 0; dz < 2; dz++) {
      for (let x = 0; x < d.W; x++) if (d.surf[z + dz][x] === 'w') d.surf[z + dz][x] = 's';
    }
    d.pave(0, z, d.W - 1, z + 1, { level: '0', onto: ['g'] });
  }

  // The road runs the length of the bottom, east of the creek and clear of it.
  for (let z = 0; z < d.H; z++) {
    const x0 = Math.round(creek(z)) + 4;
    d.pave(x0, z, x0 + 1, z, { level: '0', onto: ['g'] });
  }

  // One trail up each wall, from beside the road. Each climbs every bench its
  // row has, and since the benches are unbroken strips, one trail per side is
  // enough to make the whole hillside walkable.
  for (const [z, dir] of trails) d.trail(z, Math.round(creek(z)) + 6 * dir, dir);

  const gate = d.placeNear('gate.mouth', 'building.gate', Math.round(creek(sites.gate)) + 2, sites.gate, ['c', 'g'], 10,
    { label: 'Sourwood Holler' }, '0');
  const home = d.placeNear('home.holler', 'building.home', Math.round(creek(sites.home)) - 8, sites.home, ['g'], 11,
    { label: 'The Old Place', interior: 'worlds/interiors/home-holler.json', playerHome: true }, '0');
  const store = d.placeNear('store.branch', 'building.store', Math.round(creek(sites.store)) + 6, sites.store, ['g'], 11,
    { label: 'Branch Store', interior: 'worlds/interiors/store-branch.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');

  // Each door out to the road. The road is the only through-line in a holler,
  // so everything hangs off it.
  d.pathL(home[0] + 1, home[1] + 3, Math.round(creek(home[1] + 4)) + 4, home[1] + 4, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, Math.round(creek(store[1] + 5)) + 4, store[1] + 5, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, Math.round(creek(furniture[1] + 5)) + 4, furniture[1] + 5, { level: '0' });
  d.pathL(gate[0] + 2, gate[1] + 2, Math.round(creek(gate[1] + 3)) + 4, gate[1] + 3, { level: '0' });
  addHousewright(d, home, {
    id: 'folk.eldra', name: 'Eldra', title: 'Holler Carpenter',
    voice: { pitch: 0.82, rate: 19, timbre: 'sawtooth' },
    flavor: 'Eldra. Old holler timber talks before it breaks. Yours says the stone is deep and the house can climb without spreading into the creek.',
  });

  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 18, ['g', 's'], 4200, '0'),
    pine: d.scatter('pine', 'tree.pine', 140, ['g'], 4200),
    oak: d.scatter('oak', 'tree.oak', 80, ['g'], 4200),
    rock: d.scatter('rock', 'rock.small', 54, ['g', 's'], 4200),
    // Down in the bottomland by the old place, not up a wall: a chicken keeps
    // to the patch it starts in, so the patch has to be somewhere you walk past.
    chicken: d.flock('chicken', 'chicken', 3, home[0] + 1, home[1] + 5, 4, ['g', 'c']),
    // The rest of the holler's animals are deliberately NOT beside the road.
    // A valley is a place you have to climb around, and the reward for taking a
    // trail up a wall should be finding something living up there -- so the
    // sheep and the goats are seeded on the benches the trails serve, one on
    // each side, and the only way to see either is to go up.
    sheep: d.flock('sheep', 'sheep', 3, Math.round(creek(trails[0][0])) - 11, trails[0][0] + 4, 7, ['g']),
    goat: d.flock('goat', 'goat', 2, Math.round(creek(trails[1][0])) + 11, trails[1][0] - 4, 8, ['g']),
    // Crows in the shut head of the holler, where the pines are thickest.
    crow: d.flock('crow', 'crow', 3, Math.round(axis), 18, 9, ['g']),
    // And ducks on the creek. Gravel bars count: half a duck's day is spent on
    // the shingle beside the water rather than in it.
    duck: d.flock('duck', 'duck', 2, Math.round(creek(fords[1] + 6)), fords[1] + 6, 5, ['g', 's']),

    // A holler forages differently from an island: no shells, and the pebbles
    // are on the gravel bars in the creek bottom rather than on a beach.
    stick: d.litter('stick', 'item.stick', 20, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 16, ['g']),
    stone: d.litter('stone', 'item.stone', 15, ['s']),
    flower: d.litter('flower', 'item.flower', 13, ['g']),
    apple: d.litter('apple', 'item.apple', 7, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta,
      terrain: { form: 'holler', open: ['south'] },
      spawn: { tile: [Math.round(creek(spawnRow)) + 4, spawnRow], facing: 'south' },
      // A holler holds its haze. Pulling the fog in is most of what separates
      // "steep valley" from "field with a hill either side".
      ambience: { fog: [18, 58] },
    }),
  };
}

// ===========================================================================
// TIDEWRACK -- an atoll
// ===========================================================================
// Meadowbrook's form and Meadowbrook's opposite: a RING of land with the sea
// outside it and a lagoon inside. Everything follows from that one decision.
// The town is strung out around a circle instead of gathered under a bluff, no
// two neighbours are in sight of each other, and the middle of the map -- the
// part every other world puts its square on -- is water you cannot cross. To
// meet everybody here you walk the whole ring, and that is the place's entire
// argument for existing.
//
// It shares the player's house with the other starters, because that is the
// player's house. Everything else in it is its own.
export function tidewrack({
  seed = 0x7a1de5,
  size = 68,
  radius = 28,
  // Two independent sets of harmonics, one per shore. An atoll whose lagoon
  // echoes its coastline is a doughnut somebody stamped out: the ring never
  // widens or narrows, and the width of the ring is the whole experience of
  // walking it. Letting the two shores wander separately is what gives the
  // place a broad side and a thin one.
  wobble = [[3, 0.09, 1.4], [5, 0.06, 3.1], [8, 0.04, 0.5]],
  lagoonWobble = [[2, 0.10, 2.7], [4, 0.07, 5.2]],
  // The bands, as fractions of the radius, from the middle outward: lagoon
  // water, the inner beach, the grass ring, the outer beach, then open sea.
  // The last one has to leave the sea room to start inside the grid on every
  // bearing -- see verifyForm -- which is what caps it well under 1.
  bands = { lagoon: 0.24, inner: 0.34, grass: 0.76, shore: 0.88 },
  // The dune: an offset from the centre and a radius. It sits on the north arm
  // and it is the only high ground on the atoll, which makes it the only place
  // you can see the shape of the place you are standing on.
  dune = [0, -16, 4.4],
  meta = {
    id: 'tidewrack',
    name: 'Tidewrack Atoll',
    note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
  },
} = {}) {
  const d = new Draft(size, size, seed);
  const cx = Math.round(size / 2), cz = Math.round(size / 2), R = radius;
  // Everything below is placed at a FRACTION of the radius rather than at a
  // tile offset, so a generated atoll with a different radius puts its town on
  // the ring rather than in the lagoon. `out` is "this far out from the middle".
  const out = (f) => Math.round(f * R);

  // Both shores at once. `ro` is the bearing-corrected distance for the outer
  // coast and `ri` the same for the lagoon; testing the inner bands first and
  // falling through to the outer ones is what stitches them into one ring
  // without either shore having to know the other's numbers.
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) {
      const nx = (x + 0.5 - cx) / R, nz = (z + 0.5 - cz) / R;
      const a = Math.atan2(nz, nx);
      const dist = Math.hypot(nx, nz);
      let out = 1, inn = 1;
      for (const [k, amp, phase] of wobble) out += amp * Math.sin(k * a + phase);
      for (const [k, amp, phase] of lagoonWobble) inn += amp * Math.sin(k * a + phase);
      const ro = dist / out, ri = dist / inn;
      d.surf[z][x] = ri < bands.lagoon ? 'w'
        : ri < bands.inner ? 's'
          : ro < bands.grass ? 'g'
            : ro < bands.shore ? 's' : 'w';
    }
  }

  // The dune, and the two-column cut up its south face. Same shape as
  // Meadowbrook's bluff and a tenth of the size: a rise you climb for the view
  // rather than a cliff the town lives under.
  d.disc(d.elev, cx + dune[0], cz + dune[1], dune[2], '1');
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) if (d.surf[z][x] === 'w') d.elev[z][x] = '0';
  }
  const rampZ = d.rampNorth(cx - 1);
  d.rampNorth(cx);

  /**
   * THE RING ROAD, and the reason it is a loop of little patches rather than a
   * shape.
   *
   * `pave` takes rectangles and a ring is not one. Walking the circle and
   * stamping a 2x2 at each step gives an unbroken road for the cost of some
   * overlap -- and because the buildings are placed at this same radius, the
   * road reaches every door by construction rather than by five hand-aimed
   * paths that have to be re-aimed the moment the coastline moves.
   */
  const ringR = R * 0.55;
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * ringR), z = Math.round(cz + Math.sin(a) * ringR);
    d.pave(x, z, x + 1, z + 1, { level: '0' });
  }
  // Spur from the ring road to the foot of the dune, and the apron on top.
  d.pave(cx - 1, rampZ, cx, cz + dune[1] + Math.ceil(dune[2]), { level: '0' });
  d.pave(cx - 4, cz + dune[1] - 4, cx + 3, cz + dune[1] + 3, { level: '1' });

  // Placed at the compass points of the ring, which is the same as saying
  // placed as far from each other as the map allows.
  const lookout = d.placeNear('gate.dune', 'building.gate', cx + dune[0] - 2, cz + dune[1] - 1, ['c', 'g'], 7,
    { label: 'Tidewrack Dune' }, '1');
  const landing = d.placeNear('gate.landing', 'building.gate', cx, cz + out(0.78), ['s', 'g'], 8,
    { label: 'Tidewrack Landing' }, '0');
  const home = d.placeNear('home.player', 'building.home', cx - 6, cz + out(0.54), ['g'], 10,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.driftwood', 'building.store', cx + out(0.54), cz + 2, ['g'], 10,
    { label: 'Driftwood Stores', interior: 'worlds/interiors/store-driftwood.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const cottage = d.placeNear('home.marnie', 'building.cottage', cx - out(0.57), cz - 3, ['g'], 10,
    { label: "Marnie's Cottage", interior: 'worlds/interiors/home-marnie.json' }, '0');

  // Doors face south, so every approach starts below its door and runs to the
  // nearest point of the ring road.
  d.pathL(home[0] + 1, home[1] + 3, cx - 1, cz + out(0.54), { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, cx + out(0.5), cz + 7, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, cx + out(0.5), cz + 9, { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, cx - out(0.5), cz + 3, { level: '0' });
  d.pathL(landing[0] + 2, landing[1] + 2, cx, cz + out(0.6), { level: '0' });
  d.pathL(lookout[0] + 2, lookout[1] + 2, cx - 1, cz + dune[1] + 2, { level: '1' });
  addHousewright(d, home, {
    id: 'folk.calder', name: 'Calder', title: 'Storm-frame Builder',
    voice: { pitch: 0.96, rate: 25, timbre: 'square' },
    flavor: 'Calder. Salt tests every joint for free. I can raise your house in the same footprint and brace each new floor against a Tidewrack gale.',
  });

  // THE PEOPLE. Three of them, one per arm of the ring, and none of them
  // visible from either of the others -- which on a map with a lake in the
  // middle of it costs nothing to arrange and is the whole reason to walk.
  d.person({
    id: 'folk.otto',
    type: 'folk.tinker',
    tile: [landing[0] + 2, landing[1] + 2],
    facing: 'north',
    props: {
      name: 'Otto',
      title: 'Keeps things floating',
      roam: 5,
      voice: { pitch: 1.02, rate: 21, timbre: 'sawtooth' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { visits: 9 }, to: 'ninth' },
            { when: { flag: 'told' }, to: 'after' },
            { when: { visits: 4 }, to: 'fourth' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Mind the rope. Everything on this landing is rope or under it.',
            "Otto. I keep what floats floating. You'll be walking the ring -- everybody does, the first day.",
            'Nothing here is sinking fast. That is the most any of it gets from me and it has never once complained.',
          ],
          then: 'menu',
        },
        fourth: {
          text: 'Round again. It does not get any shorter. I have measured it twice, out of spite.',
          then: 'menu',
        },
        after: {
          text: 'Still going round, then. Good. Somebody should be.',
          then: 'menu',
        },
        ninth: {
          text: [
            'Nine laps. You have walked further round this ring than I have in a year and I live on it.',
            'I do not need to go round. Everything comes past me eventually. That is what a landing is.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Something you needed?',
          choices: [
            { text: 'Which way round is quicker?', to: 'ring' },
            { text: "What's up on the dune?", to: 'dune' },
            {
              text: 'Any use for driftwood?',
              when: { has: { type: 'item.stick', count: 3 } },
              to: 'trade',
            },
            {
              text: 'Is Marnie really out on both shores?',
              when: { not: { flag: 'marnie' } },
              to: 'marnie',
            },
            { text: 'Does anything here actually sink?', to: 'sink' },
            {
              text: 'Could you use a shell?',
              when: { has: { type: 'item.shell', count: 1 } },
              to: 'shell',
            },
            { text: "I'll walk on.", to: 'bye' },
          ],
        },
        ring: {
          text: [
            'Neither. That is the joke of the place.',
            'Marnie is west, the store is east, and the water in the middle means you cannot cut across to either.',
          ],
          do: { set: 'told' },
          then: 'menu',
        },
        dune: {
          text: 'Sand, and the only look at this place that makes sense of it. Worth the climb the once. Yarrow is up there and will make it worth it twice.',
          then: 'menu',
        },
        trade: {
          text: "Driftwood I can always use. There -- that's fair for three, and two of them are going in a boat you will never see.",
          do: [{ take: { type: 'item.stick', count: 3 } }, { coins: 24 }],
          then: 'menu',
        },
        marnie: {
          text: [
            'She is. Sea in the morning, lagoon in the afternoon, and she knows which one is worth it before she gets there.',
            'She has a glass in that window of hers, and I will tell you plainly: she has watched me tie a bad knot from half a mile off and mentioned it a week later.',
          ],
          do: { set: 'marnie' },
          then: 'menu',
        },
        sink: {
          text: [
            'Everything sinks. That is not pessimism, it is a schedule.',
            'A boat, a landing, a rope, a man -- all of it going down at its own rate, and the whole trade is slowing yours down.',
            'Cheerful business, once you stop arguing with it.',
          ],
          then: 'menu',
        },
        shell: {
          text: [
            'A good one. I will put it on the post at the head of the landing, where they all go.',
            'There is fourteen years of them up there. Take a coin -- you have added to something.',
          ],
          do: [{ take: { type: 'item.shell', count: 1 } }, { coins: 30 }],
          then: 'menu',
        },
        bye: { text: 'Aye. Mind the rope.' },
      },
    },
  });

  d.person({
    id: 'folk.marnie',
    type: 'folk.fisher',
    tile: [cottage[0] + 1, cottage[1] + 3],
    facing: 'south',
    props: {
      name: 'Marnie',
      title: 'Works both shores',
      roam: 7,
      voice: { pitch: 1.16, rate: 28, timbre: 'square' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            {
              when: { all: [{ friend: true }, { flag: 'glass' }] },
              to: 'glassagain',
            },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'You came the long way round. There is no short way. Now then.',
            'Marnie. Cottage is mine -- go in out of the wind whenever, now I know your face.',
            'Mind the step up to the window. Everybody trips on it once and then they never do again, which is the whole design.',
          ],
          then: 'menu',
        },
        welcome: {
          text: 'Lagoon side today. The sea has a temper on it. Go in and put the kettle somewhere useful.',
          then: 'menu',
        },
        glassagain: {
          text: [
            'You have had a look through my glass, then.',
            'I will not ask what you saw. I know what is out there. I would rather hear what you thought of it.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Well?',
          choices: [
            {
              text: 'Anything worth picking up out here?',
              when: { room: { type: 'item.shell', count: 2 } },
              to: 'gift',
            },
            { text: 'Why is the lagoon so still?', to: 'lagoon' },
            {
              text: "What's the spyglass for?",
              when: { not: { flag: 'glass' } },
              to: 'glass',
            },
            {
              text: 'Where does all that on the shelves come from?',
              to: 'finds',
            },
            { text: 'What have you heard?', when: { visits: 3 }, to: 'heard' },
            {
              text: 'Would you buy a pebble off me?',
              when: { has: { type: 'item.stone', count: 2 } },
              to: 'stones',
            },
            { text: 'Just passing.', to: 'bye' },
          ],
        },
        gift: {
          text: 'Take these. The lagoon side gives up better ones than the sea does, and it will deny it.',
          do: { give: { type: 'item.shell', count: 2 } },
          then: 'menu',
        },
        lagoon: {
          text: [
            'Because the ring takes the weather and the lagoon does not.',
            'Same water, two moods, ten steps apart. You get used to it and then you do not.',
          ],
          then: 'menu',
        },
        glass: {
          text: [
            'For seeing which shore is worth the walk before I have walked it. That is the honest half.',
            'The other half is that I can see the landing, the far sand and about a mile of water from a chair.',
            'People think I am lucky with what I know. I am not lucky. I am seated.',
          ],
          do: { set: 'glass' },
          then: 'menu',
        },
        finds: {
          text: [
            'Off the tideline, every one, and I can tell you which shore and roughly which week.',
            'Nothing on that shelf is worth anything. It is a record, not a hoard.',
          ],
          then: 'menu',
        },
        heard: {
          text: [
            'I will tell you what I will tell you.',
            'Otto is patching the same hull he swore he had finished, and there is a boat moored on the far side where nobody moors.',
            'Yarrow knows about the boat and has decided it is none of his business, which is how he stays so calm.',
          ],
          then: 'menu',
        },
        stones: {
          text: [
            'Two? I will take one. The flat one -- the other has been in fresh water and I do not know what to do with that.',
            'There. That is a good price and I am telling you so you know when the next one is not.',
          ],
          do: [{ take: { type: 'item.stone', count: 1 } }, { coins: 9 }],
          then: 'menu',
        },
        bye: { text: 'Mind the tide line.' },
      },
    },
  });

  d.person({
    id: 'folk.yarrow',
    type: 'folk.gardener',
    tile: [lookout[0] + 2, lookout[1] + 2],
    facing: 'south',
    props: {
      name: 'Yarrow',
      title: 'Up here most days',
      roam: 5,
      voice: { pitch: 0.84, rate: 22, timbre: 'triangle' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { visits: 7 }, to: 'often' },
            { when: { visits: 3 }, to: 'again' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'You climbed it. Most people look at it and carry on round.',
            'Yarrow. I grow what will grow in sand, which is a short list and a stubborn one.',
          ],
          then: 'menu',
        },
        again: { text: 'Back up. It is a good view for thinking at.', then: 'menu' },
        often: {
          text: [
            'You are up here more than the wind is.',
            'I will say the thing I have been saving: the people who keep climbing this dune are the ones who end up staying on the island. Every time.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Anything?',
          choices: [
            {
              text: 'Anything growing up here?',
              when: { room: { type: 'item.mushroom', count: 2 } },
              to: 'gift',
            },
            { text: 'What am I looking at?', to: 'view' },
            {
              text: 'How does anything grow in sand?',
              when: { not: { flag: 'sand' } },
              to: 'sand',
            },
            {
              text: 'There is a boat out there nobody uses.',
              when: { visits: 2 },
              to: 'boat',
            },
            { text: 'Do you ever go down?', to: 'down' },
            { text: 'Nothing. Thanks.', to: 'bye' },
          ],
        },
        gift: {
          text: 'Under the dune grass, where the sand stays damp. Take them.',
          do: { give: { type: 'item.mushroom', count: 2 } },
          then: 'menu',
        },
        view: {
          text: [
            'A ring, and a lake in the hole of it, and sea round the whole lot.',
            'Otto is the smudge down at the landing. Marnie is the one you cannot see, which is west.',
          ],
          then: 'menu',
        },
        sand: {
          text: [
            'It does not, mostly. You are looking at the survivors and they are all short and all furious.',
            'The trick is not soil. The trick is roots that have given up on going down and gone sideways instead.',
            'There is a lesson in that and I have decided not to draw it.',
          ],
          do: { set: 'sand' },
          then: 'menu',
        },
        boat: {
          text: [
            'I have seen it. It has been there since before the wet week.',
            'Marnie has seen it too, from a chair, and has said nothing to me about it, which means she is waiting to see who mentions it first.',
            'I would rather not be the one. You go ahead.',
          ],
          then: 'menu',
        },
        down: {
          text: [
            'For flour, and for the store, and to be told things I could have worked out from up here.',
            'It is a fine place, the ring. It is just that from down there you cannot see it is a ring.',
          ],
          then: 'menu',
        },
        bye: { text: 'Go careful on the way down.' },
      },
    },
  });

  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 9, ['g', 's']),
    palm: d.scatter('palm', 'tree.palm', 54, ['s']),
    // Sparse, and no pines: a ring this narrow closes up entirely if it is
    // wooded like an island, and a road you cannot see along is a road that
    // makes the place feel small rather than long.
    oak: d.scatter('oak', 'tree.oak', 30, ['g']),
    rock: d.scatter('rock', 'rock.small', 40, ['g', 's']),

    // No chickens anywhere on the atoll, which is the point of having four
    // worlds: the thing you learn walking into this one is that it is not the
    // last one. Ducks on the lagoon, crows working the tide line, a cat at the
    // store and rabbits in the dune grass.
    duck: d.flock('duck', 'duck', 3, cx, cz + out(0.33), 8, ['s', 'g']),
    crow: d.flock('crow', 'crow', 3, cx + out(0.7), cz + out(0.42), 9, ['s', 'g']),
    cat: d.flock('cat', 'cat', 1, store[0] + 2, store[1] + 6, 6, ['g', 'c']),
    rabbit: d.flock('rabbit', 'rabbit', 2, cx + dune[0], cz + dune[1] + 7, 7, ['g']),

    shell: d.litter('shell', 'item.shell', 24, ['s']),
    stone: d.litter('stone', 'item.stone', 16, ['s']),
    stick: d.litter('stick', 'item.stick', 18, ['s', 'g']),
    flower: d.litter('flower', 'item.flower', 12, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 8, ['g'],
      { cx: cx + dune[0], cz: cz + dune[1], radius: 9 }),
    apple: d.litter('apple', 'item.apple', 7, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta,
      terrain: { form: 'island' },
      spawn: { tile: [cx - 1, cz + out(0.54)], facing: 'south' },
    }),
  };
}

// ===========================================================================
// THISTLEDOWN -- a gap
// ===========================================================================
// Sourwood's form with its head knocked out: a pass, open at BOTH ends, so the
// valley is a through-route rather than a dead end. That single change makes it
// a different place to be in. Sourwood gathers -- everything drains toward one
// mouth and you are always somewhere along the way to it. A gap has no bottom
// to end up at, so the road just runs, the pastures step up either side of it,
// and what is worth finding is uphill on the benches rather than downstream.
//
// There is no creek. A pass sheds its water sideways, and the standing tarn
// that replaces it does a different job: a creek is a barrier the fords cut
// through, and the tarn is a thing to walk around and find animals at.
export function thistledown({
  seed = 0x7415de,
  width = 44,
  height = 78,
  // Wider bottomland than Sourwood's, because everything here has to fit
  // BESIDE the road rather than along one bank of a creek.
  floor = 8,
  bench = 2.4,
  // How many rows each mouth flares over. Sourwood flares once, at the south;
  // this flares at both ends, and the same rule holds at each -- widen slower
  // than a tile per row or the boundary steps clean over a bench and strands
  // it above a step with nothing beside it at the same height.
  mouth = 20,
  mouthRate = 0.9,
  // The tarn, as [x offset from the axis, row as a fraction of the length,
  // radius]. West of the road, and comfortably inside the flat: water that
  // reaches a bench is water running up a hill.
  tarn = [-3.0, 0.46, 3.2],
  /**
   * Two trails up each wall. One would do -- the benches are unbroken strips,
   * so a single ramp makes the whole hillside walkable -- but a pass is long,
   * and one climb per side means the far half of every bench is a long walk
   * from the only way onto it.
   *
   * EVERY ONE OF THESE ROWS IS INSIDE THE FLAT MIDDLE, well clear of both
   * mouths, and that is a rule rather than a preference. A ramp tile can only
   * be entered from its low end, so it is a wall to anything walking ALONG the
   * bench -- and in the flare, where each bench steps outward a little every
   * row, a bench is often only two tiles wide and only ONE of them lines up
   * with the row above. Put a trail on that row and the ramp takes the single
   * column that was holding the staircase together, stranding every shelf
   * between there and the mouth.
   */
  trails = [[26, -1], [46, -1], [34, 1], [52, 1]],
  // Which row each landmark wants. `placeNear` does the rest.
  sites = { north: 13, home: 34, store: 57, south: 65 },
  spawnRow = 44,
  meta = {
    id: 'thistledown',
    name: 'Thistledown Gap',
    note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
  },
} = {}) {
  const d = new Draft(width, height, seed);
  const axis = d.W / 2;
  const road = Math.round(axis) + 3;

  /**
   * The bottomland's half-width at row `z`: constant through the middle, and
   * flaring toward each mouth. Both mouths are the same function of distance
   * from the nearer end, which is what makes the pass symmetrical in the one
   * way that matters -- neither end is the back of the place.
   */
  const halfWidth = (z) => floor
    + mouthRate * Math.max(0, mouth - z, z - (d.H - 1 - mouth));

  for (let z = 0; z < d.H; z++) {
    const fh = halfWidth(z);
    for (let x = 0; x < d.W; x++) {
      // Benches depend on x and on the mouth flare, never on a wandering line,
      // for the same reason Sourwood's do: a wall that wanders is a hillside
      // chopped into a few hundred shelves you can see and cannot reach.
      const wall = Math.min(4, Math.max(0, Math.ceil((Math.abs(x + 0.5 - axis) - fh) / bench)));
      d.elev[z][x] = String(wall);
      d.surf[z][x] = 'g';
    }
  }

  // The tarn, with a gravel rim. Drawn as two discs rather than one so the
  // water has a shore: a pond that meets the grass at its own edge reads as a
  // hole cut in the field.
  const tarnZ = Math.round(d.H * tarn[1]);
  d.disc(d.surf, axis + tarn[0], tarnZ, tarn[2] + 1.3, 's');
  d.disc(d.surf, axis + tarn[0], tarnZ, tarn[2], 'w');

  // The road, straight down the pass and two tiles wide. It is the only thing
  // in the world that touches both mouths, so everything else hangs off it.
  d.pave(road, 0, road + 1, d.H - 1, { level: '0', onto: ['g'] });

  for (const [z, dir] of trails) d.trail(z, road - 1 + 4 * dir, dir);

  const north = d.placeNear('gate.north', 'building.gate', road - 3, sites.north, ['c', 'g'], 10,
    { label: 'Thistledown Gap' }, '0');
  const south = d.placeNear('gate.south', 'building.gate', road - 3, sites.south, ['c', 'g'], 10,
    { label: 'The Low Road' }, '0');
  const home = d.placeNear('home.player', 'building.home', road - 9, sites.home, ['g'], 11,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.wether', 'building.store', road + 4, sites.store, ['g'], 11,
    { label: 'The Wether', interior: 'worlds/interiors/store-wether.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const croft = d.placeNear('home.nan', 'building.cottage', road - 8, 24, ['g'], 11,
    { label: "Nan's Croft", interior: 'worlds/interiors/home-nan.json' }, '0');

  d.pathL(home[0] + 1, home[1] + 3, road, home[1] + 4, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, road, store[1] + 5, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, road, furniture[1] + 5, { level: '0' });
  d.pathL(croft[0] + 1, croft[1] + 3, road, croft[1] + 4, { level: '0' });
  d.pathL(north[0] + 2, north[1] + 2, road, north[1] + 3, { level: '0' });
  d.pathL(south[0] + 2, south[1] + 2, road, south[1] + 3, { level: '0' });
  addHousewright(d, home, {
    id: 'folk.moss', name: 'Moss', title: 'Pass Mason',
    voice: { pitch: 1.16, rate: 20, timbre: 'triangle' },
    flavor: 'Moss. The pass has taught me to build narrow and high. Your walls are plumb; I can give them another floor or two without widening the path.',
  });

  // THE PEOPLE. Three, spread the length of the road, and one of them
  // deliberately at the top of a trail: a bench you have climbed for the view
  // is a better place to be told something than the square is.
  d.person({
    id: 'folk.dell',
    type: 'folk.villager',
    tile: [north[0] + 2, north[1] + 3],
    facing: 'south',
    props: {
      name: 'Dell',
      title: 'Minds the gate',
      roam: 6,
      voice: { pitch: 0.92, rate: 24, timbre: 'sawtooth' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { visits: 8 }, to: 'regular' },
            { when: { flag: 'told' }, to: 'after' },
            { when: { visits: 3 }, to: 'third' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Through, or stopping? Most are through.',
            "Dell. That's the top of the gap behind me and the low road out the other end. Everything worth anything is in between.",
            'I do not stop anybody. I just like to know. There is a difference and I am the only one who keeps it.',
          ],
          then: 'menu',
        },
        third: {
          text: 'You are stopping, then. Good. I have you down as stopping.',
          then: 'menu',
        },
        after: {
          text: 'Wind is up the gap today. It usually is. I would not call that news.',
          then: 'menu',
        },
        regular: {
          text: [
            'Eight times through this gate and not once with a cart. That is unusual and I have noticed it.',
            'I am not asking. I am saying I noticed.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Anything else?',
          choices: [
            { text: "What's up on the benches?", to: 'benches' },
            { text: 'Who else is down there?', to: 'folk' },
            {
              text: 'Could you use a few thistles?',
              when: { has: { type: 'item.flower', count: 2 } },
              to: 'trade',
            },
            {
              text: 'Do you keep a record of all this?',
              when: { not: { flag: 'log' } },
              to: 'log',
            },
            {
              text: 'Does anyone ever come through you do not know?',
              when: { visits: 4 },
              to: 'stranger',
            },
            { text: "I'll get on.", to: 'bye' },
          ],
        },
        benches: {
          text: [
            "Nan's sheep on the west side, goats on the east, and the goats are somebody else's problem.",
            'Trails up both walls. Take one -- the road only shows you the bottom of the place.',
          ],
          do: { set: 'told' },
          then: 'menu',
        },
        folk: {
          text: [
            'Nan at the croft, halfway down. Fire in the wall and a loom in the window, and she will put you to work on both.',
            'Rook sat at the tarn, where he always is. Do not open with a question.',
            'Edda keeps The Wether at the far end and knows exactly what everything costs, including this conversation.',
          ],
          then: 'menu',
        },
        trade: {
          text: 'Thistledown, that. Nan stuffs cushions with it and pays me to fetch it. Here.',
          do: [{ take: { type: 'item.flower', count: 2 } }, { coins: 16 }],
          then: 'menu',
        },
        log: {
          text: [
            'There is no log.',
            'There was going to be. I got as far as ruling the lines and then I found I had it all anyway.',
            'Forty years and I could tell you who went down this road on any day you name. Try me some time when I am not busy.',
          ],
          do: { set: 'log' },
          then: 'menu',
        },
        stranger: {
          text: [
            'Twice. Once in the wet year, and once about a month before you.',
            'Went down, did not come back up. There is a low road, mind. People do use it.',
          ],
          then: 'menu',
        },
        bye: { text: 'Right you are. Down and to your left.' },
      },
    },
  });

  d.person({
    id: 'folk.nan',
    type: 'folk.gardener',
    tile: [croft[0] + 1, croft[1] + 3],
    facing: 'south',
    props: {
      name: 'Nan',
      title: 'Keeps the west bench',
      roam: 6,
      voice: { pitch: 1.1, rate: 19, timbre: 'triangle' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            {
              when: { all: [{ friend: true }, { visits: 8 }] },
              to: 'regular',
            },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Stand still a moment, they are counting you.',
            'Nan. The croft is mine and so are the sheep on that bench. Door is open to you now we have met.',
            'Fire is in the wall and there is a chair in there beside it. Sit in it. It is not for anybody.',
          ],
          then: 'menu',
        },
        welcome: {
          text: 'Go on in, duck. Kettle is where it always is and the fire does not go out.',
          then: 'menu',
        },
        regular: {
          text: [
            'You have been in and out of my house more than my own sister, and she is nearer.',
            'I am not complaining. I am telling you so you know I keep count.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Was there something?',
          choices: [
            {
              text: 'Anything come up this week?',
              when: { room: { type: 'item.mushroom', count: 2 } },
              to: 'gift',
            },
            { text: 'Why keep them up there?', to: 'why' },
            {
              text: 'What are you weaving?',
              when: { not: { flag: 'cloth' } },
              to: 'loom',
            },
            { text: 'The fire is a long way into that wall.', to: 'hearth' },
            {
              text: 'I brought an apple back.',
              when: {
                all: [
                  { has: { type: 'item.apple', count: 1 } },
                  { not: { flag: 'apple' } },
                ],
              },
              to: 'apple',
            },
            {
              text: 'Has it always been just you?',
              when: { visits: 4 },
              to: 'alone',
            },
            { text: 'Just saying hello.', to: 'bye' },
          ],
        },
        gift: {
          text: 'Under the thorn on the second bench. Take them, I have a basket and one mouth.',
          do: { give: { type: 'item.mushroom', count: 2 } },
          then: 'menu',
        },
        why: {
          text: [
            'Grass is better up there and the wind takes the flies.',
            'And they are somewhere I can see them from the door, which after thirty years is most of it.',
          ],
          then: 'menu',
        },
        loom: {
          text: [
            'A blanket, and it has been a blanket for two winters, so do not hold your breath.',
            'Throw the shuttle if you go in. Every row counts, mind -- I know the number and I will know if it has gone up.',
            'I am not saying do not. I am saying I will know.',
          ],
          do: { set: 'cloth' },
          then: 'menu',
        },
        hearth: {
          text: [
            'That is the whole point of it, duck. The wall is three foot of stone and the fire lives inside it.',
            'You can stand right in there beside it in February and be warm on both sides. Nothing else in this gap can say that.',
          ],
          then: 'menu',
        },
        apple: {
          text: [
            'Off my own tree, that. It goes down to the store and comes back to me at a profit, and now here it is for nothing.',
            'You keep it. Take a coin for the carrying and do not argue.',
          ],
          do: [{ set: 'apple' }, { coins: 10 }],
          then: 'menu',
        },
        alone: {
          text: [
            'It has been just me since the wet year. It was not always.',
            'That is why the chair by the fire is a chair and not two chairs, and that is as much as you are getting.',
          ],
          then: 'menu',
        },
        bye: {
          text: 'Mind the gate on your way through. Dell will have counted you.',
        },
      },
    },
  });

  d.person({
    id: 'folk.rook',
    type: 'folk.fisher',
    tile: [Math.round(axis + tarn[0]) + 5, tarnZ],
    facing: 'west',
    props: {
      name: 'Rook',
      title: 'Sits at the tarn',
      roam: 5,
      voice: { pitch: 0.86, rate: 14, timbre: 'triangle' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { visits: 12 }, to: 'old' },
            { when: { visits: 5 }, to: 'regular' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Quietly, if you would.',
            'Rook. There is nothing in this tarn worth catching and I have been after it for years.',
          ],
          then: 'menu',
        },
        regular: {
          text: 'You again. Sit if you like, it is not my water.',
          then: 'menu',
        },
        old: {
          text: [
            'You have sat here twelve times now and said less each time. That is the right direction.',
            'Give it another year and we will get on.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Well?',
          choices: [
            {
              text: 'Found anything in the shallows?',
              when: { room: { type: 'item.stone', count: 2 } },
              to: 'gift',
            },
            { text: 'Nothing at all in there?', to: 'nothing' },
            {
              text: 'How deep is it?',
              when: { not: { flag: 'deep' } },
              to: 'deep',
            },
            {
              text: 'Do you ever go down to the village?',
              when: { visits: 3 },
              to: 'village',
            },
            { text: 'What do you do when it rains?', to: 'rain' },
            { text: "I'll leave you to it.", to: 'bye' },
          ],
        },
        gift: {
          text: 'Flat ones, off the rim. Best skimmers in the gap and I have no arm left for it.',
          do: { give: { type: 'item.stone', count: 2 } },
          then: 'menu',
        },
        nothing: {
          text: [
            'Something. Never seen it. Forty years of never seeing it.',
            'You will hear it take a fly some evening and then you will be sat here too.',
          ],
          then: 'menu',
        },
        deep: {
          text: [
            'Nobody knows.',
            'A man put a stone on a line once and ran out of line.',
          ],
          do: { set: 'deep' },
          then: 'menu',
        },
        village: {
          text: [
            'For flour.',
            'They are all very kind to me down there and it takes an hour off my day.',
          ],
          then: 'menu',
        },
        rain: {
          text: [
            'Sit here.',
            'The water goes the colour of a knife and every ring on it is a different rain. It is the best of the year and nobody comes up for it.',
          ],
          then: 'menu',
        },
        bye: { text: 'Aye. Quietly.' },
      },
    },
  });

  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 16, ['g', 's'], 4200),
    // Thorn and scrub on the walls, thin on the pasture: a bench with a forest
    // on it is a bench nothing can graze, and grazing is what the benches here
    // are for.
    pine: d.scatter('pine', 'tree.pine', 74, ['g'], 4200),
    oak: d.scatter('oak', 'tree.oak', 58, ['g'], 4200),
    rock: d.scatter('rock', 'rock.small', 62, ['g', 's'], 4200),

    // UP, both of them, and on opposite walls. The trails are the only way onto
    // the benches, so a flock seeded up there is a thing the map cannot show
    // you and the road cannot walk you past -- you have to go and look.
    sheep: d.flock('sheep', 'sheep', 4, Math.round(axis) - 13, 26, 9, ['g']),
    goat: d.flock('goat', 'goat', 3, Math.round(axis) + 14, 50, 9, ['g']),
    // And two on the floor, so the road is not empty between the climbs.
    rabbit: d.flock('rabbit', 'rabbit', 2, Math.round(axis + tarn[0]), tarnZ + 7, 7, ['g']),
    chicken: d.flock('chicken', 'chicken', 3, home[0] + 1, home[1] + 5, 4, ['g', 'c']),

    stick: d.litter('stick', 'item.stick', 18, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 15, ['g']),
    // On the tarn's rim, which is the only gravel in the pass.
    stone: d.litter('stone', 'item.stone', 14, ['s']),
    flower: d.litter('flower', 'item.flower', 20, ['g']),
    apple: d.litter('apple', 'item.apple', 7, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta,
      terrain: { form: 'holler', open: ['north', 'south'] },
      spawn: { tile: [road, spawnRow], facing: 'south' },
      // Thinner haze than Sourwood's. A gap has wind through it and a view out
      // of both ends, and fog that close would take away the one thing that
      // distinguishes it from a holler.
      ambience: { fog: [24, 72] },
    }),
  };
}

// ===========================================================================
// RIMROCK -- a mesa
// ===========================================================================
// The first world that is not surrounded by anything. Meadowbrook has a sea to
// stop you and Sourwood has ridges; here the map runs out and the ground goes
// with it, ten units straight down into a basin you can see the whole of and
// will never stand in. That inverts what the edge of a world is FOR. Every
// other place hides its boundary behind scenery and hopes you look inward; a
// mesa puts the boundary on show, walks you out to it, and builds an overlook
// there -- because the one thing worth doing on a table in the sky is standing
// at the lip of it.
//
// Inward, it is dry country. One seep of water in sixty-two tiles, a wash that
// carries it off in the rains and is sand the rest of the year, juniper where
// the grass will still hold and bare slickrock where it will not.
export function rimrock({
  seed = 0x11cb07,
  size = 62,
  /**
   * Where the grass gives out and the bare rim begins, as a fraction of the
   * half-width -- and it is measured with a SQUARE distance rather than a
   * radius, which is the one shape decision this world hangs on. The drop is a
   * rectangle because the map is. A circular rim would leave four grass corners
   * hanging over a cliff, and the corners are exactly where a player walks.
   */
  rim = 0.72,
  rimWobble = [[4, 0.055, 0.9], [7, 0.032, 2.6]],
  /**
   * The caprock: a second table over the north half, and the same rule as
   * Meadowbrook's bluff -- it has to stay over the middle columns, because
   * `rampNorth` cuts the only way up at cx and cx-1 and a cap that has slid
   * east of those is a cliff with no path onto it.
   */
  cap = [0, -11, 9.4],
  /**
   * The seep, as an offset from the middle and a radius. Small, and that is
   * enforced rather than chosen: `verifyForm` will not pass a mesa with water
   * on its rim, because there is nothing under this edge for it to fall into.
   */
  seep = [0, 16, 3.6],
  /** The wash below the seep, as [half-width, wander, phase]. Sand: it is dry. */
  wash = [1.7, 4.6, 1.1],
  meta = {
    id: 'rimrock',
    name: 'Rimrock Mesa',
    note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
  },
} = {}) {
  const d = new Draft(size, size, seed);
  const cx = Math.round(size / 2), cz = Math.round(size / 2);
  const half = size / 2;

  // The table top: grass in the middle, slickrock out to the lip.
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) {
      const nx = (x + 0.5 - cx) / half, nz = (z + 0.5 - cz) / half;
      const a = Math.atan2(nz, nx);
      let wob = 1;
      for (const [k, amp, phase] of rimWobble) wob += amp * Math.sin(k * a + phase);
      d.surf[z][x] = Math.max(Math.abs(nx), Math.abs(nz)) / wob < rim ? 'g' : 's';
    }
  }

  // The wash, from the seep to the south lip. Drawn as a wandering line of sand
  // through the grass, which is what a dry watercourse looks like from above
  // and is the only thing on the mesa that admits it ever rains.
  for (let z = cz + seep[1]; z < d.H; z++) {
    const wx = cx + seep[0] + wash[1] * Math.sin((z - cz) * 0.09 + wash[2]);
    for (let x = Math.floor(wx - wash[0]); x <= wx + wash[0]; x++) d.set(d.surf, x, z, 's');
  }

  d.disc(d.elev, cx + cap[0], cz + cap[1], cap[2], '1');

  // The seep and its mud, drawn after the wash so the water is not sanded over.
  d.disc(d.surf, cx + seep[0], cz + seep[1], seep[2] + 1.3, 's');
  d.disc(d.surf, cx + seep[0], cz + seep[1], seep[2], 'w');
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) if (d.surf[z][x] === 'w') d.elev[z][x] = '0';
  }

  const rampZ = d.rampNorth(cx - 1);
  d.rampNorth(cx);

  d.pave(cx - 6, cz - 19, cx + 5, cz - 14, { level: '1' });   // apron on the caprock
  d.pave(cx - 1, cz - 14, cx, cz - 3, { level: '1' });        // spine, out to the cap's edge
  d.pave(cx - 1, rampZ, cx, cz + 8, { level: '0' });          // road down off the ramp
  d.pave(cx - 13, cz + 7, cx + 13, cz + 11, { level: '0' });  // the yard
  d.pave(cx - 1, cz + 11, cx, cz + 22, { level: '0' });       // walk out to the south lip

  // TWO LOOKOUTS, and having two is the argument of the place. One on the
  // caprock, which shows you the mesa; one at the lip, which shows you what the
  // mesa is standing in. Neither is any use without the other.
  const head = d.placeNear('gate.head', 'building.gate', cx - 4, cz - 17, ['c', 'g', 's'], 8,
    { label: 'Rimrock Head' }, '1');
  const lip = d.placeNear('gate.lip', 'building.gate', cx - 2, cz + 22, ['c', 'g', 's'], 8,
    { label: 'The Long Look' }, '0');
  const home = d.placeNear('home.player', 'building.home', cx - 12, cz + 1, ['g'], 11,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.slickrock', 'building.store', cx + 9, cz + 2, ['g', 's'], 11,
    { label: 'Slickrock Post', interior: 'worlds/interiors/store-slickrock.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g', 's'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const cottage = d.placeNear('home.pike', 'building.cottage', cx - 16, cz + 13, ['g', 's'], 11,
    { label: "Pike's Place", interior: 'worlds/interiors/home-pike.json' }, '0');

  d.pathL(home[0] + 1, home[1] + 3, cx - 1, cz + 8, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, cx, cz + 8, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, cx, cz + 10, { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, cx - 1, cz + 12, { level: '0' });
  d.pathL(head[0] + 2, head[1] + 2, cx - 1, cz - 13, { level: '1' });
  d.pathL(lip[0] + 2, lip[1] + 2, cx - 1, cz + 21, { level: '0' });
  addHousewright(d, home, {
    id: 'folk.iona', name: 'Iona', title: 'Mesa Framer',
    voice: { pitch: 0.9, rate: 27, timbre: 'sawtooth' },
    flavor: 'Iona. Out here a roof has nowhere to hide. I can lift yours one story at a time, keep the footprint, and pin the frame hard to the rimrock.',
  });

  // THE PEOPLE. Three, and every one of them is somewhere with a view, because
  // on a mesa that is the only geography there is: no valley to be up or down
  // of, no shore to be along, just how far you can see from where you stand.
  d.person({
    id: 'folk.bly',
    type: 'folk.villager',
    tile: [lip[0] + 2, lip[1] + 2],
    facing: 'north',
    props: { name: 'Bly', title: 'Counts the weather', roam: 5 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { flag: 'told' }, to: 'after' },
            { when: { visits: 3 }, to: 'third' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Careful. It is a long way down and it does not look it from here.',
            "Bly. I sit at the edge and count weather coming. Somebody has to, and nobody else will.",
          ],
          then: 'menu',
        },
        third: { text: 'Back at the edge. It grows on you or it does not.', then: 'menu' },
        menu: {
          text: 'Something you wanted?',
          choices: [
            { text: 'What is down there?', to: 'basin' },
            { text: 'Is there a way off?', to: 'off' },
            {
              text: 'Any use for stones?',
              when: { has: { type: 'item.stone', count: 4 } },
              to: 'trade',
            },
            { text: "I'll leave you to it.", to: 'bye' },
          ],
        },
        basin: {
          text: [
            'Red dirt, and more red dirt, and the shadow of this rock crossing it twice a day.',
            'Nothing lives down there that would not rather be up here.',
          ],
          do: { set: 'told' },
          then: 'menu',
        },
        off: {
          text: 'Not one you would walk. That is rather the point of the place.',
          then: 'menu',
        },
        trade: {
          text: 'I build cairns with them. Four is a good cairn. Here.',
          do: [{ take: { type: 'item.stone', count: 4 } }, { coins: 26 }],
          then: 'menu',
        },
        after: { text: 'Weather still coming. It always is.', then: 'menu' },
        bye: { text: 'Mind the edge.' },
      },
    },
  });

  d.person({
    id: 'folk.wend',
    type: 'folk.gardener',
    tile: [head[0] + 2, head[1] + 2],
    facing: 'south',
    props: { name: 'Wend', title: 'Grows it anyway', roam: 6 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'You came up the cut. Good. Most look at it and decide they have seen enough.',
            "Wend. I garden on a rock in a drought, which everyone here thinks is funny.",
          ],
          then: 'menu',
        },
        welcome: { text: 'Up on the cap again. The wind is honest up here.', then: 'menu' },
        menu: {
          text: 'Well?',
          choices: [
            {
              text: 'Anything growing up here?',
              when: { room: { type: 'item.flower', count: 2 } },
              to: 'gift',
            },
            { text: 'Where does the water come from?', to: 'water' },
            { text: 'Just looking.', to: 'bye' },
          ],
        },
        gift: {
          text: 'Take them. They come up in the cracks where the rock holds the night cold.',
          do: { give: { type: 'item.flower', count: 2 } },
          then: 'menu',
        },
        water: {
          text: [
            'The seep, south of the yard. One seep, and everything on this table drinks from it.',
            'The wash below it runs twice a year and we all go and watch.',
          ],
          then: 'menu',
        },
        bye: { text: 'Go on, then.' },
      },
    },
  });

  d.person({
    id: 'folk.pike',
    type: 'folk.tinker',
    tile: [cottage[0] + 1, cottage[1] + 3],
    facing: 'south',
    props: {
      name: 'Pike', title: 'Mends what the dust breaks', roam: 6,
      // Dry and clipped: a man who has spent thirty years not opening his
      // mouth wider than he has to, outdoors, in sand.
      voice: { pitch: 0.9, rate: 17, timbre: 'sawtooth' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { all: [{ friend: true }, { flag: 'sifter' }] }, to: 'sifteragain' },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Sand gets in everything up here. Everything. I make a living out of that.',
            "Pike. Door's open now I know your face -- it sticks, put your shoulder in it.",
            'There is a porch inside the door. Stamp in there and not on my floor, and we will get on.',
          ],
          then: 'menu',
        },
        welcome: { text: 'Come in out of the grit whenever you like. Shut the inner door behind you.', then: 'menu' },
        sifteragain: {
          text: 'You have been at my sifter. I can hear it from the road when it is still turning.',
          then: 'menu',
        },
        menu: {
          text: 'Anything?',
          choices: [
            { text: 'What breaks most?', to: 'breaks' },
            {
              text: 'I have sticks going spare.',
              when: { has: { type: 'item.stick', count: 3 } },
              to: 'trade',
            },
            { text: 'What is the drum for?', when: { not: { flag: 'sifter' } }, to: 'sifter' },
            { text: 'Why a porch inside the house?', to: 'porch' },
            { text: 'Nothing today.', to: 'bye' },
          ],
        },
        breaks: {
          text: 'Hinges. Then axles. Then people, but they mend slower and pay worse.',
          then: 'menu',
        },
        trade: {
          text: 'Juniper? I will take that. It splits clean and it does not warp.',
          do: [{ take: { type: 'item.stick', count: 3 } }, { coins: 21 }],
          then: 'menu',
        },
        sifter: {
          text: [
            'Sifter. Everything that comes off this mesa comes to me full of grit and leaves without it.',
            'Turn it if you like. It gives back pebbles, mostly, and once in a while somebody else\'s money.',
          ],
          do: { set: 'sifter' },
          then: 'menu',
        },
        porch: {
          text: [
            'Because a door on a mesa is a hole, and a hole lets in a mesa.',
            'Two doors and a room between them. It is the single best thing in that house and it is empty on purpose.',
          ],
          then: 'menu',
        },
        bye: { text: 'Right you are.' },
      },
    },
  });

  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 22, ['g', 's']),
    // Juniper, standing in as pine, and only where the grass still holds. The
    // slickrock rim is bare on purpose: it is the last thing you cross before
    // the drop, and anything growing on it would hide the drop.
    pine: d.scatter('pine', 'tree.pine', 62, ['g']),
    oak: d.scatter('oak', 'tree.oak', 20, ['g']),
    rock: d.scatter('rock', 'rock.small', 90, ['g', 's']),

    // No chickens, no ducks and no sheep on a mesa. Goats, which will stand on
    // anything; crows, which are everywhere; rabbits in the wash, and the
    // store's cat, who has never once gone near the edge.
    goat: d.flock('goat', 'goat', 3, cx + cap[0] + 6, cz + cap[1] + 4, 8, ['g', 's']),
    goatLip: d.flock('goat.lip', 'goat', 2, cx - 18, cz + 18, 7, ['g', 's']),
    crow: d.flock('crow', 'crow', 4, cx + 16, cz - 6, 9, ['g', 's']),
    rabbit: d.flock('rabbit', 'rabbit', 3, cx + seep[0], cz + seep[1] - 6, 7, ['g', 's']),
    cat: d.flock('cat', 'cat', 1, store[0] + 2, store[1] + 6, 6, ['g', 'c']),

    // The foraging is dry country foraging: stones everywhere, mushrooms only
    // at the seep, and no shells within a hundred miles of the place.
    stone: d.litter('stone', 'item.stone', 30, ['s']),
    stick: d.litter('stick', 'item.stick', 20, ['g']),
    flower: d.litter('flower', 'item.flower', 14, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 9, ['g', 's'],
      { cx: cx + seep[0], cz: cz + seep[1], radius: 8 }),
    apple: d.litter('apple', 'item.apple', 6, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta,
      terrain: { form: 'mesa' },
      spawn: { tile: [cx - 1, rampZ + 3], facing: 'south' },
      // Thin, and pushed a long way out. Haze is how you read distance from up
      // here, and a mesa with a close fog on it is a field with a fence round it.
      ambience: { fog: [40, 120], sky: 0xd8e4ee },
    }),
  };
}

// ===========================================================================
// ASHKETTLE -- a caldera
// ===========================================================================
// Sourwood's walls, closed into a circle. A holler drains: everything in it is
// somewhere along the way to the mouth, and the mouth is where the world is. A
// caldera has no mouth, so nothing is on the way to anywhere -- the road is a
// loop, the terraces are loops, and the only direction that means anything is
// down, toward the lake in the middle that you also cannot cross.
//
// It is the one world where the walls are the reason for the place rather than
// the edge of it, and the layout says so: the town sits on the floor with the
// rim standing over it on all four sides, and the climb up the terraces is the
// only thing here that counts as leaving.
export function ashkettle({
  seed = 0x0a5be7,
  /**
   * Bigger than any other world here, and the size is forced rather than
   * chosen. Every building has to stand on the FLOOR, the floor is a ring, and
   * a ring has to be wider than the thing standing on it in the radial
   * direction as well as the tangential one -- a five-by-four store on the east
   * arm needs five tiles measured straight out from the middle, with the road
   * and the beach still fitting either side of it.
   */
  size = 74,
  /**
   * WHY THE TERRACES ARE PERFECT CIRCLES
   * ------------------------------------
   * Elevation depends on the distance from the middle and on NOTHING else, for
   * exactly the reason Sourwood's benches depend only on x. A step is only
   * crossable at a ramp, so a terrace has to be one unbroken loop at one
   * height; let the rings wobble with the shoreline and each of them acquires a
   * step every few tiles, and the caldera becomes four hundred flat shelves you
   * can see and cannot reach. The lake is allowed to wander because a
   * shoreline is a surface, and surfaces cost nothing to walk along.
   */
  /**
   * How far out the flat bottom reaches, and how much of the half-width each
   * terrace climbs over. The floor has to stay WIDE -- ten tiles of it here --
   * because the town, the ring road and the beach all have to fit between the
   * lake and the first step, and a five-by-four store on a seven-tile ring has
   * nowhere to stand that is not already the road.
   */
  floor = 0.70,
  step = 0.09,           // about 3.3 tiles a terrace: two would be severable
  /** The lake and its ash beach, as fractions of the half-width. */
  bands = { lake: 0.24, ash: 0.30 },
  lakeWobble = [[2, 0.10, 1.7], [4, 0.06, 4.4]],
  /** The ring road, as a fraction of the half-width. Between beach and terraces. */
  ring = 0.46,
  /** Hot pools on the floor, as [bearing, fraction out, radius]. Small, and off the road. */
  vents = [[0.9, 0.37, 1.5], [5.0, 0.63, 1.4]],
  /**
   * Where each landmark wants to stand, as [bearing, fraction out]. The
   * fractions straddle the ring road rather than sitting on it -- a building
   * placed at the road's own radius has to be allowed onto paving, and a
   * five-by-four laid across the only loop in the world is how you sever it.
   */
  /**
   * Where each landmark wants to stand: a bearing round the ring, and how far
   * out as a fraction of the half-width. The two GATES are five tiles wide and
   * two deep, and a terrace is only three tiles deep -- so a gate fits on the
   * ring only where the ring runs east-west, which is to say near due north or
   * due south. Their bearings are not free and a generator must not treat them
   * as though they were.
   */
  sites = {
    gate: -1.57, home: [2.2, 0.60], store: [0.55, 0.60],
    cottage: [3.6, 0.60], quay: [1.42, 0.36],
  },
  meta = {
    id: 'ashkettle',
    name: 'Ashkettle Caldera',
    note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
  },
} = {}) {
  const d = new Draft(size, size, seed);
  const cx = Math.round(size / 2), cz = Math.round(size / 2);
  const half = size / 2;
  /** Tile at `frac` of the half-width out from the middle, on bearing `a`. */
  const at = (a, frac) => [
    Math.round(cx + Math.cos(a) * frac * half),
    Math.round(cz + Math.sin(a) * frac * half),
  ];

  /**
   * HOW MANY TERRACES THERE ARE IS NOT A CHOICE, and getting this wrong is the
   * subtlest way to break the world.
   *
   * The only ramps here are the two trails, and a trail walks a ROW -- so it can
   * only cut a ramp onto a terrace that its row actually reaches. The furthest a
   * row gets from the middle is `axisMax`; the corners of the grid are half as
   * far again. Let the terraces keep counting past `axisMax` and the top one
   * exists in the four corners and nowhere else: four wedges of ground, no row
   * crossing them, no ramp onto any of them, and a thousand tiles you can see
   * and never stand on. So the count stops at the last level the trail can
   * reach, and everything beyond flattens into it.
   */
  const axisMax = (d.W - 0.5 - cx) / half;
  const rim = Math.max(1, Math.floor((axisMax - floor) / step));

  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) {
      const nx = (x + 0.5 - cx) / half, nz = (z + 0.5 - cz) / half;
      const dist = Math.hypot(nx, nz);
      const e = Math.min(rim, Math.max(0, Math.ceil((dist - floor) / step)));
      d.elev[z][x] = String(e);

      const a = Math.atan2(nz, nx);
      let wob = 1;
      for (const [k, amp, phase] of lakeWobble) wob += amp * Math.sin(k * a + phase);
      const lake = dist / wob;
      // Cinder on the top terrace, where nothing has got a hold yet.
      d.surf[z][x] = lake < bands.lake ? 'w'
        : lake < bands.ash ? 's'
          : e >= rim ? 's' : 'g';
    }
  }

  // Hot pools, each with its own crust of mineral. Kept small and kept off the
  // ring road: the floor is seven tiles of walkable ground between the beach
  // and the first terrace, and a pool that spanned it would cut the loop.
  for (const [a, frac, r] of vents) {
    const [vx, vz] = at(a, frac);
    d.disc(d.surf, vx, vz, r + 1.2, 's');
    d.disc(d.surf, vx, vz, r, 'w');
  }
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) if (d.surf[z][x] === 'w') d.elev[z][x] = '0';
  }

  /**
   * ONE TRAIL EACH WAY, and that is genuinely enough. Every terrace is a closed
   * loop at one height, so a single ramp onto it reaches all of it -- and
   * `trail` flags every rise it walks past, so one call climbs the whole
   * staircase from the floor to the rim. Two calls, east and west, are for the
   * walk rather than the access.
   */
  d.trail(cz, cx + Math.round(0.55 * half), 1);
  d.trail(cz, cx - Math.round(0.55 * half), -1);

  // The ring road: a loop of little patches, the same trick Tidewrack uses,
  // because `pave` takes rectangles and a circle is not one.
  for (let i = 0; i < 260; i++) {
    const a = (i / 260) * Math.PI * 2;
    const [rx, rz] = at(a, ring);
    d.pave(rx, rz, rx + 1, rz + 1, { level: '0' });
  }

  // The rim gate stands on the SECOND terrace, and where that is falls out of
  // the floor and the step rather than being stated: a fraction picked in
  // advance lands on bench one or bench three the moment either number moves,
  // and `placeNear` is told which level to insist on.
  const [gx, gz] = at(sites.gate, floor + step * 1.5);
  const gate = d.placeNear('gate.rim', 'building.gate', gx - 2, gz, ['g', 's'], 9,
    { label: 'The Ashkettle Rim' }, '1');
  const [qx, qz] = at(...sites.quay);
  const quay = d.placeNear('gate.quay', 'building.gate', qx - 2, qz, ['s', 'g', 'c'], 9,
    { label: 'Kettle Water' }, '0');
  /**
   * The town is allowed to stand ON the ring road, which no other world permits
   * its houses to do. A building measured straight out from the middle needs its
   * full width of floor in the RADIAL direction, and the road runs down the
   * middle of the only floor there is -- so forbidding paving would mean asking
   * for a ten-tile floor with a five-tile store on one side of a three-tile road
   * and nothing on the other. A shop fronting the road severs nothing: the road
   * is paint, the floor either side of it is grass, and `heal` checks the walk.
   */
  const [hx, hz] = at(...sites.home);
  const home = d.placeNear('home.player', 'building.home', hx - 1, hz, ['g', 'c'], 11,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const [sx, sz] = at(...sites.store);
  const store = d.placeNear('store.cinder', 'building.store', sx - 2, sz, ['g', 'c'], 11,
    { label: 'The Cinder Shop', interior: 'worlds/interiors/store-cinder.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g', 'c'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const [cxx, czz] = at(...sites.cottage);
  const cottage = d.placeNear('home.vesper', 'building.cottage', cxx - 1, czz, ['g', 'c'], 11,
    { label: "Vesper's", interior: 'worlds/interiors/home-vesper.json' }, '0');

  // Every door out to the ring road, which is the only through-line there is.
  const toRing = (door, dz) => {
    const [rx, rz] = at(Math.atan2(door[1] + dz - cz, door[0] - cx), ring);
    d.pathL(door[0], door[1] + dz, rx, rz, { level: '0' });
  };
  toRing([home[0] + 1, home[1]], 3);
  toRing([store[0] + 2, store[1]], 4);
  toRing([furniture[0] + 2, furniture[1]], 4);
  toRing([cottage[0] + 1, cottage[1]], 3);
  toRing([quay[0] + 2, quay[1]], 2);
  addHousewright(d, home, {
    id: 'folk.brin', name: 'Brin', title: 'Caldera Joiner',
    voice: { pitch: 1.03, rate: 22, timbre: 'square' },
    flavor: 'Brin. Ash dries timber mean and straight. Your house can rise twice over on its own floor plan, with joints cut for the kettle winds.',
  });

  // THE PEOPLE. One on the floor, one at the water, one up on a terrace -- the
  // three heights the place has, which is the only way a bowl can spread
  // anybody out.
  d.person({
    id: 'folk.ro',
    type: 'folk.villager',
    tile: [quay[0] + 2, quay[1] + 2],
    facing: 'north',
    props: { name: 'Ro', title: 'Watches the water', roam: 6 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { flag: 'told' }, to: 'after' },
            { when: { visits: 3 }, to: 'third' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Do not drink it. It is warm and it is wrong and everyone tries it once.',
            "Ro. I sit with the lake. Somebody kept falling in before I did.",
          ],
          then: 'menu',
        },
        third: { text: 'Still warm. Still wrong.', then: 'menu' },
        menu: {
          text: 'What is it?',
          choices: [
            { text: 'What is on the other side?', to: 'across' },
            { text: 'Why is the ground hot?', to: 'hot' },
            {
              text: 'Any use for stones?',
              when: { has: { type: 'item.stone', count: 4 } },
              to: 'trade',
            },
            { text: 'Nothing. Carry on.', to: 'bye' },
          ],
        },
        across: {
          text: [
            'The rest of the road, and you get there by walking round it like everybody else.',
            'The lake looks like a shortcut for about a week and then it stops looking like one.',
          ],
          do: { set: 'told' },
          then: 'menu',
        },
        hot: {
          text: 'Because we live in the top of something that has not entirely finished.',
          then: 'menu',
        },
        trade: {
          text: 'I skim them. Four is a good afternoon. There.',
          do: [{ take: { type: 'item.stone', count: 4 } }, { coins: 24 }],
          then: 'menu',
        },
        after: { text: 'Round again, is it.', then: 'menu' },
        bye: { text: 'Mind the warm patches.' },
      },
    },
  });

  d.person({
    id: 'folk.cinder',
    type: 'folk.gardener',
    tile: [gate[0] + 2, gate[1] + 2],
    facing: 'south',
    props: { name: 'Tally', title: 'Keeps the terraces', roam: 6 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { visits: 3 }, to: 'again' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'You came up. Good. Everything up here is better than everything down there.',
            "Tally. I keep the benches -- what will root in cinder, which is not much and knows it.",
          ],
          then: 'menu',
        },
        again: { text: 'Up again. It is the only way out of a bowl, going up.', then: 'menu' },
        menu: {
          text: 'Anything?',
          choices: [
            {
              text: 'Anything growing on the cinder?',
              when: { room: { type: 'item.mushroom', count: 2 } },
              to: 'gift',
            },
            { text: 'What am I standing in?', to: 'view' },
            { text: 'Just the climb.', to: 'bye' },
          ],
        },
        gift: {
          text: 'On the warm side of the stones. Take them, they will not keep.',
          do: { give: { type: 'item.mushroom', count: 2 } },
          then: 'menu',
        },
        view: {
          text: [
            'A ring of wall, four steps of bench, a floor, and a lake in the hole of it.',
            'There is no outside. People take a while with that and then they stop minding.',
          ],
          then: 'menu',
        },
        bye: { text: 'Go steady on the steps.' },
      },
    },
  });

  d.person({
    id: 'folk.vesper',
    type: 'folk.tinker',
    tile: [cottage[0] + 1, cottage[1] + 3],
    facing: 'south',
    props: {
      name: 'Vesper', title: 'Has the far side to herself', roam: 6,
      // Low and level, and the slowest voice on the caldera: she talks to the
      // far shore for a living and none of it is in a hurry.
      voice: { pitch: 0.88, rate: 17, timbre: 'triangle' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { all: [{ friend: true }, { flag: 'lamp' }] }, to: 'lampagain' },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'You walked the whole way round. Nobody does that twice by accident.',
            "Vesper. The door is yours now -- there is a fire in it and nothing else to recommend it.",
            'It is in the middle of the floor and the room is round, so there is no bad seat. That is the whole design.',
          ],
          then: 'menu',
        },
        welcome: { text: 'Far side today, same as every day. Fire is in, go and sit at it.', then: 'menu' },
        lampagain: {
          text: [
            'You lit it.',
            'I saw the shutter from the path and for about two seconds I thought somebody had answered.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Well?',
          choices: [
            { text: 'Why live over here?', to: 'why' },
            {
              text: 'I have sticks going spare.',
              when: { has: { type: 'item.stick', count: 3 } },
              to: 'trade',
            },
            { text: 'What is the lamp on the post?', when: { not: { flag: 'lamp' } }, to: 'lamp' },
            { text: 'Why is the room round?', to: 'round' },
            { text: 'Does anyone ever come over?', when: { visits: 3 }, to: 'company' },
            { text: 'Nothing. Thanks.', to: 'bye' },
          ],
        },
        why: {
          text: 'Because from here the town is a thing I can look at, and from there it is a thing I am in.',
          then: 'menu',
        },
        trade: {
          text: 'Firewood grows badly here and burns fine. That is fair for three.',
          do: [{ take: { type: 'item.stick', count: 3 } }, { coins: 20 }],
          then: 'menu',
        },
        lamp: {
          text: [
            'A signal lamp, and there is nobody signalling back, and I light it most nights anyway.',
            'Light it yourself if you are in there. The shutter is stiff. Long, short, long -- that one means nothing, I made it up.',
          ],
          do: { set: 'lamp' },
          then: 'menu',
        },
        round: {
          text: [
            'Because a corner is somewhere the fire does not reach and I have only the one fire.',
            'Walled the four of them off my first winter. Best day\'s work I have done and the least of it to look at.',
          ],
          then: 'menu',
        },
        company: {
          text: [
            'Ro walks round about twice a year and complains about the distance the entire way.',
            'You have been over more times than that already. I am not making a thing of it. I am just saying I counted.',
          ],
          then: 'menu',
        },
        bye: { text: 'Round you go.' },
      },
    },
  });

  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 20, ['g', 's']),
    pine: d.scatter('pine', 'tree.pine', 96, ['g']),
    oak: d.scatter('oak', 'tree.oak', 34, ['g']),
    rock: d.scatter('rock', 'rock.small', 72, ['g', 's']),

    // Ducks on the warm lake, sheep on the benches where the trails come out,
    // crows on the cinder, and a rabbit or two down on the floor. No chickens
    // and no goats: those belong to worlds you can walk out of.
    duck: d.flock('duck', 'duck', 4, cx, cz + Math.round(0.34 * half), 8, ['s', 'g']),
    sheep: d.flock('sheep', 'sheep', 3, cx - Math.round(0.72 * half), cz + 4, 8, ['g']),
    crow: d.flock('crow', 'crow', 4, cx + Math.round(0.70 * half), cz - 6, 9, ['g', 's']),
    rabbit: d.flock('rabbit', 'rabbit', 3, home[0] + 2, home[1] + 7, 7, ['g']),
    cat: d.flock('cat', 'cat', 1, store[0] + 2, store[1] + 6, 6, ['g', 'c']),

    stone: d.litter('stone', 'item.stone', 26, ['s']),
    stick: d.litter('stick', 'item.stick', 20, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 16, ['g', 's']),
    flower: d.litter('flower', 'item.flower', 12, ['g']),
    apple: d.litter('apple', 'item.apple', 6, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta,
      terrain: { form: 'caldera' },
      spawn: { tile: [home[0] + 1, home[1] + 5], facing: 'south' },
      // Close, and greyer than a holler's. A caldera holds its own weather in
      // the bowl, and the haze is what makes the far side of the ring read as
      // far rather than as the other end of a field.
      ambience: { fog: [20, 62], sky: 0xa9b6c4 },
    }),
  };
}

// ===========================================================================
// SEDGEWATER -- a fen
// ===========================================================================
// The other kind of world with water round it, and the argument with
// Meadowbrook is about what water DOES. An island's sea is a wall: it is over
// there, it is one shape, and the whole of the island is on this side of it.
// A fen's water is IN the place. It comes up the middle in channels, splits the
// ground into wedges, and the question every walk here asks is not "how do I
// get round the island" but "is this way through, or do I go back to the middle
// and come out again".
//
// So the middle matters more here than in any other world. Every wedge meets
// at the toft -- the one dry rise in sixty-four tiles -- which makes it the
// place's junction, its landmark and its only view, all at once.
export function sedgewater({
  seed = 0x5edc1a,
  size = 64,
  /**
   * The outer shore, as fractions of `spread` (itself a fraction of the grid,
   * so the reeds always start well inside the edge -- open water at the
   * boundary is what the fen's band welds to).
   */
  spread = 0.42,
  bands = { sedge: 0.80, mud: 0.90 },
  wobble = [[3, 0.09, 2.2], [5, 0.06, 0.4], [8, 0.04, 3.9]],
  /**
   * The channels: how many, where the first one points, and how wide they open
   * to. They are RADIAL, and that is a connectivity decision rather than a
   * picture. Spokes never cross, so the ground between them is one piece joined
   * at the middle by construction -- a fen laid out with a braided channel
   * pattern is a fen that strands a third of itself on most seeds.
   */
  channels = { count: 5, phase: 0.35, width: 2.3, core: 0.26, open: 0.25 },
  /** The toft: the one rise, as an offset from the middle and a radius. */
  toft = [0, -3, 5.6],
  /** Plank walks across a channel, as [bearing, fraction out, half-length]. */
  planks = [[1.63, 0.52, 5], [4.77, 0.58, 5]],
  /** Which bearing each landmark wants. Wedge centres, so nothing sits in a channel. */
  sites = { home: 1.63, store: 3.89, cottage: 5.14 },
  meta = {
    id: 'sedgewater',
    name: 'Sedgewater Fen',
    note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
  },
} = {}) {
  const d = new Draft(size, size, seed);
  const cx = Math.round(size / 2), cz = Math.round(size / 2);
  const R = size * spread;
  const at = (a, frac) => [
    Math.round(cx + Math.cos(a) * frac * R),
    Math.round(cz + Math.sin(a) * frac * R),
  ];
  const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  /**
   * How far this point is from the nearest channel's centre line, in tiles.
   * Angle times radius is the perpendicular distance to a spoke, near enough,
   * and "near enough" is the right accuracy for a bank of reeds.
   */
  const toChannel = (a, dist) => {
    let best = Infinity;
    for (let k = 0; k < channels.count; k++) {
      const spoke = channels.phase + (k * 2 * Math.PI) / channels.count;
      let da = ((a - spoke + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      best = Math.min(best, Math.abs(da) * dist * R);
    }
    return best;
  };

  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) {
      const nx = (x + 0.5 - cx) / R, nz = (z + 0.5 - cz) / R;
      const a = Math.atan2(nz, nx);
      const dist = Math.hypot(nx, nz);
      let wob = 1;
      for (const [k, amp, phase] of wobble) wob += amp * Math.sin(k * a + phase);
      const r = dist / wob;

      // Outer shore first: sedge, then a mud flat, then open fen.
      let s = r < bands.sedge ? 'g' : r < bands.mud ? 's' : 'w';

      // Then the channels cut back through it. They open from nothing at the
      // core to full width a quarter of the way out, so the middle stays whole.
      if (s !== 'w') {
        const open = smoothstep((dist - channels.core) / channels.open);
        const perp = toChannel(a, dist);
        if (perp < channels.width * open) s = 'w';
        else if (perp < (channels.width + 1.2) * open) s = 's';
      }
      d.surf[z][x] = s;
    }
  }

  // The toft. One rise, near the middle, with the usual two-column cut up its
  // south face -- and it is the only elevation in the world, which is what
  // makes standing on it worth the four steps.
  d.disc(d.elev, cx + toft[0], cz + toft[1], toft[2], '1');
  d.disc(d.surf, cx + toft[0], cz + toft[1], toft[2], 'g');
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) if (d.surf[z][x] === 'w') d.elev[z][x] = '0';
  }
  const rampZ = d.rampNorth(cx - 1);
  d.rampNorth(cx);

  /**
   * Boardwalk. A spur out along the middle of every wedge, stamped as little
   * patches the way Tidewrack's ring road is, because a ray is not a rectangle
   * either. Paving is what tells you which way through a fen is a way through.
   */
  for (let k = 0; k < channels.count; k++) {
    const a = channels.phase + ((k + 0.5) * 2 * Math.PI) / channels.count;
    for (let i = 0; i < 90; i++) {
      const [px, pz] = at(a, 0.17 + (i / 90) * 0.55);
      d.pave(px, pz, px + 1, pz + 1, { level: '0' });
    }
  }
  d.pave(cx - 4, cz - 8, cx + 3, cz - 1, { level: '1' });     // apron on the toft
  d.pave(cx - 1, rampZ, cx, cz + 6, { level: '0' });          // down off the toft

  /**
   * Plank walks. Unlike everything else here these cross OPEN WATER -- `onto`
   * takes 'w' -- which is the one thing in the kit that adds ground rather than
   * paints it. They are a convenience and never a necessity: the wedges are
   * already joined at the middle, so a plank that failed to land would cost a
   * shortcut rather than half the map.
   */
  for (const [a, frac, len] of planks) {
    for (let i = -len; i <= len; i++) {
      const px = Math.round(cx + Math.cos(a) * frac * R - Math.sin(a) * i);
      const pz = Math.round(cz + Math.sin(a) * frac * R + Math.cos(a) * i);
      d.pave(px, pz, px + 1, pz + 1, { level: '0', onto: ['g', 's', 'w'] });
    }
  }

  const [tx, tz] = [cx + toft[0] - 2, cz + toft[1] - 3];
  const staithe = d.placeNear('gate.staithe', 'building.gate', tx, tz, ['c', 'g'], 7,
    { label: 'Sedgewater Staithe' }, '1');
  const [hx, hz] = at(sites.home, 0.42);
  const home = d.placeNear('home.player', 'building.home', hx - 1, hz, ['g'], 12,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const [sx, sz] = at(sites.store, 0.44);
  const store = d.placeNear('store.staithe', 'building.store', sx - 2, sz, ['g'], 12,
    { label: 'The Staithe', interior: 'worlds/interiors/store-staithe.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const [qx, qz] = at(sites.cottage, 0.50);
  const cottage = d.placeNear('home.quill', 'building.cottage', qx - 1, qz, ['g'], 12,
    { label: "Quill's Hut", interior: 'worlds/interiors/home-quill.json' }, '0');

  // Every door back to the boardwalk that serves its wedge -- and back to the
  // NEAREST point of it, which is the point the house was wished at. Aiming
  // these at the middle instead would be correct and would also pave a two-tile
  // strip the length of every wedge, three times over, until the fen read as a
  // car park with reeds round it.
  const toWalk = (door, dz, a, frac) => {
    const [wx, wz] = at(a, frac);
    d.pathL(door[0], door[1] + dz, wx, wz, { level: '0' });
  };
  toWalk([home[0] + 1, home[1]], 3, sites.home, 0.42);
  toWalk([store[0] + 2, store[1]], 4, sites.store, 0.44);
  toWalk([furniture[0] + 2, furniture[1]], 4, sites.store, 0.50);
  toWalk([cottage[0] + 1, cottage[1]], 3, sites.cottage, 0.50);
  d.pathL(staithe[0] + 2, staithe[1] + 2, cx - 1, cz + toft[1] + 2, { level: '1' });
  addHousewright(d, home, {
    id: 'folk.fenna', name: 'Fenna', title: 'Fen Pilewright',
    voice: { pitch: 1.2, rate: 24, timbre: 'triangle' },
    flavor: 'Fenna. In Sedgewater we trust the piles and spare the reeds. Yours will bear two more levels directly upward, no wider than it stands today.',
  });

  // THE PEOPLE. One on the toft, because it is the only place you can see the
  // shape of a fen from; one at the far end of a boardwalk; one at home.
  d.person({
    id: 'folk.meg',
    type: 'folk.fisher',
    tile: [staithe[0] + 2, staithe[1] + 2],
    facing: 'south',
    props: { name: 'Meg', title: 'Knows which way is through', roam: 5 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { flag: 'told' }, to: 'after' },
            { when: { visits: 3 }, to: 'third' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Stay on the boards until you know it. Everyone says that. Everyone means it.',
            "Meg. I have been getting across this fen for forty years and I still go the long way.",
          ],
          then: 'menu',
        },
        third: { text: 'Still on the boards, I see. Sensible.', then: 'menu' },
        menu: {
          text: 'What can I tell you?',
          choices: [
            { text: 'Why can I not cut across?', to: 'across' },
            { text: 'What is out past the reeds?', to: 'out' },
            {
              text: 'Any use for sticks?',
              when: { has: { type: 'item.stick', count: 3 } },
              to: 'trade',
            },
            { text: 'I will find my own way.', to: 'bye' },
          ],
        },
        across: {
          text: [
            'Because the channels come right up the middle and only the middle joins them.',
            'Two doors a hundred paces apart, and the walk between them goes past my feet. That is a fen.',
          ],
          do: { set: 'told' },
          then: 'menu',
        },
        out: {
          text: 'More of it. It is ankle deep for a day in any direction and then it is over your head.',
          then: 'menu',
        },
        trade: {
          text: 'Alder, is it. Boards want mending oftener than you would think. There.',
          do: [{ take: { type: 'item.stick', count: 3 } }, { coins: 22 }],
          then: 'menu',
        },
        after: { text: 'Long way round again?', then: 'menu' },
        bye: { text: 'Boards, mind.' },
      },
    },
  });

  d.person({
    id: 'folk.quill',
    type: 'folk.gardener',
    tile: [cottage[0] + 1, cottage[1] + 3],
    facing: 'south',
    props: {
      name: 'Quill', title: 'Cuts reed', roam: 7,
      // Soft and unhurried, and pitched up: everything out here is muffled by
      // reed, so the one voice in it does not have to carry.
      voice: { pitch: 1.06, rate: 20, timbre: 'triangle' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { all: [{ friend: true }, { flag: 'hole' }] }, to: 'holeagain' },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'You walked all the way out here. Nobody walks all the way out here.',
            "Quill. Reed cutter. The hut is yours to sit in now, it is dry in one corner.",
            'One corner. I want to be clear about the number.',
          ],
          then: 'menu',
        },
        welcome: { text: 'Come in. Mind the bundles, and mind the hole.', then: 'menu' },
        holeagain: {
          text: 'You have been hauling my trap. Good. It goes sour if nobody lifts it.',
          then: 'menu',
        },
        menu: {
          text: 'Well?',
          choices: [
            {
              text: 'Anything worth picking out here?',
              when: { room: { type: 'item.flower', count: 2 } },
              to: 'gift',
            },
            { text: 'Does the water ever go down?', to: 'water' },
            { text: 'There is a hole in your floor.', when: { not: { flag: 'hole' } }, to: 'hole' },
            { text: 'Which corner is the dry one?', to: 'dry' },
            {
              text: 'I have sticks, if reed is short.',
              when: { has: { type: 'item.stick', count: 2 } },
              to: 'trade',
            },
            { text: 'Just passing.', to: 'bye' },
          ],
        },
        gift: {
          text: 'Marsh marigold, off the bank. Take them before the wet gets in.',
          do: { give: { type: 'item.flower', count: 2 } },
          then: 'menu',
        },
        water: {
          text: [
            'It goes down in August and everyone gets ambitious and cuts a new path across.',
            'Then it comes back up in September and takes the path, and we all pretend we knew.',
          ],
          then: 'menu',
        },
        hole: {
          text: [
            'There is. I cut it.',
            'The hut is on posts and the fen is under it, so the fen may as well be in it. The trap hangs through.',
            'Haul it when you are in there. It is bad manners to leave a trap down and worse to leave it up.',
          ],
          do: { set: 'hole' },
          then: 'menu',
        },
        dry: {
          text: [
            'East end, up the step. That step is the difference between a house and a boat and I built it myself.',
            'Everything I care about is on it. Everything I use is not.',
          ],
          then: 'menu',
        },
        trade: {
          text: 'Willow? I will have that. Reed will not take a nail and some days that matters.',
          do: [{ take: { type: 'item.stick', count: 2 } }, { coins: 15 }],
          then: 'menu',
        },
        bye: { text: 'Go careful off the boards.' },
      },
    },
  });

  d.person({
    id: 'folk.tarn',
    type: 'folk.villager',
    tile: [home[0] + 3, home[1] + 4],
    facing: 'west',
    props: { name: 'Tarn', title: 'Neighbour, more or less', roam: 6 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { visits: 4 }, to: 'fourth' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'You are the new one. We could see your roof before we could reach it.',
            "Tarn. Nearest neighbour you have got, which out here means about a quarter of an hour.",
          ],
          then: 'menu',
        },
        fourth: { text: 'Still nearest. Still a quarter of an hour.', then: 'menu' },
        menu: {
          text: 'Anything?',
          choices: [
            { text: 'Where do I buy things?', to: 'shop' },
            {
              text: 'I have stones going spare.',
              when: { has: { type: 'item.stone', count: 4 } },
              to: 'trade',
            },
            { text: 'Nothing. Thanks.', to: 'bye' },
          ],
        },
        shop: {
          text: 'The Staithe. Follow the boards to the middle and take the next spur but one.',
          then: 'menu',
        },
        trade: {
          text: 'Hard standing is worth money in a bog. I will take those.',
          do: [{ take: { type: 'item.stone', count: 4 } }, { coins: 25 }],
          then: 'menu',
        },
        bye: { text: 'Aye. Mind the soft bits.' },
      },
    },
  });

  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 8, ['g']),
    // Alder and willow, standing in as oak and pine, and thick: a fen closes in
    // and the closing in is most of what makes the boardwalk feel like a route
    // rather than a stripe of paving.
    oak: d.scatter('oak', 'tree.oak', 110, ['g']),
    pine: d.scatter('pine', 'tree.pine', 48, ['g']),
    rock: d.scatter('rock', 'rock.small', 34, ['g', 's']),

    // Ducks, and plenty, because this is what a fen is for. Crows on the mud,
    // rabbits on the toft where it is dry, and the shop's cat, who will not go
    // near the boards.
    duck: d.flock('duck', 'duck', 5, cx + 12, cz + 12, 10, ['s', 'g']),
    duckWest: d.flock('duck.west', 'duck', 4, cx - 13, cz - 9, 9, ['s', 'g']),
    crow: d.flock('crow', 'crow', 4, cx - 9, cz + 15, 9, ['g', 's']),
    rabbit: d.flock('rabbit', 'rabbit', 3, cx + toft[0], cz + toft[1], 6, ['g', 'c']),
    cat: d.flock('cat', 'cat', 1, store[0] + 2, store[1] + 6, 6, ['g', 'c']),

    // Reed and bank foraging: sticks everywhere, stones only on the mud, and
    // not a shell in the place -- this water has never been near the sea.
    stick: d.litter('stick', 'item.stick', 26, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 18, ['g']),
    flower: d.litter('flower', 'item.flower', 18, ['g', 's']),
    stone: d.litter('stone', 'item.stone', 12, ['s']),
    apple: d.litter('apple', 'item.apple', 6, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta,
      terrain: { form: 'fen' },
      spawn: { tile: [cx - 1, rampZ + 3], facing: 'south' },
      // The closest fog in the game, and a flat grey-green sky over it. A fen
      // with a clear horizon is a lake with grass in it; the whole feeling of
      // the place is not being able to see whether the next wedge joins yours.
      ambience: { fog: [14, 46], sky: 0xbfcbc4 },
    }),
  };
}

// ===========================================================================
// BELLROCK -- a coast
// ===========================================================================
// The only world whose outside is two different things at once: open sea off
// the south edge, farmland rolling away over the other three. Every other form
// answers "why can you not walk off the map" with one word. This one answers it
// twice, and the answers face each other across the town -- which is what a
// coast IS. An island is somewhere the sea has surrounded; a coast is somewhere
// the land and the sea both keep going and you happen to live on the seam.
//
// So the layout is a section rather than a plan: beach, then the road along the
// top of it, then the town on the flat, then the downs stepping up behind. You
// can stand in one place and see all four, and where you are in that stack is
// the only address anybody here uses.
export function bellrock({
  seed = 0xbe11c0,
  width = 60,
  height = 68,
  /**
   * The shoreline, as a row and its wander. It has to leave the south edge
   * entirely wet and the side edges mostly dry -- see `verifyForm` -- which is
   * the one constraint a coast has that no other form does, and the reason the
   * water is kept to the bottom quarter rather than halfway up the map.
   */
  shore = 0.80,
  shoreWave = [[0.085, 3.0, 1.2], [0.21, 1.4, 4.0]],
  beach = 3.2,
  /**
   * The downs behind the town: where the benches start climbing, and how many
   * rows each takes. Elevation depends on the ROW and nothing else, the same
   * rule Sourwood's walls follow -- a bench that wandered would be a staircase
   * chopped into shelves nobody can walk along.
   */
  benchFrom = 0.42,
  benchStep = 3.6,
  /** Columns where a way climbs the downs. `climb` cuts every step it passes. */
  climbs = [-11, 12],
  /** The tarn on the flat, as [x offset from the road, row fraction, radius]. */
  tarn = [-14, 0.60, 3.0],
  /**
   * Where each landmark wants to stand. The town's three are fractions of the
   * way from the foot of the downs to the coast road -- the flat is a strip
   * between two moving lines, so a row number would put a house in the sea on
   * one roll and up a bench on the next. `down` is the odd one out and is a
   * fraction of the whole map, because the top bench runs to the north edge.
   */
  sites = { home: 0.62, store: 0.62, cottage: 0.44, down: 0.10 },
  meta = {
    id: 'bellrock',
    name: 'Bellrock Coast',
    note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
  },
} = {}) {
  const d = new Draft(width, height, seed);
  const road = Math.round(width / 2);
  const row = (f) => Math.round(f * (d.H - 1));

  /** Where the grass gives out, on column `x`. The beach starts here. */
  const shoreZ = (x) => shoreWave.reduce(
    (c, [k, amp, phase]) => c + amp * Math.sin(x * k + phase), shore * (d.H - 1),
  );
  const benchZ = benchFrom * (d.H - 1);

  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) {
      const e = Math.min(3, Math.max(0, Math.ceil((benchZ - z) / benchStep)));
      d.elev[z][x] = String(e);
      const s = shoreZ(x);
      d.surf[z][x] = z >= s + beach ? 'w' : z >= s ? 's' : 'g';
    }
  }
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) if (d.surf[z][x] === 'w') d.elev[z][x] = '0';
  }

  // The tarn: freshwater on the flat, with a gravel rim so it has a shore of
  // its own rather than reading as a hole cut in the field.
  const tarnZ = row(tarn[1]);
  d.disc(d.surf, road + tarn[0], tarnZ, tarn[2] + 1.3, 's');
  d.disc(d.surf, road + tarn[0], tarnZ, tarn[2], 'w');
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) if (d.surf[z][x] === 'w') d.elev[z][x] = '0';
  }

  // The coast road, running the width of the flat above the beach, and the lane
  // down to the quay. The road is the through-line here the way the creek road
  // is in a holler: it is the only thing that touches both ends of the town.
  // MEASURED, not guessed. The shoreline wanders five rows either way, and a
  // road laid at a fixed fraction of the map is a road with the sea through the
  // middle of it on half the rolls -- `pave` would decline to paint those tiles
  // and leave a coast road in three pieces.
  const roadZ = Math.round(Math.min(...Array.from({ length: d.W }, (_, x) => shoreZ(x)))) - 3;
  const townRow = (f) => Math.round(benchZ + (roadZ - benchZ) * f);
  d.pave(2, roadZ, d.W - 3, roadZ + 1, { level: '0', onto: ['g'] });
  // The slip, aimed at the beach as the beach ACTUALLY falls on this column
  // rather than at a row picked in advance. The shoreline wanders five tiles
  // either way, so a fixed row is a quay in a field on half the rolls.
  const slipZ = Math.round(shoreZ(road)) + 1;
  d.pave(road, roadZ, road + 1, slipZ, { level: '0', onto: ['g', 's'] });

  // Ways up the downs. A row across this world climbs nothing -- every tile in
  // it is on the same bench -- so the staircase is cut up a COLUMN instead.
  // Started just below the first bench rather than at the road: the reservation
  // runs from here to the top of the map, and a lane of bare ground the whole
  // length of the world is a stripe rather than a path.
  for (const dx of climbs) d.climb(road + dx, Math.round(benchZ) + 4, -1);

  const quay = d.placeNear('gate.quay', 'building.gate', road - 2, slipZ, ['s', 'c', 'g'], 9,
    { label: 'Bellrock Quay' }, '0');
  const down = d.placeNear('gate.down', 'building.gate', road - 4, row(sites.down), ['g'], 10,
    { label: 'The Bellrock Down' }, '3');
  const home = d.placeNear('home.player', 'building.home', road - 12, townRow(sites.home), ['g'], 12,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.capstan', 'building.store', road + 6, townRow(sites.store), ['g'], 12,
    { label: 'The Capstan', interior: 'worlds/interiors/store-capstan.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const cottage = d.placeNear('home.sennen', 'building.cottage', road + 16, townRow(sites.cottage), ['g'], 12,
    { label: "Sennen's Cottage", interior: 'worlds/interiors/home-sennen.json' }, '0');

  d.pathL(home[0] + 1, home[1] + 3, road - 6, roadZ, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, road + 4, roadZ, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, road + 8, roadZ, { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, road + 12, roadZ, { level: '0' });
  d.pathL(quay[0] + 2, quay[1] + 2, road, quay[1] + 3, { level: '0' });
  addHousewright(d, home, {
    id: 'folk.ors', name: 'Ors', title: 'Downland Builder',
    voice: { pitch: 0.76, rate: 21, timbre: 'square' },
    flavor: 'Ors. Bellrock bells tell me which way a frame is leaning. Yours is honest. I can stack two useful floors above it and leave every outside tile alone.',
  });

  // THE PEOPLE. One at the quay with the sea behind him, one up on the top
  // bench with the land behind her, and one in the middle who has to look at
  // both. The whole world is that argument, so the cast is too.
  d.person({
    id: 'folk.doss',
    type: 'folk.fisher',
    tile: [quay[0] + 2, quay[1] + 2],
    facing: 'north',
    props: { name: 'Doss', title: 'Off the boats', roam: 6 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { flag: 'told' }, to: 'after' },
            { when: { visits: 3 }, to: 'third' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Tide is doing what it likes today. It usually is.',
            "Doss. Off the boats, mostly. You will have come down the road -- everyone comes down the road.",
          ],
          then: 'menu',
        },
        third: { text: 'Back down. It is the better end of the town, this.', then: 'menu' },
        menu: {
          text: 'What is it?',
          choices: [
            { text: 'What is up the hill?', to: 'hill' },
            { text: 'Anything out there?', to: 'sea' },
            {
              text: 'Any use for shells?',
              when: { has: { type: 'item.shell', count: 3 } },
              to: 'trade',
            },
            { text: 'Nothing. Carry on.', to: 'bye' },
          ],
        },
        hill: {
          text: [
            'Sheep, and Nell, and more of the same for as far as you would care to walk.',
            'It does not stop. That is the difference between here and an island, and it is the whole difference.',
          ],
          do: { set: 'told' },
          then: 'menu',
        },
        sea: {
          text: 'Weather, mostly. And the bell rock, which you will hear before you ever see it.',
          then: 'menu',
        },
        trade: {
          text: 'Three good ones. The shop will not pay you that, whatever they tell you.',
          do: [{ take: { type: 'item.shell', count: 3 } }, { coins: 27 }],
          then: 'menu',
        },
        after: { text: 'Tide still doing what it likes.', then: 'menu' },
        bye: { text: 'Mind the weed on the slip.' },
      },
    },
  });

  d.person({
    id: 'folk.nell',
    type: 'folk.gardener',
    tile: [down[0] + 2, down[1] + 2],
    facing: 'south',
    props: { name: 'Nell', title: 'Keeps the top field', roam: 7 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { visits: 3 }, to: 'again' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'You climbed all four steps. Most stop at two and say they have seen it.',
            "Nell. Top field is mine. From here the sea is a thing that happens down there.",
          ],
          then: 'menu',
        },
        again: { text: 'Up again. The wind is worse and the view is better.', then: 'menu' },
        menu: {
          text: 'Anything?',
          choices: [
            {
              text: 'Anything growing up here?',
              when: { room: { type: 'item.mushroom', count: 2 } },
              to: 'gift',
            },
            { text: 'How far does it go?', to: 'far' },
            { text: 'Just the walk.', to: 'bye' },
          ],
        },
        gift: {
          text: 'In the sheep-cropped bits, where the grass is short enough to see them. Take these.',
          do: { give: { type: 'item.mushroom', count: 2 } },
          then: 'menu',
        },
        far: {
          text: [
            'North? Nobody has ever come back and told me it stopped.',
            'That is why I am up here and Doss is down there. Neither of us is right.',
          ],
          then: 'menu',
        },
        bye: { text: 'Shut the gate behind you.' },
      },
    },
  });

  d.person({
    id: 'folk.sennen',
    type: 'folk.villager',
    tile: [cottage[0] + 1, cottage[1] + 3],
    facing: 'south',
    props: {
      name: 'Sennen', title: 'In the middle of it', roam: 6,
      // Bright and quick and a shade too loud, which is what living between
      // two halves of a town that will not agree does to a man.
      voice: { pitch: 1.08, rate: 27, timbre: 'sawtooth' },
    },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { all: [{ friend: true }, { flag: 'bell' }] }, to: 'bellagain' },
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Halfway up and halfway down. Best row in the town and nobody agrees.',
            "Sennen. Door is open to you now -- kettle is usually on and the fire usually is not.",
            'House is two houses, mind. Boards up the hill side, flags down the sea side, and a step between them.',
          ],
          then: 'menu',
        },
        welcome: { text: 'Come in whenever. You know where it is. Both ways round, remember.', then: 'menu' },
        bellagain: {
          text: [
            'That was you on the bell.',
            'Whole coast heard it and every one of them thought it was for them. That is the trick of the thing.',
          ],
          then: 'menu',
        },
        menu: {
          text: 'Well?',
          choices: [
            { text: 'Sea or hill?', to: 'both' },
            {
              text: 'I have flowers going spare.',
              when: { has: { type: 'item.flower', count: 3 } },
              to: 'trade',
            },
            { text: 'Why is there a bell in your front room?', when: { not: { flag: 'bell' } }, to: 'bell' },
            { text: 'Why two ramps and not one?', to: 'ramps' },
            { text: 'Does anybody agree with you about anything?', when: { visits: 4 }, to: 'agree' },
            { text: 'Nothing today.', to: 'bye' },
          ],
        },
        both: {
          text: 'Both, obviously. That is what a coast is and they both think it is a betrayal.',
          then: 'menu',
        },
        trade: {
          text: 'For the window. It faces the road and the road deserves better. Here.',
          do: [{ take: { type: 'item.flower', count: 3 } }, { coins: 19 }],
          then: 'menu',
        },
        bell: {
          text: [
            'Because this house is the only one both halves can hear at the same time. Somebody had to have it.',
            'Sea gets the note first and the hill sends it back about a second later. I timed it with a candle.',
            'Ring it if you are in there. Everybody stops. It is the best second of anybody\'s day.',
          ],
          do: { set: 'bell' },
          then: 'menu',
        },
        ramps: {
          text: [
            'Because with one you go up and come back down the same way, and that is a corridor, not a house.',
            'With two you can go round. Same as the town. I did not build the town but I did build the ramps.',
          ],
          then: 'menu',
        },
        agree: {
          text: [
            'Nell says the sea is a thing that happens down there. Doss says the hill is somewhere you go when the tide is wrong.',
            'They are both describing my front room and neither of them will come and stand in it.',
          ],
          then: 'menu',
        },
        bye: { text: 'Go on, then.' },
      },
    },
  });

  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 14, ['g', 's']),
    // Thin along the shore and thickening inland, which is what wind does to a
    // coast: the top bench is wooded, the beach road is bare and stays bare.
    pine: d.scatter('pine', 'tree.pine', 66, ['g'], 4200, '3'),
    oak: d.scatter('oak', 'tree.oak', 46, ['g']),
    rock: d.scatter('rock', 'rock.small', 48, ['g', 's']),

    // Sheep on the downs, where the climbs come out. Chickens in the yard,
    // ducks at the tarn, crows on the tide line, and the shop's cat.
    sheep: d.flock('sheep', 'sheep', 4, road + climbs[0], row(0.22), 9, ['g']),
    sheepEast: d.flock('sheep.east', 'sheep', 3, road + climbs[1] + 4, row(0.34), 8, ['g']),
    chicken: d.flock('chicken', 'chicken', 3, home[0] + 1, home[1] + 5, 4, ['g', 'c']),
    duck: d.flock('duck', 'duck', 3, road + tarn[0], tarnZ + 4, 6, ['g', 's']),
    crow: d.flock('crow', 'crow', 3, road + 14, row(0.80), 9, ['s', 'g']),
    cat: d.flock('cat', 'cat', 1, store[0] + 2, store[1] + 6, 6, ['g', 'c']),

    // The only new world with shells in it, and that is deliberate: the sea is
    // the half of this place an island would recognise.
    shell: d.litter('shell', 'item.shell', 22, ['s'], { cx: road, cz: row(0.82), radius: 26 }),
    stone: d.litter('stone', 'item.stone', 16, ['s']),
    stick: d.litter('stick', 'item.stick', 22, ['g']),
    flower: d.litter('flower', 'item.flower', 16, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 12, ['g'], { cx: road, cz: row(0.16), radius: 16 }),
    apple: d.litter('apple', 'item.apple', 7, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta,
      terrain: { form: 'coast', open: ['south'] },
      spawn: { tile: [road - 1, roadZ + 3], facing: 'south' },
      // Long, and a sea-light sky. A coast is a place you look OUT of in two
      // directions at once, and close fog would take away both of them.
      ambience: { fog: [30, 92], sky: 0xbcdcf0 },
    }),
  };
}
