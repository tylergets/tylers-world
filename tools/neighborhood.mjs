/**
 * The two hundred settlers.
 *
 * One roster, shared by the two tools that each need half of it:
 * genneighbors.mjs builds every settler's interior from the (id, name, home)
 * triple, and genhomes.mjs places the house and the person in their town from
 * the rest. Splitting the list across the two scripts is how a neighbor ends
 * up with a front door and no room behind it.
 *
 * Names are one word and lowercase because the id is `folk.<name>` and the
 * house is `home.<name>`, exactly the convention the first twenty neighbors
 * set. Every town's names, titles and small talk lean on what the town IS --
 * a fen talks about eels and peat, a caldera about kilns and cinders --
 * because two hundred people who all say "nice weather" are one person with
 * two hundred houses.
 */

/** Cottage, cabin, bungalow, round and round: three plans, endlessly re-lived. */
const HOMES = ['Cottage', 'Cabin', 'Bungalow'];

/**
 * town -> its people. `names` seeds ids; titles and lines cycle, which is
 * deliberate -- a town with two Reed Cutters in it is a town with a reed
 * problem, not a bug.
 */
export const TOWNS = {
  meadowbrook: {
    names: [
      'aspen', 'clover', 'dahlia', 'elm', 'filbert', 'hawthorn', 'ivy',
      'linden', 'mallow', 'nettle', 'oat', 'pippin', 'quince', 'russet',
      'sorrel', 'tansy', 'verbena', 'willow', 'zinnia', 'barley',
      'cowslip', 'damson', 'eglantine', 'foxglove', 'garland',
    ],
    titles: [
      'Seed Keeper', 'Bee Warden', 'Orchard Hand', 'Hay Raker',
      'Cider Presser', 'Hedge Layer', 'Plough Mender', 'Meadow Warden',
      'Berry Picker', 'Scarecrow Tailor', 'Well Minder', 'Fence Viewer',
    ],
    hello: [
      '{name}. I do the rounds as {title} here. That\'s my place there -- mind the vegetable beds on your way past.',
      'You\'ll be the new face. {name}, {title}. The meadow looks after itself; the rest of it is me.',
      '{name}. {title} for Meadowbrook, which mostly means walking and worrying. Knock any time the lamp\'s lit.',
      'Afternoon. {name} -- I keep busy as {title}. The bees know more about this town than the mayor does.',
      '{name}, and before you ask: yes, the grass is always like this. {title}, at your service.',
      'Oh -- hello. {name}. I\'ve been {title} since before the orchard came in. It\'s a good life if you like mornings.',
    ],
    again: [
      'The clover\'s early this year. Nobody believes me.',
      'If you find a swarm, come find me first.',
      'Rain by supper, or my knee\'s a liar.',
      'The orchard rows are straight. I measured twice.',
      'A meadow is just a lawn with ambition.',
      'Mind the hedgerow -- it bites back in June.',
    ],
  },

  sourwood: {
    names: [
      'acorn', 'birch', 'burl', 'cedar', 'chestnut', 'hickory', 'knot',
      'larch', 'maple', 'moss', 'resin', 'rowan', 'sylva', 'spruce',
      'tamarack', 'thorn', 'timber', 'walnut', 'wicker', 'yew',
      'bracken', 'holly', 'laurel', 'tupelo', 'galax',
    ],
    titles: [
      'Sap Boiler', 'Stump Splitter', 'Bark Peeler', 'Charcoal Burner',
      'Trail Blazer', 'Mast Gatherer', 'Shingle Riever', 'Gall Collector',
      'Ridge Runner', 'Holler Warden', 'Kindling Bundler', 'Deadfall Clearer',
    ],
    hello: [
      '{name}. {title}, up and down this holler my whole life. That\'s my roof through the trees.',
      'Don\'t get many strangers this deep in the wood. {name} -- {title}. The path forks; my door doesn\'t.',
      '{name}. I work the slope as {title}. The trees talk, if you stand still long enough to be rude to.',
      'Easy on the roots there. {name}, {title}. The holler keeps its own hours and so do I.',
      '{name}, {title}. Everything here is uphill from something. You get used to it.',
      'Well now. {name}. Been {title} since the big oak came down. Come by; the kettle\'s always on the edge of boiling.',
    ],
    again: [
      'Sap\'s running slow. Cold spring.',
      'You can\'t hurry a woodpile.',
      'The ridge fog burns off by ten. Usually.',
      'Heard an owl at noon. Make of that what you like.',
      'A straight plank is a small miracle.',
      'The holler floor eats hats. Hold onto yours.',
    ],
  },

  tidewrack: {
    names: [
      'brine', 'cockle', 'drift', 'dulse', 'foam', 'jetty', 'limpet',
      'nacre', 'oyster', 'pearl', 'plank', 'reef', 'salter', 'shale',
      'spume', 'tern', 'undine', 'wharf', 'winkle', 'spar',
      'cuttle', 'anemone', 'periwinkle', 'murex',
      'laguna',
    ],
    titles: [
      'Net Mender', 'Tide Watcher', 'Wrack Comber', 'Shell Sorter',
      'Buoy Painter', 'Salt Raker', 'Creel Weaver', 'Moon Reader',
      'Flotsam Clerk', 'Skiff Caulker', 'Line Coiler', 'Kelp Cutter',
    ],
    hello: [
      '{name}. {title} on this shore, tide in or tide out. Mine\'s the house that smells of rope.',
      'You walked the wet sand -- good instincts. {name}, {title}. The sea leaves me things and I sort them.',
      '{name}. I keep on as {title}. Everything on this island came off a wave, one way or another.',
      'Watch the third step at low tide. {name} -- {title}. Come by when the wind drops.',
      '{name}, {title}. The tide takes more than it gives, but it gives on time.',
      'Ahoy, more or less. {name}. Been {title} here longer than the jetty\'s been leaning.',
    ],
    again: [
      'Tide turns in an hour. You can set bread by it.',
      'Found a green glass float once. Best day of my life.',
      'The gulls are liars. Every one.',
      'Salt gets into everything. Mostly me.',
      'A calm sea is just planning something.',
      'If it washes up, it wanted to be found.',
    ],
  },

  thistledown: {
    names: [
      'burdock', 'distaff', 'felt', 'fleece', 'gorse', 'heath', 'hemp',
      'loomis', 'skein', 'spindle', 'teasel', 'tweed', 'warp', 'weft',
      'woolsey', 'cambric', 'damask', 'fuller', 'mercer', 'napper',
      'shears', 'bobbin', 'purl', 'selvage', 'twill',
    ],
    titles: [
      'Wool Carder', 'Dye Steeper', 'Fleece Grader', 'Loom Setter',
      'Thistle Reeve', 'Shear Sharpener', 'Yarn Winder', 'Cloth Fuller',
      'Down Gatherer', 'Pattern Keeper', 'Button Turner', 'Blanket Binder',
    ],
    hello: [
      '{name}. {title} here in Thistledown, where everything is softer than it looks. That\'s my chimney there.',
      'Mind the thistles -- they\'re the town\'s, not mine. {name}, {title}. Come in out of the wind sometime.',
      '{name}. I\'ve been {title} through eleven shearings. The sheep and I have an understanding.',
      'You\'ve lint on your shoulder already; the town does that. {name} -- {title}.',
      '{name}, {title}. Everything here is spun, woven, or about to be.',
      'Hello, hello. {name}. {title} by trade, gossip by habit. My door\'s the one with the wool sacks.',
    ],
    again: [
      'The dye pot\'s gone a colour I don\'t have a name for.',
      'Wind\'s from the down today. Everything smells of sheep.',
      'A dropped stitch haunts you. Ask anyone.',
      'The thistle seed flies at dusk. Lovely, if you\'re not washing.',
      'Two ply for socks. I\'ll die on this hill.',
      'The loom knows when you\'re in a hurry.',
    ],
  },

  rimrock: {
    names: [
      'agate', 'bluff', 'chert', 'cobble', 'crag', 'dusty', 'feldspar',
      'garnet', 'gneiss', 'gypsum', 'jasper', 'ledge', 'marl', 'onyx',
      'opal', 'pumice', 'quartz', 'ridge', 'scree', 'shard',
      'slate', 'talus', 'terra', 'tor', 'mica',
    ],
    titles: [
      'Stone Stacker', 'Dust Sweeper', 'Cairn Keeper', 'Echo Counter',
      'Ridge Walker', 'Fossil Sifter', 'Wall Trimmer', 'Sun Marker',
      'Gravel Rater', 'Mesa Warden', 'Wind Gauger', 'Ore Sniffer',
    ],
    hello: [
      '{name}. {title} up here on the rim. The view\'s free; the shade costs you a conversation.',
      'You climbed the whole way -- good. {name}, {title}. Mine\'s the house holding that wall up.',
      '{name}. I keep at it as {title}. The mesa was here first and it doesn\'t let you forget.',
      'Mind the scree past my fence. {name} -- {title}. Water\'s in the shade barrel if you need it.',
      '{name}, {title}. Everything up here is either rock or on its way to being rock.',
      'Well met. {name}. Been {title} since the last rockfall rearranged the road.',
    ],
    again: [
      'The rim glows red at sundown. Never gets old.',
      'Found a fossil shaped like a smile. Kept it.',
      'The wind up here has opinions.',
      'A good wall wants no mortar and no hurry.',
      'It\'s not the heat, it\'s the geology.',
      'Every stone in that wall has a name. I was bored.',
    ],
  },

  ashkettle: {
    names: [
      'brand', 'coal', 'soot', 'kindle', 'tinder', 'forge', 'calder',
      'pyra', 'scoria', 'tephra', 'crater', 'sully', 'smoke', 'spark',
      'blaze', 'wick', 'flare', 'kiln', 'ashen', 'ingle',
      'tallow', 'cindra', 'vulca', 'rusk', 'ferro',
    ],
    titles: [
      'Kiln Minder', 'Cinder Raker', 'Bellows Hand', 'Glaze Mixer',
      'Steam Reader', 'Coalyard Clerk', 'Spark Warden', 'Pot Thrower',
      'Ash Sifter', 'Vent Listener', 'Ember Keeper', 'Crucible Scrubber',
    ],
    hello: [
      '{name}. {title} in the kettle, born to it. That\'s my house -- the warm one.',
      'The ground hums some nights; you\'ll get used to it. {name}, {title}.',
      '{name}. I work as {title}. The caldera gives good clay and better excuses.',
      'Don\'t touch the red rocks. {name} -- {title}. The rest are only mostly hot.',
      '{name}, {title}. Everything in Ashkettle is fired twice: once by us, once by the ground.',
      'Ho there. {name}. Been {title} since the old kiln cracked. Come warm your hands any evening.',
    ],
    again: [
      'The kiln\'s at temper. You can hear it sing.',
      'Ash on the sill again. The mountain\'s dreaming.',
      'A pot that survives the kettle survives anything.',
      'The springs run hot enough for eggs. Don\'t ask how I know.',
      'Soot is just enthusiasm, settled.',
      'Third vent\'s whistling in B flat today. Fair weather.',
    ],
  },

  sedgewater: {
    // No bungalows in the fen: the five-wide plan needs more dry, flat, open
    // ground in one piece than Sedgewater has left. Found out empirically by
    // genhomes.mjs leaving two settlers homeless.
    homes: ['Cottage', 'Cabin'],
    names: [
      'bog', 'bulrush', 'cattail', 'damsel', 'fenn', 'mire', 'murk',
      'osier', 'peat', 'rush', 'silt', 'teal', 'tule', 'cooter',
      'darter', 'egret', 'marigold', 'lotus', 'lily', 'newt',
      'cricket', 'dew', 'misty', 'brooke', 'alga',
    ],
    titles: [
      'Reed Cutter', 'Eel Counter', 'Peat Digger', 'Frog Listener',
      'Sluice Keeper', 'Basket Soaker', 'Mud Reader', 'Lantern Poler',
      'Cranberry Wader', 'Fen Warden', 'Duckweed Skimmer', 'Stilt Mender',
    ],
    hello: [
      '{name}. {title} out here in the fen. My house is the dry spot -- mostly.',
      'You found the firm path; well done. {name}, {title}. The water rearranges the rest.',
      '{name}. I get by as {title}. Everything in Sedgewater floats, given time.',
      'Boots off at the door, that\'s all I ask. {name} -- {title}.',
      '{name}, {title}. The fen looks flat. The fen is lying.',
      'Evening, whenever it is -- the mist eats clocks. {name}, {title} hereabouts.',
    ],
    again: [
      'The eels are running. Everything else is walking.',
      'Peat smoke cures anything except being asked about it.',
      'Heard the bittern boom last night. Good omen.',
      'Dry socks are the whole economy out here.',
      'The reeds whisper. Mostly complaints.',
      'If the path squelches twice, go back.',
    ],
  },

  bellrock: {
    names: [
      'ballast', 'buoy', 'capstan', 'chandler', 'cleat', 'davit',
      'fathom', 'gaff', 'halyard', 'hawser', 'jib', 'keel', 'lantern',
      'lee', 'mast', 'moor', 'pilot', 'quay', 'rigger', 'rudder',
      'scupper', 'sextant', 'tiller', 'compass', 'harbor',
    ],
    titles: [
      'Rope Walker', 'Bell Ringer', 'Chart Mender', 'Harbor Reckoner',
      'Signal Keeper', 'Anchor Smith', 'Sail Patcher', 'Fog Crier',
      'Ledger Sander', 'Beacon Trimmer', 'Knot Instructor', 'Ballast Weigher',
    ],
    hello: [
      '{name}. {title} for the harbor. The bell rings true and so do I. That\'s my door by the coil of rope.',
      'Fresh off the road, are you? {name}, {title}. Bellrock keeps time by the bell and the tide, in that order.',
      '{name}. I serve as {title}. Every rope in this town has a job, and so does everyone holding one.',
      'Mind the wet stones on the quay. {name} -- {title}. Come by when the fog horn\'s quiet.',
      '{name}, {title}. A harbor is a promise the town makes to boats.',
      'Aye, hello. {name}. Been {title} since the old bell cracked and got recast. It sounds better with the scar.',
    ],
    again: [
      'The bell\'s a half-tone flat in cold weather. Charming, really.',
      'Fog\'s due. I can smell it thinking.',
      'A coiled rope is a happy rope.',
      'The tide table\'s never wrong. The tide, occasionally.',
      'Ships come back. That\'s the whole trick of a harbor.',
      'Polish the brass and the weather behaves. Proven fact.',
    ],
  },
};

/** The wildlife each town takes in, two of each, when the settlers arrive. */
export const WILDLIFE = {
  meadowbrook: ['cow', 'pony', 'goose', 'robin', 'sparrow', 'hare', 'hedgehog', 'peacock'],
  sourwood: ['boar', 'deer', 'fox', 'squirrel', 'owl', 'turkey', 'badger', 'mouse'],
  tidewrack: ['gull', 'heron', 'otter', 'sparrow', 'mouse', 'dog'],
  thistledown: ['donkey', 'pheasant', 'hare', 'hedgehog', 'magpie', 'frog'],
  rimrock: ['tortoise', 'donkey', 'owl', 'magpie', 'fox', 'mouse'],
  ashkettle: ['pig', 'raccoon', 'skunk', 'pigeon', 'mouse', 'tortoise'],
  sedgewater: ['heron', 'frog', 'otter', 'ferret', 'goose', 'mouse'],
  bellrock: ['gull', 'pigeon', 'robin', 'ferret', 'badger', 'frog'],
};

/** Flatten one town's people into full records, in a stable order. */
export function settlersOf(town, offset = 0) {
  const spec = TOWNS[town];
  const homes = spec.homes ?? HOMES;
  return spec.names.map((id, i) => {
    const name = id[0].toUpperCase() + id.slice(1);
    const title = spec.titles[i % spec.titles.length];
    const fill = (s) => s.replaceAll('{name}', name).replaceAll('{title}', title);
    const n = offset + i;
    return {
      id,
      name,
      home: homes[n % homes.length],
      title,
      voice: {
        pitch: Math.round((0.78 + ((n * 37) % 41) / 41 * 0.5) * 100) / 100,
        rate: 18 + ((n * 13) % 13),
        timbre: ['triangle', 'sawtooth', 'square'][n % 3],
      },
      roam: 4 + (n % 3),
      hello: fill(spec.hello[i % spec.hello.length]),
      again: fill(spec.again[(i + 3) % spec.again.length]),
    };
  });
}

/** Every settler in every town, for the interior generator. */
export function allSettlers() {
  const out = [];
  let offset = 0;
  for (const town of Object.keys(TOWNS)) {
    out.push(...settlersOf(town, offset));
    offset += TOWNS[town].names.length;
  }
  return out;
}
