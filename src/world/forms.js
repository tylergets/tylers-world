/**
 * World form registry: what lies BEYOND the grid.
 *
 * A world file describes a rectangle of tiles. It says nothing about what is
 * off the edge of that rectangle -- and the edge is the first thing you look at
 * from inside, so "nothing" is not an option. Every exterior place therefore
 * declares a `form`, and the form is what the renderer wraps around the map:
 *
 *   island   open water on all four sides. The wall is the sea: you can see
 *            out forever and you are never getting there.
 *   holler   an Appalachian hollow. Ridges climb off the map on the closed
 *            sides and the ground falls away at the `open` one -- the mouth,
 *            where the creek and the road run out toward everywhere else.
 *   mesa     a tableland. The ground FALLS AWAY on all four sides into a hazy
 *            basin: the wall is a cliff you are standing on top of.
 *   caldera  a crater. The rim climbs off the map on every side with no mouth
 *            anywhere, so the wall is complete and the place has no outward.
 *   fen      standing water, reeds and no far shore. Like an island in that the
 *            wall is water, unlike one in that the water is ankle-deep and the
 *            reason you cannot cross it is the mire under it.
 *   coast    both at once: sea off the `open` edges, farmland rolling away over
 *            the closed ones. The only form whose band changes as you walk it.
 *
 * EVERY FORM IS AN ANSWER TO ONE QUESTION -- why you cannot walk off the map.
 * That is the bar a new form has to clear. A form whose band is a flat meadow
 * running to the horizon is a lovely picture with an invisible wall in it, and
 * the invisible wall is the thing the player will remember.
 *
 * WHY THIS IS A FORM AND NOT JUST MORE TILES
 * ------------------------------------------
 * A ridge or an ocean drawn as real tiles would cost thousands of them to look
 * like distance, and every one would need collision, occupancy and a bucket
 * entry for scenery the player can never touch. The form is scenery-only: it is
 * built from a handful of quads that weld flush to the map's outer corners, so
 * the sim's world stays exactly the rectangle the file describes.
 *
 * ORDER DOES NOT MATTER HERE (unlike SURFACES): forms are stored in the file by
 * NAME, never by index, because there is one per world rather than one per tile
 * and the byte was never worth the fragility.
 *
 * THE BAND VOCABULARY, in full. A band is either water or land, and `sea` is
 * how the one mixed form says "both":
 *
 *   water   true  the band is liquid: it shimmers with the shoreline tiles and
 *                 reads as one body of water with them.
 *     shore       tiles the surface takes to fall from the map edge to sea
 *                 level. Short is a beach; long is a wade.
 *     near, far   colour at the map edge, and colour at the horizon.
 *
 *   water   false the band is ground.
 *     rise        world units the ground gains by the horizon ring. NEGATIVE
 *                 means it falls away instead, which is what a mesa is.
 *     fall        world units the ground drops past an `open` edge.
 *     taper       tiles over which the wall tapers out approaching an open edge.
 *     low, high   colour at the weld, and colour at full relief.
 *     far         the haze distance stacks on top of both.
 *
 *   sea     a nested water band. Present only on a mixed form: where the wall
 *           is open the land band gives way to this one, over the same `taper`.
 *
 *   skirt   colour of the vertical rim at the far ring, on every form.
 *
 * Interiors have no form. A living room's edge is its walls, which are real
 * tiles with real collision, and wrapping an ocean around them would be absurd.
 */
export const FORMS = [
  {
    name: 'island',
    label: 'Island',
    /** Can `terrain.open` name edges? An island's sea has no gaps. */
    openable: false,
    band: {
      /** Sea, so it shimmers with the shoreline tiles and reads as one body. */
      water: true,
      /** Tiles the shore takes to fall to sea level. Short: this is a beach, not a shelf. */
      shore: 1.25,
      near: 0x4093c9,  // water just off the beach
      far: 0x2c6791,   // deep water toward the horizon
      skirt: 0x143a58,
    },
  },
  {
    name: 'holler',
    label: 'Holler',
    openable: true,
    /** Which edge the holler drains toward if the file does not say. */
    defaultOpen: ['south'],
    band: {
      water: false,
      /** World units the ridge climbs by the time it reaches the horizon ring. */
      rise: 8.4,
      /** World units the ground falls away past an open mouth. */
      fall: 3.4,
      /** Tiles over which a ridge tapers out as it approaches an open edge. */
      taper: 12,
      low: 0x63913f,   // wooded lower slope, matching the valley floor
      high: 0x6c6a55,  // weathered rock and scrub along the crest
      far: 0x93a8bf,   // the blue haze that stacks distant ridges
      skirt: 0x574b3a,
    },
  },
  {
    name: 'mesa',
    label: 'Mesa',
    /** There is no gap in a cliff you are standing on top of. */
    openable: false,
    band: {
      water: false,
      /**
       * NEGATIVE, and that is the whole form. Every other land band climbs away
       * from the map; this one drops, so the first thing past the last tile is
       * the top of a cliff and the horizon is a basin floor a long way down.
       */
      rise: -10.5,
      low: 0xc2a06f,   // sunlit caprock, right at the weld
      high: 0x8f6244,  // the red basin the mesa stands out of
      far: 0xc0ad93,   // dust, which is what distance looks like out here
      skirt: 0x4a3524,
    },
  },
  {
    name: 'caldera',
    label: 'Caldera',
    /** A rim with a mouth in it is a holler. The whole point here is that it has none. */
    openable: false,
    band: {
      water: false,
      /**
       * Steeper than a holler's walls, because a caldera's rim is not a
       * hillside that happens to be beside you -- it is the reason the place
       * is a bowl, and it has to read as unclimbable from anywhere in it.
       */
      rise: 13.0,
      low: 0x6f7a4c,   // scrub clinging to the inner rim
      high: 0x54483d,  // bare cinder along the crest
      far: 0x9aa0ae,
      skirt: 0x2f2a26,
    },
  },
  {
    name: 'fen',
    label: 'Fen',
    /** Water on all four sides, same as an island. */
    openable: false,
    band: {
      water: true,
      /**
       * Nearly three times an island's, and the difference is the point. A
       * beach falls away in a tile and a half; a fen goes on being ankle-deep
       * for as far as you can see, which is exactly why you cannot walk out.
       */
      shore: 3.2,
      near: 0x63805a,  // sedge standing in the shallows
      far: 0x3f5c4c,   // open water with the weed under it
      skirt: 0x22332c,
    },
  },
  {
    name: 'coast',
    label: 'Coast',
    openable: true,
    /** Which way the sea lies if the file does not say. */
    defaultOpen: ['south'],
    band: {
      water: false,
      /**
       * Gentle: this is the hinterland behind a shore, not a valley wall. Land
       * that climbed like a holler's would turn the beach into the bottom of a
       * pit and take the sky off three quarters of the frame.
       */
      rise: 5.2,
      /** Nothing falls away here -- past the open edge is the sea, not a drop. */
      fall: 0,
      taper: 11,
      low: 0x74a352,   // pasture, matching the fields inside the map
      high: 0x8b9a63,  // gorse and bracken up the shoulder
      far: 0xa8b6c6,
      skirt: 0x4b4433,
      /**
       * The sea, for the open edges. Its numbers are the island's, deliberately
       * -- a coast and an island are the same water seen from two places, and
       * two blues that nearly match would read as a bug in one of them.
       */
      sea: {
        shore: 1.4,
        near: 0x4093c9,
        far: 0x2c6791,
        skirt: 0x143a58,
      },
    },
  },
];


/** name -> form record. */
export const FORM_BY_NAME = Object.fromEntries(FORMS.map((f) => [f.name, f]));

export const FORM_NAMES = FORMS.map((f) => f.name);

export function formByName(name) {
  const f = FORM_BY_NAME[name];
  if (!f) throw new Error(`Unknown world form: "${name}"`);
  return f;
}
