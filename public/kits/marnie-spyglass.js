// Marnie's spyglass, in the window bay of her cottage.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// She works both shores, and this is how. Every line is something she already
// knows and would rather you heard from the glass than from her -- which is the
// only way she has ever told anybody anything.

state.looks = (state.looks || 0) + 1;
var n = state.looks;
var roll = random();

if (n === 1) {
  say('The bay window looks two ways at once, which is either good luck or the reason she bought the house.');
  say('The glass is trained on the far shore and the focus has not been touched in a while.');
} else if (n === 5) {
  say('There are marks scratched in the brass at the focus ring. Five of them. Five things worth looking at.');
} else if (n % 14 === 0) {
  say('Look number ' + n + '. Either you are as bad as she is or you have run out of things to do.');
}

if (roll < 0.12 && room('item.shell', 1)) {
  give('item.shell', 1);
  say('There is a good one on the tideline down there, and by the time you look up you are holding it.');
} else if (roll < 0.24) {
  earn(6);
  say('A coin is wedged under the tripod foot, keeping it level. You take it and it stays level anyway.');
} else if (roll < 0.40) {
  say('Somebody is out on the far sand, walking a line and picking things up. They stop when the glass finds them.');
} else if (roll < 0.54) {
  say('Weather coming in from the north, an hour out, and nobody down there has noticed it yet.');
} else if (roll < 0.68) {
  say('A boat you do not recognise, moored where nobody moors. It has been there long enough to swing with the tide.');
} else if (roll < 0.82) {
  say('Two birds arguing over the same stretch of nothing. You watch it out. The smaller one wins.');
} else {
  say('Nothing but the shine off the flat, which is the answer most days and is what makes the other days worth it.');
}
