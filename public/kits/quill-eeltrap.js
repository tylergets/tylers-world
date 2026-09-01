// Quill's eel trap, hanging through the hole in his floor.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// The hut stands over the fen on posts and he cut a hole in his own floor
// rather than walk twenty feet. That is the entire man, and this is the object
// that says it.

state.hauls = (state.hauls || 0) + 1;
var n = state.hauls;
var roll = random();

if (n === 1) {
  say('The rope comes up cold and green and heavier than it looks. Everything down there is heavier than it looks.');
  say('He cut this hole in his own floor rather than walk to the bank. You would too, in the end.');
} else if (n === 4) {
  say('There are notches cut in the rail, one for every good haul. There are not many notches.');
} else if (n % 12 === 0) {
  say('Haul ' + n + '. The water under the floor has not once been the same colour twice.');
}

if (roll < 0.20 && room('item.flower', 2)) {
  give('item.flower', 2);
  say('Marsh marigold has grown clean through the weave of the basket. You pick it out rather than break it.');
} else if (roll < 0.34 && room('item.mushroom', 1)) {
  give('item.mushroom', 1);
  say('Something pale has taken up residence on the underside of the trap. It is a mushroom, technically.');
} else if (roll < 0.44) {
  earn(16);
  say('An eel, and a good one, and it goes straight back in -- but there is a coin in the bottom of the trap and that stays with you.');
} else if (roll < 0.62) {
  say('Weed, weed, a stick, and the confident silence of a trap that has caught nothing.');
} else if (roll < 0.80) {
  say('You lower it back and it goes down through its own reflection and keeps going.');
} else {
  say('Something bumps the basket on the way up and lets go. It always does that and it is never anything.');
}
