// Vesper's signal lamp, on the far side of the Ashkettle caldera.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// She lives over here so the town is a thing she can look at. The lamp is the
// one piece of equipment in her house that points the other way, and the whole
// character of it is that nobody on the far shore ever answers.

state.lit = (state.lit || 0) + 1;
var n = state.lit;
var roll = random();

if (n === 1) {
  say('The wick takes on the second match. The shutter throws a hard bar of light straight across the water at the town.');
  say('Nobody over there is looking. She knows that. It is lit anyway.');
} else if (n === 2) {
  say('There is a code scratched into the inside of the shutter. Four signals. One of them is just her name.');
} else if (n === 7) {
  say('Seven. Somebody in the town has started leaving a light in a window on this side of their house. It might be nothing.');
} else if (n % 11 === 0) {
  say('Light number ' + n + '. The oil is going down faster than she pretends it is.');
}

if (roll < 0.14) {
  earn(8);
  say('A coin in the oil tray, put there to stop the tray rattling. It has been doing that job well.');
} else if (roll < 0.26 && room('item.stick', 1)) {
  give('item.stick', 1);
  say('A spare spill, cut long for reaching the wick. Take it, there are forty of them.');
} else if (roll < 0.46) {
  say('You work the shutter. Long, short, long. It is nobody\'s code but the water carries it anyway.');
} else if (roll < 0.64) {
  say('From here the town is eleven small lights and one big one, and the big one is the store.');
} else if (roll < 0.82) {
  say('The glass is smoked on the town side and clean everywhere else. It has only ever been aimed at one thing.');
} else {
  say('You turn the flame down to nothing and the caldera comes back, all of it at once. That is the trick of a lamp.');
}
