// The cold hearth in The Old Place.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// Nothing else in this house moves, and nothing in this kit animates, on
// purpose: it is the only interior in the game with nobody in it, and the
// silence is the content. What the ashes hold is the story of whoever left.

state.rakes = (state.rakes || 0) + 1;
var n = state.rakes;
var roll = random();

if (n === 1) {
  say('Cold all the way down, and deeper than a hearth ought to be. Whoever banked this fire banked it for a long night.');
} else if (n === 2) {
  say('Under the ash there is a flagstone with a groove worn into it by a chair leg. One chair.');
} else if (n % 16 === 0) {
  say('Rake ' + n + '. There is nothing left in here and you know it.');
}

if (!state.found && n >= 3) {
  state.found = true;
  earn(45);
  say('Something metal turns over in the ash. A small purse, and the leather has gone, and the coins have not.');
  say('Nobody is going to come back for it. You are fairly sure of that.');
} else if (roll < 0.16 && room('item.stone', 1)) {
  give('item.stone', 1);
  say('A pebble out of the ash, cracked clean through by heat. Somebody kept it on the mantel for a reason.');
} else if (roll < 0.30 && room('item.stick', 1)) {
  give('item.stick', 1);
  say('A stick of kindling, still dry after all this. You take it.');
} else if (roll < 0.48) {
  say('Grey the whole way through. No coals, no clinker -- this fire went out in its own time.');
} else if (roll < 0.66) {
  say('A pot hook still on the crane, and no pot. Whoever went took the pot.');
} else if (roll < 0.84) {
  say('Bird bones in the flue, a long way up. The chimney has been the birds\' for years.');
} else {
  say('The ash settles back over the mark you made in it. It has had plenty of practice.');
}
