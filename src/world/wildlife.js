/**
 * The wildlife each town takes in, two of each, when the settlers arrive.
 *
 * One table, two callers. `tools/genhomes.mjs` reads it when it settles a
 * shipped town, and `world/generate.js` reads it when the game lays out a
 * fresh one -- which is why it lives here rather than in tools/: a generated
 * holler with no boar in it is a holler that quietly lies about what kind of
 * place it is. Keyed by the RECIPE's town name, because the roster is part of
 * the recipe's identity the same way its cast is.
 */
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
