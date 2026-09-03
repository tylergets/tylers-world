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

const TOWN_HALL = { label: 'Town Hall', interior: 'worlds/interiors/town-hall.json' };
const MUSEUM = { label: 'Museum', interior: 'worlds/interiors/museum.json' };

function addTownHall(d, x, z, allow = ['g', 'c'], radius = 20, level = '0') {
  const hall = d.placeNear('town.hall', 'building.townhall', x, z, allow, radius, TOWN_HALL, level);
  // Recipes expand their grids twofold before returning. Half the hall's
  // authored depth therefore lands this board one final tile row beyond its
  // south wall, left of the doorway and inside the scenery reservation.
  d.place('town.noticeboard', 'civic.noticeboard', hall[0], hall[1] + 3);
  return hall;
}

/** Place the other civic building near Town Hall and join their front walks. */
function addMuseum(d, hall, allow = ['g', 'c', 's'], radius = 24, level = '0') {
  const museum = d.placeNear(
    'town.museum', 'building.museum', hall[0] + 11, hall[1], allow, radius, MUSEUM, level,
  );
  d.pathL(museum[0] + 3, museum[1] + 5, hall[0] + 4, hall[1] + 6, { level });
  return museum;
}

/** Place the player's home and its reachable mailbox as one town feature. */
function addPlayerHome(d, id, x, z, allow, radius, props, level) {
  const home = d.placeNear(id, 'building.home', x, z, allow, radius, props, level);
  const mailboxTiles = [
    [home[0] + 3, home[1] + 3], [home[0] + 4, home[1] + 2],
    [home[0] - 1, home[1] + 2], [home[0] + 4, home[1] + 3],
  ];
  const mailbox = mailboxTiles.find(([mx, mz]) => d.free(mx, mz, 1, 1, ['g', 'c', 's'], level));
  if (!mailbox) throw new Error(`${id}: no room for its mailbox`);
  d.place('mailbox.player', 'yard.mailbox', mailbox[0], mailbox[1]);
  return home;
}

const NEIGHBOR_DOOR_X = {
  'building.cottage': 1,
  'building.cabin': 2,
  'building.bungalow': 2,
};

/**
 * Add owned homes before scenery is scattered, then join each doorstep to town.
 *
 * Each spec is one person and their house, and EVERY LINE THEY SAY IS IN THE
 * SPEC: `hello` (the introduction, said once), `again` (what they are up to,
 * said on every later visit) and `greetings` (per-tier hellos, see
 * world/dialog.js). There is deliberately no template sentence stitched onto
 * any of them -- the lime burner and the hedge binder do not say the same
 * thing about their own front door.
 */
function addNeighbors(d, specs, connect) {
  return specs.map((spec) => {
    const house = d.placeNear(
      `home.${spec.id}`,
      spec.type,
      spec.tile[0],
      spec.tile[1],
      spec.allow ?? ['g'],
      spec.radius ?? 12,
      {
        label: `${spec.name}'s ${spec.home}`,
        interior: `worlds/interiors/home-${spec.id}.json`,
        owner: `folk.${spec.id}`,
      },
      spec.level ?? '0',
    );
    const doorstep = [house[0] + NEIGHBOR_DOOR_X[spec.type], house[1] + 3];
    connect(doorstep, spec, house);
    d.person({
      id: `folk.${spec.id}`,
      type: 'folk.villager',
      tile: doorstep,
      facing: 'south',
      props: { name: spec.name, title: spec.title, roam: 5, voice: spec.voice },
      dialog: {
        start: 'open',
        nodes: {
          open: {
            branch: [
              { when: { not: { flag: 'met' } }, to: 'hello' },
              { to: 'again' },
            ],
          },
          hello: { text: spec.hello, do: { set: 'met' } },
          again: { text: spec.again },
        },
        greetings: spec.greetings,
      },
    });
    return house;
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
  const home = addPlayerHome(d, 'home.player', cx - 10, cz + 4, ['g'], 10,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.nook', 'building.store', cx + 8, cz + 3, ['g'], 10,
    { label: 'General Store', interior: 'worlds/interiors/store-nook.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', cx + 15, cz + 3, ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  // The third shop, wished for beside the second so the three of them read as a
  // parade rather than as three errands in three directions. One interior file
  // serves every town's, exactly as Turnip & Timber's does.
  const clothier = d.placeNear('store.clothier', 'building.clothier', furniture[0] + 7, furniture[1], ['g'], 12,
    { label: 'Cuff & Collar', interior: 'worlds/interiors/store-clothier.json' }, '0');

  // THE NEIGHBOURS. Three houses round the plaza, each with somebody living in
  // it, and each interior a place you are not welcome until you have met them
  // (the private zone is declared in the interior file -- see
  // docs/WORLD_FORMAT.md). They are spread deliberately: the whole feature is
  // walking up to a stranger, so the three of them must not be findable from
  // one spot on the square.
  const cottage = d.placeNear('home.bramble', 'building.cottage', cx - 14, cz + 14, ['g'], 10,
    { label: "Bramble's Cottage", interior: 'worlds/interiors/home-bramble.json', owner: 'folk.bramble' }, '0');
  const cabin = d.placeNear('home.wren', 'building.cabin', cx + 4, cz + 19, ['g', 's'], 10,
    { label: "Wren's Cabin", interior: 'worlds/interiors/home-wren.json', owner: 'folk.wren' }, '0');
  const bungalow = d.placeNear('home.tobin', 'building.bungalow', cx + 15, cz + 8, ['g'], 10,
    { label: "Tobin's Bungalow", interior: 'worlds/interiors/home-tobin.json', owner: 'folk.tobin' }, '0');
  const hall = addTownHall(d, cx - 4, cz + 8, ['g', 'c'], 18);
  addMuseum(d, hall);
  addNeighbors(d, [
    {
      id: 'lark', name: 'Lark', title: 'Hedge Binder', home: 'Cabin', type: 'building.cabin',
      tile: [cx - 18, cz + 7], allow: ['g', 's'], voice: { pitch: 1.12, rate: 22, timbre: 'triangle' },
      hello: [
        'Lark. Hedge binder. Every hedge on the west side of this island wants to be a wood, and I am what talks it out of it, with a billhook.',
        'The cabin is mine, the one with the hazel rods leant against it. Knock, or call, or hum at the door -- anything but coming through it the way the hedge does.',
      ],
      again: 'The hedge is winning today, but only by inches.', road: [cx - 10, cz + 12],
      greetings: {
        acquaintance: [
          'Laid twelve yards this morning and the lane has widened by a foot. That is a good day in my trade.',
          'Hazel is up on the bluff and I am down here wanting it. Nothing in this trade is ever where the hedge is.',
          'Mind the billhook. It is leant on the gatepost because it is sulking, and so am I.',
          'Blackthorn got me across the knuckles. The hedge fights back. That is why it is a trade and not a hobby.',
        ],
        friend: [
          'You went along the west lane yesterday without getting scratched. I did that. You are welcome.',
          'Bramble wants his hedge laid and wants it to still flower. I have told him which he can have. He is thinking.',
          'You came past whistling. The birds in the hedge answered you. They do not answer me, and I house them.',
          'Grab a rod. No, that one. If you are going to stand there, you can hold something.',
        ],
        close: [
          'Good. Come and look at this pleach. Nobody else on the island would care.',
          'I left a gap in the hedge by the pond. It is for you. Nobody else uses that way.',
          'Walk the lane with me. It is a lane because of me, and today I want to show it off.',
        ],
      },
    },
    {
      id: 'juniper', name: 'Juniper', title: 'Orchard Keeper', home: 'Bungalow', type: 'building.bungalow',
      tile: [cx + 16, cz + 15], allow: ['g', 's'], voice: { pitch: 0.91, rate: 20, timbre: 'sine' },
      hello: [
        'Juniper. The young fruit trees east of the square are mine -- I planted them, I staked them, and now I stand about waiting for them to decide.',
        'The bungalow behind me is where I sleep when the trees let me. Say something at the door before you go through it. The trees get a warning, and so should I.',
      ],
      again: 'No blossom yet. It will come after warmer rain, or it will not, and I will be standing here either way.', road: [cx + 12, cz + 14],
      greetings: {
        acquaintance: [
          'Two of the young pears have put out leaf. The third is thinking about it. I do not rush a tree.',
          'I have been out with the stakes. The wind off the beach leans everything east and I lean it back.',
          'Wasps have found the windfalls. I am leaving them. Somebody should get the fruit and it was never going to be me this year.',
          'The graft on the end tree has taken. Do not touch it. Do not even look at it hard.',
        ],
        friend: [
          'You walked through the orchard yesterday and stepped over the roots. I noticed. The trees noticed.',
          'Bramble says a tree is a slow vegetable. I have not spoken to him since and it has been a restful week.',
          'I saved you an apple off the old tree by your house. Well. I saved it from Pim, which is the same thing.',
          'The blossom is coming. I can feel it in the bark. You may think that is nonsense and you may keep it to yourself.',
        ],
        close: [
          'Come and stand under the pear with me. It is doing nothing. It is lovely.',
          'First fruit off the young trees is yours. That was decided a while ago.',
          'Lean on the fence. It is what it is for. Talk or do not.',
        ],
      },
    },
  ], (door, spec) => d.pathL(...door, ...spec.road, { level: '0' }));

  // Approaches, drawn AFTER placement so a building that had to shuffle takes
  // its path with it. Doors face south, so the approach starts below them.
  d.pathL(home[0] + 1, home[1] + 3, cx - 1, cz + 11, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, cx, cz + 11, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, cx + 7, cz + 11, { level: '0' });
  d.pathL(clothier[0] + 2, clothier[1] + 4, cx + 11, cz + 11, { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, cx - 10, cz + 12, { level: '0' });
  d.pathL(cabin[0] + 2, cabin[1] + 3, cx + 1, cz + 20, { level: '0' });
  d.pathL(bungalow[0] + 2, bungalow[1] + 3, cx + 11, cz + 12, { level: '0' });
  d.pathL(hall[0] + 4, hall[1] + 6, cx, cz + 12, { level: '0' });
  d.pathL(lookout[0] + 2, lookout[1] + 2, cx - 1, cz - 13, { level: '1' });

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
      greetings: {
        acquaintance: [
          'Afternoon. Or it was when I started standing here. I have lost track and I am not going to go looking for it.',
          'The chickens have moved on to the fountain. I told them there was nothing in it. They did not believe me either.',
          'Nothing has happened on the square since you were last across it. I checked. I am still checking.',
          'Marla had her blinds down till ten this morning. I do not know what that means and I have decided to find out.',
        ],
        friend: [
          'There you go, walking about again. I would join you but somebody has to keep this bit of paving from wandering off.',
          'Tobin came out of his house today. Twice. I am telling you because you are the only one who would count that as news.',
          'I saved you a spot. It is this spot. There is not much of a view but I know all of it by heart.',
          'The cat sat on my foot for an hour. I let it. We are neither of us going anywhere.',
        ],
        close: [
          'You. Good. Stand there a minute and be nobody with me.',
          'Eleven years I have said that gate goes somewhere yet. You are the first thing to come through it that did.',
          'I have nothing to tell you and I am going to tell you all of it. It will take a while.',
        ],
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
      { at: 20, tile: [cottage[0] + 1, cottage[1] + 3], facing: 'north', activity: 'Inside for the night', available: false, inside: true },
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
      greetings: {
        acquaintance: [
          'Hold on, let me get my hands out of the soil before I say anything I would have to stand behind.',
          'Slugs have been at the lettuce. I have been at the slugs. We are about even, which is the usual arrangement.',
          'The frame wants airing and the rack wants turning, so you have caught me between two jobs that both think they are first.',
          'Mind where you put your feet. That row is sown, and it does not look like it yet.',
        ],
        friend: [
          'The beans have gone up a hand since Tuesday. I would take the credit but the rain was here first.',
          'Wren came past and told me the tide. I told her the beans. Neither of us wanted the news and both of us gave it.',
          'You have soil under your nails. Do not wash it off on my account, it means you have been somewhere real.',
          'Something new has come up in the shady corner. Do not tell Tobin, he will want to measure it.',
        ],
        close: [
          'Come round the back. The good stuff is round the back.',
          'I put a row in for you. Do not ask what. You will know when it comes up.',
          'Hands in. Go on. The bed by the glass wants thinning and I have been saving it.',
        ],
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
      { at: 19, tile: [cabin[0] + 2, cabin[1] + 3], facing: 'north', activity: 'Mending gear', available: false, inside: true },
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
      greetings: {
        acquaintance: [
          "Tide's on the turn. You have about an hour of dry sand and then you have not.",
          "Line's been out since first light. Nothing on it yet, and nothing is a perfectly good answer from the sea.",
          'Wind has gone round to the east. That is not a complaint, that is a forecast, and it is free.',
          'Shells are thin on the south beach this week. The sea is keeping them. It does that.',
        ],
        friend: [
          'You walk that sand like you were born on it. You were not. But you are learning where it is soft.',
          'Bramble told me the tide this morning. Told me. I let him, because he looked pleased.',
          'The boat is still upside down. Do not look at her like that, she can tell.',
          'Do not tread on the net. It is drying, and it is the only thing I own that is.',
        ],
        close: [
          "Come down to the water's edge. The sea is doing something and I want somebody to see it with me.",
          'You were out on the water yesterday. I saw. You held her nose into it. Good.',
          'Mug on the ledge. Not the one by the bait barrel. I should not have to say that but I have said it before.',
        ],
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
      { at: 21, tile: [bungalow[0] + 2, bungalow[1] + 3], facing: 'north', activity: 'Workshop closed', available: false, inside: true },
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
      greetings: {
        acquaintance: [
          'Hm. One moment. There is a spring in this and if I look up it will leave.',
          'A hinge from the store, a pan with a hole and a chair nobody will own up to. That is the morning\'s pile.',
          'I have been out looking for straight timber. There is none. Trees here grow the way they like, and I respect it, and it is a nuisance.',
          'You are standing where I put the solder. It is not on you. I checked.',
        ],
        friend: [
          'The orrery has a tick in it. It did not have one last week. I am choosing to think of it as a voice.',
          'Bramble brought me a trowel with the handle off and stood over me while I fixed it. Would not sit. There is nowhere to sit.',
          'You have the look of somebody carrying something broken. If you are, I have the afternoon.',
          'Pim says you are round here more than I leave the house. That is true and it is not a high bar.',
        ],
        close: [
          'Sit on the crate. The heavy one. You know which.',
          'I put a second chair in the back room. It is not for anyone. It is just there now.',
          "Hm. Good, it's you. Hold this end and do not let go when it gets warm.",
        ],
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
  const home = addPlayerHome(d, 'home.holler', Math.round(creek(sites.home)) - 8, sites.home, ['g'], 11,
    { label: 'The Old Place', interior: 'worlds/interiors/home-holler.json', playerHome: true }, '0');
  const store = d.placeNear('store.branch', 'building.store', Math.round(creek(sites.store)) + 6, sites.store, ['g'], 11,
    { label: 'Branch Store', interior: 'worlds/interiors/store-branch.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const clothier = d.placeNear('store.clothier', 'building.clothier', furniture[0] + 7, furniture[1], ['g'], 12,
    { label: 'Cuff & Collar', interior: 'worlds/interiors/store-clothier.json' }, '0');
  const hall = addTownHall(d, Math.round(creek(spawnRow)) - 11, spawnRow, ['g', 'c'], 24);
  addMuseum(d, hall);
  addNeighbors(d, [
    {
      id: 'alder', name: 'Alder', title: 'Creek Reader', home: 'Cottage', type: 'building.cottage',
      tile: [Math.round(creek(18)) - 8, 18], voice: { pitch: 0.8, rate: 19, timbre: 'sawtooth' },
      hello: [
        'Alder. I read the creek. What it drops on the gravel bar tells you what the rain did up in the head before the rain has finished doing it.',
        'The cottage behind me is mine. It is the last one before the holler shuts. Give me a word at the door first -- the creek never does, and I am tired of being surprised.',
      ],
      again: 'Water is low. The stones are saying so plainly.',
      greetings: {
        acquaintance: [
          'Fresh sand on the upper bar. Rain in the head last night, and none down here. The creek tells it before anyone.',
          'The top ford is running higher than it looks. I have told Hollis. He has told the ford.',
          'Crows are down on the gravel this morning. Something washed out of the head. I have not gone to see what.',
          'The water is the colour of tea. That is the pines. It is not a bad sign, it is just what it is.',
        ],
        friend: [
          'You crossed at the top ford yesterday. I saw the prints. You went in at the shallow side, which nobody does the first year.',
          'Fern wants the creek to bring her willow. I want it to bring me sand. It brings us both leaves and thinks that is funny.',
          'I have been up the head as far as it goes. There is nothing. There is a spring in a rock and the whole holler comes out of it.',
          'Come down on the bar a minute. There is a stone I want to show you that was not here last week.',
        ],
        close: [
          'Wet feet. Good. You have been in it.',
          'Nothing moved on the bar overnight. I sat up for it. I am telling you because you are the only one who would not laugh.',
          'Come to the water. I will show you what it is saying today.',
        ],
      },
    },
    {
      id: 'fern', name: 'Fern', title: 'Basket Maker', home: 'Cabin', type: 'building.cabin',
      tile: [Math.round(creek(50)) - 9, 50], voice: { pitch: 1.17, rate: 23, timbre: 'triangle' },
      hello: [
        'Fern. Baskets. Every one in this holler that holds anything worth holding started as a wet willow switch in my yard, and I bent it.',
        'That cabin behind me is where I sleep among the rods. The door is not latched, but I would like to hear you at it before I see you through it.',
      ],
      again: 'The willow is soaking. Tomorrow it will bend without complaint.',
      greetings: {
        acquaintance: [
          'Willow is cut and in the trough. Three days in the creek and it will go round a corner without splitting. Less and it argues.',
          'I have a basket on the go for the store. It is going to be square. The willow does not want to be square.',
          'Ducks have been in my soaking trough again. I do not mind. The willow does not mind. The ducks are pleased.',
          'Fingers are raw today. That is the trade. You cannot bind a rod with gloves on and you cannot bind it forever without.',
        ],
        friend: [
          'You brought me sticks last time and one of them was willow. You did not know that. I did.',
          'Alder came down to tell me the creek was low. I could see it was low. I let him tell me, he needed to.',
          'Hollis wants a basket for the ford stones. A basket. For stones. I am making it because I like a challenge and I like Hollis.',
          'Stand on the dry side of the yard, by the bundle. Do not mind the smell. It is the creek, on purpose.',
        ],
        close: [
          'I have started one for you. It is small and it is wrong and I am starting it again.',
          'Hands. Give me your hands a moment. No -- I want to see if they would do this. They would.',
          'Come round the yard. You can hold the rod ends while I bind and neither of us has to say anything.',
        ],
      },
    },
    {
      id: 'hollis', name: 'Hollis', title: 'Ford Tender', home: 'Bungalow', type: 'building.bungalow',
      tile: [Math.round(creek(72)) - 9, 72], voice: { pitch: 0.96, rate: 25, timbre: 'square' },
      hello: [
        'Hollis. I tend the fords. Every hard rain the creek moves the stones, and every morning after, I put them back where a foot expects them.',
        'That bungalow is mine, the last house before the mouth. Stop at the door and say so. A ford you can just walk over. A house you cannot, not mine.',
      ],
      again: 'The crossing is sound enough if you place your feet.',
      greetings: {
        acquaintance: [
          'Lower ford is set. Moved four stones this morning and the fourth was the one that mattered. It always is.',
          'Rain up the head last night. Alder will say so with more words. The ford said so with a stone gone.',
          'A cart went over the bottom crossing and rocked the big flat one loose. I have had words with the cart.',
          'Water is over the tops of the ford stones today. Not by much. Enough that I am standing here rather than there.',
        ],
        friend: [
          'You crossed dry yesterday. Both feet. I do not get thanked for that and I do not need it, but I saw.',
          'Fern is making me a basket for stones. I did not ask her to stop and I did not ask her to start. That is Fern.',
          'There is a cart-track by the bottom ford that does not go on to the gate. I have been looking at it all morning.',
          'Stand on the bank with me. The ford will not move while we are watching it. It waits until I am indoors.',
        ],
        close: [
          'Right. You are here. Help me lift the flat one.',
          'The ford held through last night\'s rain. First time in nine years. I wanted to tell somebody and you were the somebody.',
          'Boots off if you are coming in. Not for the floor. For the feet.',
        ],
      },
    },
  ], (door) => d.pathL(...door, Math.round(creek(door[1] + 1)) + 4, door[1] + 1, { level: '0' }));

  // Each door out to the road. The road is the only through-line in a holler,
  // so everything hangs off it.
  d.pathL(home[0] + 1, home[1] + 3, Math.round(creek(home[1] + 4)) + 4, home[1] + 4, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, Math.round(creek(store[1] + 5)) + 4, store[1] + 5, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, Math.round(creek(furniture[1] + 5)) + 4, furniture[1] + 5, { level: '0' });
  d.pathL(clothier[0] + 2, clothier[1] + 4, Math.round(creek(clothier[1] + 5)) + 4, clothier[1] + 5, { level: '0' });
  d.pathL(hall[0] + 4, hall[1] + 6, Math.round(creek(hall[1] + 7)) + 4, hall[1] + 7, { level: '0' });
  d.pathL(gate[0] + 2, gate[1] + 2, Math.round(creek(gate[1] + 3)) + 4, gate[1] + 3, { level: '0' });

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
  const home = addPlayerHome(d, 'home.player', cx - 6, cz + out(0.54), ['g'], 10,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.driftwood', 'building.store', cx + out(0.54), cz + 2, ['g'], 10,
    { label: 'Driftwood Stores', interior: 'worlds/interiors/store-driftwood.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  // Not east of the furniture shop, the way every other town puts it: east of
  // there is the outer beach and then the sea. On a ring, "beside the other
  // shops" has to mean further round the ring, so the clothier takes the arc
  // north of the middle -- still on the road, still a walk rather than an
  // expedition, and the only quarter of the loop nothing else is standing in.
  const clothier = d.placeNear('store.clothier', 'building.clothier', cx + 3, cz - out(0.5), ['g'], 12,
    { label: 'Cuff & Collar', interior: 'worlds/interiors/store-clothier.json' }, '0');
  const cottage = d.placeNear('home.marnie', 'building.cottage', cx - out(0.57), cz - 3, ['g'], 10,
    { label: "Marnie's Cottage", interior: 'worlds/interiors/home-marnie.json', owner: 'folk.marnie' }, '0');
  const hall = addTownHall(d, cx + out(0.35), cz + out(0.22), ['g', 'c'], 22);
  addMuseum(d, hall);
  addNeighbors(d, [
    {
      id: 'coral', name: 'Coral', title: 'Net Mender', home: 'Cottage', type: 'building.cottage',
      tile: [cx - out(0.42), cz - out(0.42)], allow: ['g', 's'], voice: { pitch: 1.15, rate: 24, timbre: 'triangle' },
      hello: [
        'Coral. I mend nets. The sea tears them, the fishers bring them to me, and I sit on that step and argue the holes closed one knot at a time.',
        'The cottage behind me is mine, and so is the net across the doorway. Speak up before you push through it. It is not there to keep you out, it is there so I hear you coming.',
      ],
      again: "This knot will hold. The next one is the sea's concern.",
      greetings: {
        acquaintance: [
          "Marnie's cast net came in with a hole the size of a dog. I asked what did it. She says the sea. The sea does not bite like that.",
          'Twine is the wrong colour today. The sea does not care and the fish do not care and I will finish it anyway.',
          'Sat on the step since first light, mending. Cold hands are fine. Cold hands and wet twine is the trade.',
          'Otto brought me a net he found on the far sand. Not one of ours. I have mended it anyway. It seemed rude not to.',
        ],
        friend: [
          'You walked past yesterday and did not stand on the net laid out on the grass. Not many people manage that.',
          'Marnie watches me from her window and I mend her nets. That is a fair trade and neither of us has ever said so.',
          'There is a knot I cannot get right. I have been at it since Tuesday. Do not look at it. It knows.',
          'I have a shuttle spare. It is on the step. You could learn. I am not saying you should. I am saying it is on the step.',
        ],
        close: [
          'Come and sit on the step. There is room now. I moved the twine.',
          'You have a hole in your sleeve. Give it here. I have the needle threaded anyway.',
          "Marnie's net is done, so I have nothing in my hands. Stay while that lasts.",
        ],
      },
    },
    {
      id: 'selkie', name: 'Selkie', title: 'Shell Lime Burner', home: 'Cabin', type: 'building.cabin',
      tile: [cx + out(0.40), cz + out(0.42)], allow: ['g', 's'], voice: { pitch: 0.87, rate: 21, timbre: 'sine' },
      hello: [
        'Selkie. I burn shell. Broken ones, off the tide line, into the kiln and out the other side as lime -- and every white wall on this ring is my doing.',
        'The cabin behind me is mine, and the kiln beside it is hotter than it looks. Sing out at the door before you come in. I hear better than I see, once the kiln is lit.',
      ],
      again: 'Stand upwind of the kiln. That advice is free.',
      greetings: {
        acquaintance: [
          'Kiln is lit. You will have smelt it round at the store. Everybody does. Nobody complains, because they all want white walls.',
          'Crows walk the tide line ahead of me and take the shells I want. We have not come to an arrangement.',
          "Limewashed the store's south wall this morning. Watch your sleeve on it till tomorrow. It comes off on everything.",
          'The kiln has gone cold and I am sorting the burnt from the unburnt. It is a job for fingers and I am short of fingers.',
        ],
        friend: [
          'You went past the kiln on the downwind side yesterday. I did tell you. Your coat has told you since.',
          'Otto wants his landing posts limed. Otto wants a great many things and says so slowly. I will do them.',
          'Marnie says she can see my smoke from her chair. She can see everything from that chair. I lit it early to give her something.',
          'Bring me shells if you find them. Broken ones. Whole ones go to the post at the landing, and Otto counts.',
        ],
        close: [
          'Come by the kiln. It is banked. You will be warm and I will be quiet.',
          'I have a pot of wash put by for your walls. Whenever you want. It does not go off.',
          'Hands black again. I would take yours but you would not thank me. Stay a minute anyway.',
        ],
      },
    },
  ], (door) => {
    const a = Math.atan2(door[1] - cz, door[0] - cx);
    d.pathL(...door, Math.round(cx + Math.cos(a) * ringR), Math.round(cz + Math.sin(a) * ringR), { level: '0' });
  });

  // Doors face south, so every approach starts below its door and runs to the
  // nearest point of the ring road.
  d.pathL(home[0] + 1, home[1] + 3, cx - 1, cz + out(0.54), { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, cx + out(0.5), cz + 7, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, cx + out(0.5), cz + 9, { level: '0' });
  d.pathL(clothier[0] + 2, clothier[1] + 4, cx + 3, cz - out(0.44), { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, cx - out(0.5), cz + 3, { level: '0' });
  d.pathL(hall[0] + 4, hall[1] + 6, cx + out(0.38), cz + out(0.28), { level: '0' });
  d.pathL(landing[0] + 2, landing[1] + 2, cx, cz + out(0.6), { level: '0' });
  d.pathL(lookout[0] + 2, lookout[1] + 2, cx - 1, cz + dune[1] + 2, { level: '1' });

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
      greetings: {
        acquaintance: [
          'Watch your step. That plank is sound and the one next to it is having a think.',
          'Rope wants coiling and the hull wants patching. The hull is louder. I am doing the rope.',
          'Tide has brought in a bit of somebody else\'s boat. Not mine. I have counted mine.',
          'The post at the head of the landing has a new shell on it. Not from me. I like not knowing whose.',
        ],
        friend: [
          'Marnie says I tied a granny knot on the mooring line last Thursday. It was Wednesday. I am not going to correct her.',
          'You went round the ring the other way this time. I saw you come in from the east. It is not shorter. I did tell you.',
          'There is a hull under that tarpaulin I said I had finished. Do not lift it. I have not.',
          'Tar on my hands, so I will not shake yours. You are welcome to the smell, though. It is the smell of things not sinking.',
        ],
        close: [
          'Come and hold this. No, it is not going anywhere. That is the point of holding it.',
          'I have kept this landing dry for fourteen years and this is the first year I have had somebody to say that to.',
          'Sit on the bollard. The rope will wait. It is very good at waiting.',
        ],
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
      greetings: {
        acquaintance: [
          'Sea side this morning. The lagoon had nothing to say and the sea had too much, as usual.',
          'I saw you come round the north arm. Through the glass. Do not look like that, it is what the glass is for.',
          'There is a new thing on the shelf from the far sand. A bottle. Nothing in it. There never is.',
          'Wind off the lagoon and spray off the sea, both at once. Ten steps apart. I have told you about the ten steps.',
        ],
        friend: [
          'Otto has been at that same hull for a week. I have watched him from the chair. It is better than the sea some days.',
          'I saw you skip a stone across the lagoon. Six. From here it looked like six. If it was seven, tell me and I will believe you.',
          'That boat on the far side has moved. Nobody has mentioned it. You are not going to be the one to make me.',
          'You are the only person on this ring who walks the whole of it without complaining. I count that as a character.',
        ],
        close: [
          'The glass is pointed at nothing this morning. It is your turn to tell me something.',
          'The far sand gave up a good one for you. Top shelf. Do not ask which. You will know it.',
          'I was going to walk out to the sea. I will wait, if you are coming.',
        ],
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
      greetings: {
        acquaintance: [
          'Up again. The dune grass has held through the wind, which is all I ask of it and all it gives.',
          'There is a thing growing by the ramp I did not plant. Salt-sown. I am watching it and it is watching the sea.',
          'Rabbits have been at the sea holly. They are welcome. It is the only thing up here with an opinion about them.',
          'You can see the weather coming for an hour before it gets here. I have had my hour, and it is coming.',
        ],
        friend: [
          "I went down for flour and came back up in half the time. I am not telling you why. It was Otto's rope talk.",
          'The samphire is up. Do not tell Marnie, she will send somebody for it and it will be you.',
          'You stand at the edge the way I did the first year. Looking for the shape of it. It does not get any less round.',
          'Lie back in the grass if you like. The sand is warm on the south face and cold on the north, and that is the whole of the dune.',
        ],
        close: [
          'I left the view alone for you. Same as ever. Take your time with it.',
          'Wind has dropped. That is the sound of nothing, up here, and I wanted you to hear it.',
          'The salt bush by the ramp has flowered. I think it did it because you kept walking past.',
        ],
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
  const home = addPlayerHome(d, 'home.player', road - 9, sites.home, ['g'], 11,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.wether', 'building.store', road + 4, sites.store, ['g'], 11,
    { label: 'The Wether', interior: 'worlds/interiors/store-wether.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const clothier = d.placeNear('store.clothier', 'building.clothier', furniture[0] + 7, furniture[1], ['g'], 12,
    { label: 'Cuff & Collar', interior: 'worlds/interiors/store-clothier.json' }, '0');
  const croft = d.placeNear('home.nan', 'building.cottage', road - 8, 24, ['g'], 11,
    { label: "Nan's Croft", interior: 'worlds/interiors/home-nan.json', owner: 'folk.nan' }, '0');
  const hall = addTownHall(d, road - 13, spawnRow, ['g', 'c'], 24);
  addMuseum(d, hall);
  addNeighbors(d, [
    {
      id: 'heather', name: 'Heather', title: 'Wool Carder', home: 'Cottage', type: 'building.cottage',
      tile: [road + 6, 17], voice: { pitch: 1.08, rate: 21, timbre: 'triangle' },
      hello: [
        "Heather. I card wool. It comes down off the benches full of burrs and weather, and it leaves my yard clean enough for Nan's loom to bother with.",
        'That cottage behind me is mine and the yard is full of fleece. Give the door a word before you open it. The wind gets in without asking, and I would like one thing in this gap that does not.',
      ],
      again: 'Clean fleece first, clever work second.',
      greetings: {
        acquaintance: [
          "Four fleeces in from Nan's flock and every one of them has been through a thorn. I am pulling the bench out of them a burr at a time.",
          'Cards are set and the wind is down. That is the only weather in this trade worth a word.',
          'Thistle seed in the fleece again. It floats in off the benches and I comb it out and it floats back. We keep each other in work.',
          'There is grease on my hands and it is not coming off. It is lanolin. It is the best thing about the job and the worst.',
        ],
        friend: [
          'Nan says my rolags are too tight. Nan says that every year and every year she weaves them. I have stopped answering.',
          'You came down the road with thistledown in your hair yesterday. I nearly carded you.',
          'Gale wants a fleece for his bench. A fleece. For sitting on. Stone-cold and he calls it a bench. I am sending him one.',
          'Dell counted you in at eight this morning. He tells me. I did not ask. That is what living by the gate is.',
        ],
        close: [
          'Come in the yard. Mind where you tread, it is all fleece, and it is soft on purpose.',
          'Feel that. That is what a bench-full of thorns comes out as, if you are patient.',
          'I have kept the softest of the clip back. Not for Nan. I am telling you so you know why.',
        ],
      },
    },
    {
      id: 'gale', name: 'Gale', title: 'Milestone Cutter', home: 'Cabin', type: 'building.cabin',
      tile: [road - 10, 42], voice: { pitch: 0.78, rate: 20, timbre: 'square' },
      hello: [
        'Gale. I cut milestones. Every marker between the two mouths of this gap has my chisel on it, and every one of them tells the truth, more or less.',
        'The cabin behind me is mine, the one with the chippings up to the door. Stop at the sill and speak. A stone stands where it is put until it is moved, and so should a visitor.',
      ],
      again: 'The next marker says twelve. It does not say twelve what.',
      greetings: {
        acquaintance: [
          'Fourteen letters cut and the chisel wants an edge. I would rather cut a stone than sharpen one, and that is my whole character.',
          'There is a new marker going in at the south mouth. It will say six. Six is a lie, but a kind one.',
          'Grit in my eye. Chippings. Do not look at me. I will look at you when it stops watering.',
          'Stone from the west bench splits clean and stone from the east does not. That is all anyone needs to know about this gap.',
        ],
        friend: [
          'Rook asked me for a stone with nothing cut on it. I gave him one. Easiest job of the year and the hardest to charge for.',
          'You read the marker by the tarn out loud as you passed. I heard you from here. Nobody reads them. They just believe them.',
          'Heather is sending me a fleece to sit on. I did not ask. I am going to sit on it and say nothing, which is the same as thanks.',
          'Dell says I cut the numbers too small for a man on a cart to read. Dell has never been on a cart. I have told him so.',
        ],
        close: [
          'Your name is cut in the offcut behind the door. I had the letters left over. It does not mean anything. It is just there.',
          'That block by the door was a milestone. Now it is a seat. Things change what they are for.',
          'Hands. Look. Chipped to the bone and I would not swap them. You are one of about three people I would tell that.',
        ],
      },
    },
    {
      id: 'briar', name: 'Briar', title: 'Goatherd', home: 'Bungalow', type: 'building.bungalow',
      tile: [road + 6, 68], voice: { pitch: 0.99, rate: 24, timbre: 'sawtooth' },
      hello: [
        'Briar. Goatherd. The goats are on the east bench when they are anywhere, and they know every path through this gap better than the road does.',
        'The bungalow behind me is mine, and the goats think it is theirs. Give a shout at the door before you go in. If I am not there, one of them is, and it will not be pleased.',
      ],
      again: 'If one follows you, it was already planning to.',
      greetings: {
        acquaintance: [
          'Lost one up the east bench this morning. Found her on the roof of the store. Do not ask how. I have stopped asking.',
          'The billy has eaten the gate rope again. I have tied a new one. He has looked at it.',
          'Three kids born on the bench overnight. All standing. Goats do not waste time on being born.',
          'Wind up the gap and the goats have gone to ground under the thorn. They are wiser than me and they know it.',
        ],
        friend: [
          'One of them followed you down the road yesterday. I let her. She came back with an opinion about you and it was not bad.',
          'Nan says a goat ate her washing. It did not. It ate half of it. I am being accurate.',
          'Dell counts the goats through the gate. Every time. There are seven. He counts them every time.',
          'You smell of sheep. I am not judging. I am saying the goats will, and they judge.',
        ],
        close: [
          'Come up the bench with me. The kids are out and I want you to see them before they get sensible.',
          'The old nanny lay down by your feet last time. She does not do that. I have thought about it since.',
          'Stand still. The billy is behind you, and he likes you, which is worse.',
        ],
      },
    },
  ], (door) => d.pathL(...door, road, door[1] + 1, { level: '0' }));

  d.pathL(home[0] + 1, home[1] + 3, road, home[1] + 4, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, road, store[1] + 5, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, road, furniture[1] + 5, { level: '0' });
  d.pathL(clothier[0] + 2, clothier[1] + 4, road, clothier[1] + 5, { level: '0' });
  d.pathL(croft[0] + 1, croft[1] + 3, road, croft[1] + 4, { level: '0' });
  d.pathL(hall[0] + 4, hall[1] + 6, road, hall[1] + 7, { level: '0' });
  d.pathL(north[0] + 2, north[1] + 2, road, north[1] + 3, { level: '0' });
  d.pathL(south[0] + 2, south[1] + 2, road, south[1] + 3, { level: '0' });

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
      greetings: {
        acquaintance: [
          'Stopping again. I have that down. I do not need to write it.',
          'Two carts through this morning, one each way. Neither of them stopped. That is a normal day and I am reporting it as one.',
          'Gale of wind down from the top. Not Gale the man. He is where he always is, hitting a stone.',
          'Nobody through since dawn but a dog, and the dog did not stop to give its name.',
        ],
        friend: [
          'You went up the west trail yesterday and came down the east. I am not asking why. I am saying I saw both ends of it.',
          'Nan asked after you. I told her the time you came through, to the minute. She did not need it. She had it.',
          'A man came up the road this morning and I did not know him. Then he turned out to be Rook, with a hat on. I am not over it.',
          'The gate has stood here forty years. I have leant on it for most of them. Lean on it. It does not mind.',
        ],
        close: [
          'There you are. I had you down for about now.',
          'Nobody through all day. Just the wind, and you. That is my kind of day.',
          'Stand this side of the gate with me. It is the better side. I have checked.',
        ],
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
      greetings: {
        acquaintance: [
          'Sheep are all where I left them, and so am I. That is a morning, duck.',
          'There is one ewe up the bench who will not come down for anybody. She is the one I like best.',
          'Loom has had four rows off me this week. Four. I am not proud of that and I am not sorry either.',
          'The fire has not gone out since the wet year, and it is not going out today. That is the one thing I promise this gap.',
        ],
        friend: [
          'You came down the west trail without spooking the flock. I saw from the door. Not many manage it and none of them are Dell.',
          'Somebody has been throwing my shuttle. The number has gone up by three. I said I would know and I know.',
          'Thistledown is up on the bench and I want it for cushions. Dell fetches it if I pay. You might fetch it if I ask.',
          'I made too much bread. I always make too much bread. It is a habit from when there was somebody to eat the other half.',
        ],
        close: [
          'In you come, duck. The chair is warm. I sat in it so it would be.',
          'My sister came up and left before you got here. You are the better visit. Do not tell her.',
          'There is a bit of blanket done. I want you to feel it. Not to look at it. To feel it.',
        ],
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
      greetings: {
        acquaintance: [
          'Quietly. It is a slow morning and I want to keep it.',
          'Nothing on the line. Nothing off the bottom. That is as it should be.',
          'The rain ring on the tarn this morning was the first of the year. You missed it. Most do.',
          'Rabbits at the rim. They are not afraid of me. I sit still enough to be a rock.',
        ],
        friend: [
          'You sat here yesterday without saying anything for a good while. I have been thinking about it since. It was well done.',
          'Nan sent bread up with you last time. Eat the next one yourself. She feeds me in town and it takes an hour.',
          'Something rose out by the far rim at dusk. Bigger than I thought. I have not told anyone else and I am not going to.',
          'The flat stone you skimmed went eight. Eight. I have not managed eight in twenty years.',
        ],
        close: [
          'Sit. The other side of the rod, where the sun is. I kept it for you.',
          'It is going to rain. Stay for it. Nobody ever stays for it.',
          'Ah. Not a word. I will tell you if it moves.',
        ],
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
  const home = addPlayerHome(d, 'home.player', cx - 12, cz + 1, ['g'], 11,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.slickrock', 'building.store', cx + 9, cz + 2, ['g', 's'], 11,
    { label: 'Slickrock Post', interior: 'worlds/interiors/store-slickrock.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g', 's'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const clothier = d.placeNear('store.clothier', 'building.clothier', furniture[0] + 7, furniture[1], ['g', 's'], 12,
    { label: 'Cuff & Collar', interior: 'worlds/interiors/store-clothier.json' }, '0');
  const cottage = d.placeNear('home.pike', 'building.cottage', cx - 16, cz + 13, ['g', 's'], 11,
    { label: "Pike's Place", interior: 'worlds/interiors/home-pike.json', owner: 'folk.pike' }, '0');
  const hall = addTownHall(d, cx - 4, cz + 12, ['g', 's', 'c'], 20);
  addMuseum(d, hall);
  addNeighbors(d, [
    {
      id: 'mesa', name: 'Mesa', title: 'Rain Jar Keeper', home: 'Cottage', type: 'building.cottage',
      tile: [cx - 19, cz + 2], allow: ['g', 's'], voice: { pitch: 1.04, rate: 22, timbre: 'sine' },
      hello: [
        'Mesa. I keep rain in jars, because the sky seldom keeps an appointment and a jar always does.',
        'The cottage behind me is where the jars live. Knock first; a jar that has been startled has usually been dropped.',
      ],
      again: 'Three jars full since you were last by. That counts as a wet season here.', road: [cx - 12, cz + 8],
      greetings: {
        acquaintance: [
          'Dry morning. They mostly are. I have been out counting the jars again, which does not change the number.',
          'If you hear thunder, tell me before you tell anyone. I have lids to get off.',
          'Wash is sand today, same as yesterday. I keep looking anyway. It is a kind of exercise.',
          'The goats have found the overflow trough. I am not going to fight a goat over a cupful.',
        ],
        friend: [
          'Bly counted rain for the week and I set out every jar I own. Bly was wrong. I am not speaking to the weather.',
          'Sora keeps asking for a jar of the clean stuff for her still. I keep saying no and she keeps asking nicer.',
          [
            'Somebody left a lid off overnight. A quarter of a jar gone to the air.',
            'It was me. I am telling you so I do not have to tell anyone else.',
          ],
          'You are the only one who looks at the sky when I do. Everyone else looks at me.',
        ],
        close: [
          'Come and sit by the full one. It is cool in a way nothing else on this rock is.',
          'Jar six has a crack. I have not decided to be upset about it. Help me not decide.',
          'If it ever rains properly I want you standing here when it does. That is all.',
        ],
      },
    },
    {
      id: 'flint', name: 'Flint', title: 'Slickrock Polisher', home: 'Cabin', type: 'building.cabin',
      tile: [cx + 16, cz + 15], allow: ['g', 's'], voice: { pitch: 0.76, rate: 19, timbre: 'square' },
      hello: [
        'Flint. I polish slickrock. Rub it long enough and it gives up a shine that looks like water and is not.',
        'The cabin is mine and its polished floor is the point of it. Shout from the step before you come in; one boot of grit undoes a week.',
      ],
      again: 'That shine on the step is a month of my arm. It is not wet, whatever it looks like.', road: [cx + 10, cz + 10],
      greetings: {
        acquaintance: [
          'Rubbing down a slab for the town hall step. They want it to look wet. They will get what the rock gives.',
          'My hands are grey to the wrist and it does not wash off. Do not shake them if you value your sleeves.',
          'There is a piece on the bench that took the sun this morning like a pool. I have stopped work to look at it.',
          'Rim is loose again on this side. Any stone you find lying about, that is where it came from.',
        ],
        friend: [
          'Bly wants a cairn stone polished. I said a cairn is meant to be seen from a distance, not admired up close. Bly went quiet.',
          'Sora says the shine smells of juniper because I use her oil for the finish. I say it smells of work. We are both right.',
          [
            'Somebody took a polished offcut off my step last week. Did not ask.',
            'If it was you, it was a good choice. If it was a goat, I want it back.',
          ],
          'You walked round the floor and not across it. That is the first thing I look for in a person.',
        ],
        close: [
          'Come in and take the good chair. It is the only thing in there I have not polished.',
          'Finished the slab. It is a mirror with a grain in it and I wanted you to see it before the grit does.',
          'Hands are too sore to work today. Sit on the step with me and we will watch the stone do nothing.',
        ],
      },
    },
    {
      id: 'sora', name: 'Sora', title: 'Juniper Distiller', home: 'Bungalow', type: 'building.bungalow',
      tile: [cx + 15, cz - 1], allow: ['g', 's'], voice: { pitch: 1.21, rate: 25, timbre: 'triangle' },
      hello: [
        'Sora. I distil the juniper that clings to the rim. It comes out as an oil, bitter enough to cure most things and to teach the rest.',
        'The bungalow behind me is where the still lives. Call out before you come in; it is hot in there and the stuff in the pot does not like surprises.',
      ],
      again: 'A drop is medicine. Two drops are a lesson. I keep saying it and people keep learning.', road: [cx + 8, cz + 8],
      greetings: {
        acquaintance: [
          'The still has been going since first light. If you smell it on me, that is why. It gets in the hair.',
          'Cut a bough off the crooked tree on the north rim this morning. The wind has been shaping it for me for years.',
          'Mind the crows. They like the mash and they do not like sharing the yard.',
          'Grey haze off the basin again. Good for nothing but the juniper, which likes to be left alone.',
        ],
        friend: [
          'Flint has taken to using my oil on his floor. It shines beautifully and the whole cabin smells like a cough cure.',
          'Mesa will not sell me a clean jar of rain for the still. I have asked six ways. I am working on a seventh.',
          [
            'Somebody bought a whole bottle last week and put two drops in a stew.',
            'They came back for an explanation. I gave them a bit of bread and no refund.',
          ],
          'You do not screw your face up when you smell the yard any more. It took Pike a decade.',
        ],
        close: [
          'Sit in the yard. The still is talking to itself and I like an ear that is not mine.',
          'I kept back the first cut of the year. It is the clean one. It is yours, and do not thank me.',
          'Slow day, fire low. Stop a while and help me not work.',
        ],
      },
    },
  ], (door, spec) => d.pathL(...door, ...spec.road, { level: '0' }));

  d.pathL(home[0] + 1, home[1] + 3, cx - 1, cz + 8, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, cx, cz + 8, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, cx, cz + 10, { level: '0' });
  d.pathL(clothier[0] + 2, clothier[1] + 4, cx, cz + 12, { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, cx - 1, cz + 12, { level: '0' });
  d.pathL(hall[0] + 4, hall[1] + 6, cx, cz + 10, { level: '0' });
  d.pathL(head[0] + 2, head[1] + 2, cx - 1, cz - 13, { level: '1' });
  d.pathL(lip[0] + 2, lip[1] + 2, cx - 1, cz + 21, { level: '0' });

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
      greetings: {
        acquaintance: [
          'Cloud in the west. Two days off, maybe three. You can put your coat away for now.',
          'Stand where the rock is dry. The lip crumbles a little every year and I would rather it did not take you.',
          'Came to look down, did you. Most do the once and then they look anywhere else.',
          'Two crows and no wind since sunrise. I have written it down. It will mean something later or it will not.',
        ],
        friend: [
          'Somebody knocked my cairn over in the night. Goats, I think, though a goat has never once admitted anything.',
          'You have a way of standing at the lip that does not make me nervous. It took Wend twenty years to learn that.',
          [
            'I told Pike there was rain coming and he laughed and oiled every hinge in the house.',
            'It rained. He has not said a word about it and neither have I.',
          ],
          'The shadow of the rock is on the far side of the basin already. I lose the whole afternoon watching it cross.',
        ],
        close: [
          'Sit down a while. The edge keeps, and so does the weather, mostly.',
          'I saved you the flat stone. It holds the sun until after dark.',
          'Quiet day. Nothing coming. I do not get many and I am glad it is you I get to waste one on.',
        ],
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
      greetings: {
        acquaintance: [
          'Mind the goats on the apron. They eat anything I plant and they look at me while they do it.',
          'You made the cut again. It is no shorter the second time, whatever people say.',
          'Hauled water from the seep this morning. Two buckets up, and about one and a half arrived.',
          'The wind has been at the beds all night. Anything still standing has earned its place.',
        ],
        friend: [
          'Pike says gardening up here is a hobby with a spade. He can say that when his squash come in.',
          'I had a whole row of something green yesterday. Today I have a whole row of goat. You are better company.',
          [
            'Bly sent word there was rain coming. I put every pot out on the apron.',
            'Nothing yet. If it comes I will look wise, and if not I will bring the pots back in after dark.',
          ],
          'You are the only one who climbs up here and does not ask why I bother. I have noticed.',
        ],
        close: [
          'There you are. I kept a bucket back so you would not have to fetch.',
          'Rock holds the night cold a bit longer this week. Come and see what it has done for the cracks.',
          'Nothing to show you today. Stand out of the wind with me anyway.',
        ],
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
      greetings: {
        acquaintance: [
          'Grit in the hinge again. Every door on this rock sings the same note and I know all the words.',
          'Boots. Stamp them there, not here. I am not saying it twice.',
          'Axle off the store cart on the bench. Third one this year. The road wants the blame and I want the road.',
          'You have sand on your collar. Everybody does. It is how I know you have been outside.',
        ],
        friend: [
          'Wend brought me a trowel with the handle gone. I asked what it did. She said it grew things. It does not, now.',
          'Slow week. Nothing has broken that I did not break myself, and I am not paying me.',
          [
            'The sifter drum wants a new stave and I have been putting it off.',
            'You can stand there and watch me put it off, if you like. Company helps.',
          ],
          'You shut the inner door last time without being told. I noticed, and I do not notice much on purpose.',
        ],
        close: [
          'Go on through. Porch is swept, floor is not, same as always.',
          'Fetched a pebble out of the sifter that was worth something. Kept it for you. Do not ask why.',
          'Wind is up. Sit inside with me till it has done, and we will say nothing much.',
        ],
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
  const home = addPlayerHome(d, 'home.player', hx - 1, hz, ['g', 'c'], 11,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const [sx, sz] = at(...sites.store);
  const store = d.placeNear('store.cinder', 'building.store', sx - 2, sz, ['g', 'c'], 11,
    { label: 'The Cinder Shop', interior: 'worlds/interiors/store-cinder.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g', 'c'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const clothier = d.placeNear('store.clothier', 'building.clothier', furniture[0] + 7, furniture[1], ['g', 'c'], 12,
    { label: 'Cuff & Collar', interior: 'worlds/interiors/store-clothier.json' }, '0');
  const [cxx, czz] = at(...sites.cottage);
  const cottage = d.placeNear('home.vesper', 'building.cottage', cxx - 1, czz, ['g', 'c'], 11,
    { label: "Vesper's", interior: 'worlds/interiors/home-vesper.json', owner: 'folk.vesper' }, '0');
  const [thx, thz] = at(1.3, 0.58);
  const hall = addTownHall(d, thx - 4, thz, ['g', 'c'], 26);
  addMuseum(d, hall);
  addNeighbors(d, [
    {
      id: 'ember', name: 'Ember', title: 'Ash Glazier', home: 'Cottage', type: 'building.cottage',
      tile: at(4.65, 0.60), allow: ['g', 'c', 's'], voice: { pitch: 1.14, rate: 23, timbre: 'triangle' },
      hello: [
        'Ember. I make glass out of kettle ash. It comes out green, if you keep the heat patient, and something else if you do not.',
        'That is my cottage, with a furnace in the back that does not like a door opened unannounced. Say my name from the path and I will come and let you in.',
      ],
      again: 'Bubbles again in the last batch. They are part of it. Perfect glass belongs elsewhere.',
      greetings: {
        acquaintance: [
          'Furnace has been up since before light. If I look grey it is not weather, it is the raw stuff.',
          'Got a green off the beach ash this morning that I have been chasing for a year. It will not do it twice.',
          'Mind the crate on the step. There is nothing in it but the cullet, and cullet is sharper than it looks.',
          'Wind is down the bowl today. It pushes the flame flat and I have to coax it back up. Long day.',
        ],
        friend: [
          'Basalt wants a window for the bakehouse and he wants it clear. I told him clear is for people with better ash and worse bread.',
          'Tally brought me a bucket off the top bench to try. It went black. I have not told her. You are not to either.',
          [
            'A bottle cracked in the annealing overnight. I heard it from bed.',
            'It is like hearing a coin fall down a well. You know exactly what it cost.',
          ],
          'You are the one person who has looked at a bubble in my glass and not said "shame". I keep thinking of it.',
        ],
        close: [
          'Come and sit by the furnace. It is the warmest chair on the floor and it is yours.',
          'Pulled a green cup off the pipe this morning that came out right. First of the season. I put it on your side of the shelf.',
          'Letting the fire go down today. Sit with me while it does. It is the only quiet the trade allows.',
        ],
      },
    },
    {
      id: 'basalt', name: 'Basalt', title: 'Warm-Stone Baker', home: 'Cabin', type: 'building.cabin',
      tile: at(5.45, 0.59), allow: ['g', 'c', 's'], voice: { pitch: 0.73, rate: 20, timbre: 'square' },
      hello: [
        'Basalt. I bake on a slab the ground keeps warm for nothing. Bread does not know the difference and neither do I, most days.',
        'That cabin is mine, and the oven is most of it. Give the door a rap and wait for the answer; a loaf spoils if the heat gets a fright.',
      ],
      again: 'Loaf is in. It is ready when the crust sounds hollow, and not a moment before.',
      greetings: {
        acquaintance: [
          'Slab is warmer than yesterday. The ground does that. I set the loaves by it and I am never asked why.',
          'Flour on everything, me included. Do not lean on the post.',
          'Four loaves out and three of them right. The fourth is for me. That is the arrangement.',
          'The crows know when the door opens. If you hear a lot of wings, that is my morning going.',
        ],
        friend: [
          'Ember says my crust would be better with a proper window to see it by. I say I bake by sound and she is welcome to bake by glass.',
          'Ro will not take bread on the quay because the damp gets it. So I take it down and eat it at him.',
          [
            'Ground went cold under the oven one night last week. First time in years.',
            'I sat up with it like a sick animal. It came back before dawn. We do not talk about it.',
          ],
          'You take the heel of the loaf without being asked. That is the sign of a person raised properly.',
        ],
        close: [
          'Heel of the loaf is on the slab and it is yours. Sit down while it is still warm.',
          'Kneading day. You can talk and I can grunt, and by the end we will have a loaf between us.',
          'Nothing in the oven and nothing needing doing. Come and sit on the warm step and waste an hour with me.',
        ],
      },
    },
  ], (door) => {
    const [rx, rz] = at(Math.atan2(door[1] - cz, door[0] - cx), ring);
    d.pathL(...door, rx, rz, { level: '0' });
  });

  // Every door out to the ring road, which is the only through-line there is.
  const toRing = (door, dz) => {
    const [rx, rz] = at(Math.atan2(door[1] + dz - cz, door[0] - cx), ring);
    d.pathL(door[0], door[1] + dz, rx, rz, { level: '0' });
  };
  toRing([home[0] + 1, home[1]], 3);
  toRing([store[0] + 2, store[1]], 4);
  toRing([furniture[0] + 2, furniture[1]], 4);
  toRing([clothier[0] + 2, clothier[1]], 4);
  toRing([cottage[0] + 1, cottage[1]], 3);
  toRing([hall[0] + 4, hall[1]], 6);
  toRing([quay[0] + 2, quay[1]], 2);

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
      greetings: {
        acquaintance: [
          'Lake is steaming this morning. It does that when it is cold up top. Do not read anything into it.',
          'Somebody tried the water again yesterday. I did not see who. I heard the noise they made.',
          'Duck went in up to the neck and came out looking pleased. Ducks are wrong about most things.',
          'Keep to the dry ash along here. The soft patches are warm underneath and warm is where it gives.',
        ],
        friend: [
          'Tally sent down a note saying the benches are better than the floor. I sent back a stone. Skipped it eleven.',
          'Vesper is due a visit and it is the whole way round and my knees have opinions. You could go instead.',
          [
            'The lake was flat as a plate at dawn. Not a ripple anywhere on it.',
            'I sat and did not throw anything for an hour. Felt like a betrayal.',
          ],
          'You look at the water the way I do. Sideways, like it might do something. It will not, but keep looking.',
        ],
        close: [
          'Bring a stone and sit down. We can not speak for as long as you like.',
          'Warm patch just here, and it is mine, and I am letting you have half.',
          'Best skim of the year this morning. Nobody saw it. Now you know, and that will do.',
        ],
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
      greetings: {
        acquaintance: [
          'Sheep are on the second bench again. They do not use the ramps. I have watched and I still do not know how.',
          'Cinder holds the heat till noon. Put a hand on the wall and you will feel yesterday in it.',
          'Count the steps on the trail if you want; I make it a different number every time.',
          'Nothing rooted on the top bench this week. Nothing rooted on it last week either. I am keeping a list.',
        ],
        friend: [
          'Ro sent up a stone with "floor" written on it. I put it on the wall and it is doing better than most of the plants.',
          'Talked a fern into the third bench this spring. It came up, looked around, and went back in. I understand it.',
          [
            'I walked the whole rim yesterday. Same wall the whole way, same drop, same lake.',
            'Nobody else does it. I think that is the mistake.',
          ],
          'You have started going steady on the steps without me saying it. Took the crows longer.',
        ],
        close: [
          'Come and sit on the warm side of the wall. I saved the best stone.',
          'Two mushrooms up by the trail and I did not pick them. They are yours if you want the walk.',
          'Cloud sitting in the bowl today and nothing to see. Sit anyway. It is warmer up here than it looks.',
        ],
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
      greetings: {
        acquaintance: [
          'Round again. It is the same distance from the other end; people only think it is longer coming this way.',
          'Fire is in. It is always in. If it is ever out, look for me on the far shore and worry a little.',
          'Lit the lamp last night and left the shutter up. Nobody answered. That is not a complaint.',
          'I can see the whole town from this step and none of it can see me. I like that arrangement better than you would think.',
        ],
        friend: [
          'Ro came round on Tuesday. Complained from the quay to the door and back. I counted it as a visit.',
          'Somebody across the water had a light on till late. It was not a signal. I watched it like one anyway.',
          [
            'The round room has a draught now. I have walked it three times and cannot find where.',
            'I would rather have a corner than a draught, which is a thing I did not think I would say.',
          ],
          'I have stopped lighting the lamp on nights I think you will be over. That is not a thing I have told anybody.',
        ],
        close: [
          'Fire is in and the good side of it is yours. Go and sit.',
          'I lit the lamp last night. Long, short, long. Then I remembered you would be along in the morning anyway.',
          'Nothing has happened over here since I saw you last. Come in and have none of it with me.',
        ],
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
  const home = addPlayerHome(d, 'home.player', hx - 1, hz, ['g'], 12,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const [sx, sz] = at(sites.store, 0.44);
  const store = d.placeNear('store.staithe', 'building.store', sx - 2, sz, ['g'], 12,
    { label: 'The Staithe', interior: 'worlds/interiors/store-staithe.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const clothier = d.placeNear('store.clothier', 'building.clothier', furniture[0] + 7, furniture[1], ['g'], 12,
    { label: 'Cuff & Collar', interior: 'worlds/interiors/store-clothier.json' }, '0');
  const [qx, qz] = at(sites.cottage, 0.50);
  const cottage = d.placeNear('home.quill', 'building.cottage', qx - 1, qz, ['g'], 12,
    { label: "Quill's Hut", interior: 'worlds/interiors/home-quill.json', owner: 'folk.quill' }, '0');
  const hall = addTownHall(d, cx - 4, cz + toft[1] + 7, ['g', 'c'], 26);
  addMuseum(d, hall);
  addNeighbors(d, [
    {
      id: 'reed', name: 'Reed', title: 'Thatch Layer', home: 'Cottage', type: 'building.cottage',
      tile: at(0.98, 0.48), allow: ['g', 's'], voice: { pitch: 0.94, rate: 21, timbre: 'sine' },
      hello: [
        'Reed. I lay thatch. I cut sedge where it grows straight and quiet, and I put it on roofs where it does the same.',
        'The cottage behind me is mine and its roof is my best work. Sing out from the boards before you try the door; I am usually up on it.',
      ],
      again: 'Dry stems above, wet roots below. That is the whole of thatching, and the whole of the fen. Keep them that way.', walk: [0.98, 0.48],
      greetings: {
        acquaintance: [
          'Cutting on the north bank this week. The sedge stands straighter where the wind cannot get at it.',
          'Ridge on the store wants doing before the winter. I have said so twice. Nobody hears a thatcher until it drips.',
          'Leave the bundles where they lean. They are drying and a dropped bundle is a wet bundle.',
          'Rain came sideways last night. Good test. Roof passed. I did not sleep for listening to it pass.',
        ],
        friend: [
          'Quill cuts reed by the armful and calls it a trade. I cut it by the acre and call it a Tuesday.',
          'Marsh wants offcuts for his baskets and asks by leaving a basket on my step. I have started leaving it full. Neither of us has said a word.',
          [
            'Fell through my own ladder yesterday. Third rung. Landed in the soft.',
            'Nothing hurt but the ladder, and I am not telling Meg, because she said that ladder would go.',
          ],
          'You look up at a roof before you look at the door. I like a person who does that.',
        ],
        close: [
          'Come in under it. Best-thatched roof in the fen and I would rather you were dry under it than anybody.',
          'Kept a bundle of the straight stuff back. Not for a roof. For you to see what straight looks like.',
          'No cutting today, water is too high. Come under the eaves with me and listen to the roof not leak.',
        ],
      },
    },
    {
      id: 'marsh', name: 'Marsh', title: 'Eel Basket Weaver', home: 'Cabin', type: 'building.cabin',
      tile: at(2.23, 0.48), allow: ['g', 's'], voice: { pitch: 0.81, rate: 19, timbre: 'sawtooth' },
      hello: [
        'Marsh. I weave eel baskets. The trick is the mouth: an eel goes in easy and works out the rest too late.',
        'That cabin is mine, willow soaking in every tub of it. Knock and wait to be let in; an eel goes in without asking, and look where it gets the eel.',
      ],
      again: 'Nothing in the baskets yet this morning. That is how waiting looks; it is most of the trade.', walk: [2.23, 0.48],
      greetings: {
        acquaintance: [
          'Willow is soaking. It has to be soft as string before it will bend round the mouth. Give it a day.',
          'Two baskets down in the west channel since dark. If they come up empty the water is too warm, not the basket.',
          'Watch the tubs by the door. It is only water, but it is cold water and a lot of it.',
          'Eels run when the moon is thin. I do not know why. I have stopped asking and started weaving.',
        ],
        friend: [
          'Reed will not sell me offcuts, so I leave a basket on his step, and it comes back full. Neither of us has admitted anything.',
          'Quill hides his thin reed from me now. I know where. I am letting him think it works.',
          [
            'Had an eel work its way back out of the mouth last night. First one in years.',
            'Sat and looked at that basket a long time. It has been unpicked and it is going to be a better basket.',
          ],
          'You pick a basket up by the middle, not the mouth. Somebody taught you or you worked it out. Either does.',
        ],
        close: [
          'Come and sit by the tubs. I am at the slow part and it is better with company.',
          'Smoked the best of the catch. Kept the tail end for you, which is the good end, whatever people say.',
          'Baskets are all down and there is nothing to do but wait. Wait with me.',
        ],
      },
    },
  ], (door, spec) => {
    const [wx, wz] = at(...spec.walk);
    d.pathL(...door, wx, wz, { level: '0' });
  });

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
  toWalk([clothier[0] + 2, clothier[1]], 4, sites.store, 0.56);
  toWalk([cottage[0] + 1, cottage[1]], 3, sites.cottage, 0.50);
  d.pathL(hall[0] + 4, hall[1] + 6, cx, cz + toft[1] + 8, { level: '0' });
  d.pathL(staithe[0] + 2, staithe[1] + 2, cx - 1, cz + toft[1] + 2, { level: '1' });

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
      greetings: {
        acquaintance: [
          'Water is up a hand since Sunday. The far plank will be under by dinner. Go round.',
          'Board by the second spur has gone soft. I have marked it with a reed. Trust the reed.',
          'Ducks have gone west, which means the wind is coming east. That is all the weather I do.',
          'Stood up here all morning and watched three people take the wrong spur. None of them were you. Good.',
        ],
        friend: [
          'Tarn asked me to mark a short cut to his door. I told him the fen has already marked it and it says no.',
          'Quill wants planks out to that hut of his. I said the walk is what makes it his. He did not laugh.',
          [
            'Forty years and I put a foot in it yesterday. Right up to the knee.',
            'Nobody saw. I am telling you so that at least one person knows I am not proud.',
          ],
          'You take the long way even when the water is down. I have started thinking of you as one of the sensible ones.',
        ],
        close: [
          'Sit with me on the rise. You can see every spur from here and none of them need us.',
          'I have kept the dry seat by the staithe post for you. It is the only one there is.',
          'Nothing needs mending today. Stand here a while and we will both pretend that is normal.',
        ],
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
      greetings: {
        acquaintance: [
          'Cut a stand of reed by the second channel this morning. Straight as pencils. It is a good year for it.',
          'Bundles on the step want turning. If you step over them rather than on them, we will get on.',
          'Water is sitting an inch under the floor. Floor knows it. I know it. We are all fine.',
          'You came the whole way out on a wet day. Nobody sees that but the herons, and the herons and I have noticed.',
        ],
        friend: [
          'Meg says I should have planks out here. I say once there are planks, there will be people, and then where will I be.',
          'Marsh wants my thin reed for his baskets and he does not want to pay reed prices. I have started hiding the good stuff.',
          [
            'The trap came up with a pike in it. A real one, not the man.',
            'Ate it. Told nobody. It was the best thing to happen all week and I am sharing it with you.',
          ],
          'You lift the trap without being told. That is worth more to me than half the people who know my name.',
        ],
        close: [
          'Dry corner is swept and the step is yours. Come up and sit.',
          'Marigolds are out on the bank. I left the best ones for you. They will not last.',
          'Rain on the reed roof today and nothing to do under it. Come and listen to it with me.',
        ],
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
      greetings: {
        acquaintance: [
          'Saw your smoke before I saw you. Out here that counts as a visit.',
          'Been laying stone on the soft bit by my gate. It sinks. I lay more. That is the whole job.',
          'Quarter of an hour, door to door, and the water still took the short way before I did.',
          'Ducks on the channel between us this morning. Five. I am telling you because there is nobody else to tell.',
        ],
        friend: [
          'Meg will not mark me a short cut. I asked twice. Second time she just pointed at the water.',
          'Went to the Staithe and took the wrong spur. Twenty years here. Do not tell Meg, she will only be pleased.',
          [
            'Roof leaked over the bed last night. I moved the bed.',
            'This morning I moved it back. If the roof wants to argue it knows where I am.',
          ],
          'A quarter of an hour used to feel like a long way to a neighbour. It has stopped feeling like that lately.',
        ],
        close: [
          'Come in out of the wet. Door sticks. Everything sticks, it is a fen.',
          'Kept a dry stone for you to sit on. It is the only one with nothing growing on it.',
          'Walk over in the rain and there is a mug on the hook that has stopped being mine.',
        ],
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
  const home = addPlayerHome(d, 'home.player', road - 12, townRow(sites.home), ['g'], 12,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json', playerHome: true }, '0');
  const store = d.placeNear('store.capstan', 'building.store', road + 6, townRow(sites.store), ['g'], 12,
    { label: 'The Capstan', interior: 'worlds/interiors/store-capstan.json' }, '0');
  const furniture = d.placeNear('store.furniture', 'building.furniture', store[0] + 7, store[1], ['g'], 12,
    { label: 'Turnip & Timber', interior: 'worlds/interiors/store-furniture.json' }, '0');
  const clothier = d.placeNear('store.clothier', 'building.clothier', furniture[0] + 7, furniture[1], ['g'], 12,
    { label: 'Cuff & Collar', interior: 'worlds/interiors/store-clothier.json' }, '0');
  const cottage = d.placeNear('home.sennen', 'building.cottage', road + 16, townRow(sites.cottage), ['g'], 12,
    { label: "Sennen's Cottage", interior: 'worlds/interiors/home-sennen.json', owner: 'folk.sennen' }, '0');
  const hall = addTownHall(d, road - 4, townRow(0.5), ['g', 'c'], 24);
  addMuseum(d, hall);
  addNeighbors(d, [
    {
      id: 'kelp', name: 'Kelp', title: 'Rope Walker', home: 'Cottage', type: 'building.cottage',
      tile: [road - 23, townRow(0.72)], voice: { pitch: 0.86, rate: 22, timbre: 'sawtooth' },
      hello: [
        'Kelp. I walk rope. Lay it out between the posts along the road and stretch it until it forgets it was ever coiled.',
        'That cottage is mine, and there is usually a line off its door. Shout before you come up the path; a loaded rope does not care whose ankle it finds.',
      ],
      again: 'Line is out between the posts. Step over it, not on it; it has a week of stretch in it and I would rather keep that.', lane: road - 16,
      greetings: {
        acquaintance: [
          'Salt gets into new rope and makes it lazy. That is why I walk it up here and not down at the quay.',
          'Doss wants three fathoms by Friday. He will get it Saturday. Rope does not read calendars.',
          'Mind the far post. I have a line off it that is under so much strain it hums when the wind is right.',
          'Hands are raw from the tarred stuff. Nod, and I will nod back, and we will call that shaking hands.',
        ],
        friend: [
          "Morrow wants a bell rope soft enough to pull with a child's hand and strong enough to hang a bell from. I told him to pick.",
          'Chalk marked one of my posts white. Said it was so nobody walked into the line in the fog. Nobody has since. I am annoyed that it worked.',
          [
            'A line went yesterday. Snapped under stretch, the whole length of the road.',
            'Sound like a shot. Every gull on the coast went up. Nobody hurt but my pride and the rope.',
          ],
          'You walk along the line, not across it. First person on this road who did that without being told.',
        ],
        close: [
          'Nothing under strain today. Come and sit on the coil, it is the softest seat on the road.',
          'Made you a short piece with a proper eye in it. Do not ask what for. Everybody needs one eventually.',
          'Fog is down and the posts have gone. Sit in the door with me till they come back.',
        ],
      },
    },
    {
      id: 'chalk', name: 'Chalk', title: 'Wall Limner', home: 'Cabin', type: 'building.cabin',
      tile: [road + 20, townRow(0.72)], voice: { pitch: 1.18, rate: 24, timbre: 'triangle' },
      hello: [
        'Chalk. I limewash walls and mark boats. If a thing has to be found in fog, I am the one who makes it white enough to find.',
        'That cabin is mine. Call out from the road before you come in; I will be up a ladder with a brush, and I would rather see you than drip on you.',
      ],
      again: 'White first. Colour after, once the weather has agreed to it. It has not agreed yet.', lane: road + 15,
      greetings: {
        acquaintance: [
          'Fog this morning and every white mark on the coast earned its keep. I stood on the road and counted them.',
          'Lime on my hands, lime in my hair. If I go grey early it will be work, not worry.',
          'Doing the quay wall again. Salt eats white faster than it eats anything.',
          'Mind the pail by the step. It is wash, and it will take the colour out of your boots and then your boots.',
        ],
        friend: [
          'Kelp says my white post ruins the look of the road. Nobody has walked into his rope since. He knows that.',
          'Sennen wants the road side of his house done in something cheerful. I said white, then wait. He said he has been waiting. I said good.',
          [
            'A boat came in last night and the skipper said he found the slip by my mark on the wall.',
            'Best thing anyone has said to me all year and he did not know he was saying it.',
          ],
          'You look at a wall and see whether it needs doing. Most people see a wall. I have got fond of you for it.',
        ],
        close: [
          'Ladder is down and the pail is lidded. Come and sit on the step, it dried an hour ago.',
          'Put a small white mark on your mailbox post when you were out. Now they can find you in fog too. Do not thank me.',
          'Weather has not agreed to anything today, so nothing gets colour. Stop a while. It is rare, me with clean hands.',
        ],
      },
    },
    {
      id: 'morrow', name: 'Morrow', title: 'Bell Caster', home: 'Bungalow', type: 'building.bungalow',
      tile: [road - 21, townRow(0.28)], voice: { pitch: 0.7, rate: 18, timbre: 'square' },
      hello: [
        'Morrow. I cast bells. Small ones, for doors and gates too far inland to hear the rock and too proud to say so.',
        'That bungalow is mine, and when the mould is open I do not hear the door. Ring the little one on the post and wait; that is what it is for.',
      ],
      again: 'A clear note needs room around it. So does the pouring. Give the yard a wide berth today.', lane: road - 14,
      greetings: {
        acquaintance: [
          'Poured at dawn. The bronze is still talking in the mould and I will not know for a day what it said.',
          'Listen. That is the rock, out on the water. Every bell I make is trying to be that and not one has managed.',
          'Ash pit is warm. Keep the boots off it. I say it to everyone, and most of them learn once.',
          'The wind carries the rock further on a cold day. Good for me. I sit and take notes on it.',
        ],
        friend: [
          "Sennen's bell is mine. He tells everyone he timed the echo with a candle. He did. I held the candle.",
          'Kelp will not make me a rope that is both soft and strong. Says I have to pick. I have been picking for a year.',
          [
            'Cracked a bell on the cooling yesterday. Heard it go from the yard.',
            'A cracked bell has a note. It is a sad note, and it is honest, and I hung it up anyway.',
          ],
          'You stop and listen when the rock sounds. Most people here have stopped hearing it. I would rather they had not.',
        ],
        close: [
          'Come and sit by the pit. It is warm and there is a bell cooling that will be worth the wait.',
          'Cast a little one for your door. It is on the bench. It rings true and I did not expect it to.',
          'No pour today, no fire. Sit in the quiet with me. It is the only day I hear the rock properly.',
        ],
      },
    },
  ], (door, spec) => d.pathL(...door, spec.lane, roadZ, { level: '0' }));

  d.pathL(home[0] + 1, home[1] + 3, road - 6, roadZ, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, road + 4, roadZ, { level: '0' });
  d.pathL(furniture[0] + 2, furniture[1] + 4, road + 8, roadZ, { level: '0' });
  d.pathL(clothier[0] + 2, clothier[1] + 4, road + 10, roadZ, { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, road + 12, roadZ, { level: '0' });
  d.pathL(hall[0] + 4, hall[1] + 6, road, roadZ, { level: '0' });
  d.pathL(quay[0] + 2, quay[1] + 2, road, quay[1] + 3, { level: '0' });

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
      greetings: {
        acquaintance: [
          'Tide is on the turn. You can hear the bell rock clearer when it is; the water gets out of the way of the sound.',
          'Slip is green today. Walk it like it hates you and you will keep your feet.',
          'Boats are in early. Nothing out there but weather and it was not the kind you fish in.',
          "Gulls are working something off the point. Could be fish. Could be Nell's sheep gone in. Both have happened.",
        ],
        friend: [
          'Nell sent down a note saying the wind is worse up there. I sent back a wet one saying the sea is wetter down here.',
          'Sennen keeps wanting me to come and stand in his front room and listen. I told him I can hear the bell fine from here, thank you.',
          [
            'Came in on the bell last night, fog right down, no light at all.',
            'You count between the notes and steer by the counting. Nobody taught me that. The rock did.',
          ],
          'You walk the slip like a local now. Weed and all. The sea has stopped trying you out and I have as well.',
        ],
        close: [
          'Bell is ringing plain this morning. Sit on the wall and listen to it with me.',
          'Kept a crab back from the pot. It is in the bucket with your name on the lid, more or less.',
          'Boats are out and I am not. Nobody else knows what to say to that. Sit down and say nothing with me.',
        ],
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
      greetings: {
        acquaintance: [
          'Gate on the top step is off its hinge again. Lift it, do not push it, and it will forgive you.',
          'Wind is up from the sea. I can smell salt on the sheep and they do not care for it either.',
          'Cropped short up here this week. You can see the chalk through the grass where the sheep have been at it.',
          'Sheep are in the far corner where the pines break the wind. Sheep know everything I know about weather and more.',
        ],
        friend: [
          'Doss sent up a wet note about the sea. I have pinned it to the gate to dry. It will take a week.',
          'Sennen thinks he lives in the middle of the town. He lives in the middle of an argument and he built the house there on purpose.',
          [
            'Walked north yesterday until the sheep stopped being mine.',
            'Then I walked back. It was further than I thought and it did not stop. It never does.',
          ],
          'You do not go on about the view. Everybody else stands here and says "oh". You look at the field. I have noticed.',
        ],
        close: [
          'Sit in the lee of the wall. The sheep will come and look at you. Let them.',
          'Left the gate on the latch for you. I have never done that for anyone, and the sheep have noticed.',
          'Wind has dropped and there is nothing to do but be up here. Be up here with me.',
        ],
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
      greetings: {
        acquaintance: [
          'Halfway row. You can see both ends from the step and neither end will look back.',
          'Wind off the sea on the front and wind off the hill on the back. I am the only house in the town that gets both.',
          'Rang the bell at noon and both halves stopped. It is the only time in the day they agree on anything.',
          'Swept the boards and washed the flags and neither half of the town has noticed either.',
        ],
        friend: [
          'Nell says the sea is loud tonight. Doss says the hill is quiet. They said it at the same time, from either end of my window.',
          'Painted the road side of the house. Chalk says it needs another coat before the weather. The weather has not been asked.',
          [
            'Somebody told me to pick a side once. I said I had. I said the middle.',
            'They walked off up the hill. Then they came back down again. That is my point, and nobody gets it.',
          ],
          'You come in one door and out the other. Nobody else uses both. I have started to think you understand the house.',
        ],
        close: [
          'Good chair is in the middle, obviously. Come in whichever door you like and sit in it.',
          'Bell rope is down for you. Give it a pull and then come and watch the town stop.',
          'Quiet day, both ends. Sit on the step between them with me and enjoy nobody arguing.',
        ],
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
