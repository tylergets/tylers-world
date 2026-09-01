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
];

/** name -> form record. */
export const FORM_BY_NAME = Object.fromEntries(FORMS.map((f) => [f.name, f]));

export const FORM_NAMES = FORMS.map((f) => f.name);

export function formByName(name) {
  const f = FORM_BY_NAME[name];
  if (!f) throw new Error(`Unknown world form: "${name}"`);
  return f;
}
