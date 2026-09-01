// Nan's upright loom.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// It counts. That is the whole character of the thing: every press is a row,
// the rows do not reset, and the loom is the only thing in the game that keeps
// score of how long you have been coming round.

state.rows = (state.rows || 0) + 1;
var n = state.rows;
var roll = random();

if (n === 1) {
  say('The shuttle goes over easier than it looks. The beater comes down with a sound like a door closing somewhere else.');
  say('One row. She will know. She counts them in her sleep.');
} else if (n === 20) {
  say('Twenty rows. That is a hand span of cloth that was not there when you came in.');
} else if (n === 60) {
  say('Sixty. Whatever this is going to be, it is going to be it soon.');
} else if (n % 25 === 0) {
  say('Row ' + n + '. The red band has come round again, which means you have done this too long.');
}

if (roll < 0.09) {
  earn(14);
  say('A coin has been sitting in the warp beam since before you were born. It comes out with the row.');
} else if (roll < 0.20 && room('item.flower', 1)) {
  give('item.flower', 1);
  say('A dried flower is pressed into the last hand span of cloth, keeping a place. You take it out.');
} else if (roll < 0.38) {
  say('The treadle sticks on the third tread and lets go on the fourth. She has never mentioned it.');
} else if (roll < 0.58) {
  say('Two threads have gone the wrong side of the shed. You leave them. She will find them.');
} else if (roll < 0.78) {
  say('The cloth is the colour of the hill in October and it is not an accident.');
} else {
  say('You beat the row home and the whole frame settles an inch, the way it has every day for forty years.');
}
