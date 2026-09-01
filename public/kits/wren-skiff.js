// The half-mended skiff in Wren's cabin.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// A boat upside down on a cabin floor is a place things go under and are not
// found again for a season, which is the whole joke: what you get back is
// occasionally a shell and mostly an inventory of Wren.

state.looks = (state.looks || 0) + 1;
var n = state.looks;
var roll = random();

if (n === 1) {
  say('Cold under there, and it smells of tar and low tide. Two feet of dark you cannot see the end of.');
} else if (n === 3) {
  say('There is a name painted on the inside of the hull. It has been painted over, and then painted again.');
} else if (n % 15 === 0) {
  say('You have now looked under this boat ' + n + ' times. It has never once been the answer.');
}

if (roll < 0.22 && room('item.shell', 1)) {
  give('item.shell', 1);
  say('A shell, well back where the light stops. Somebody put it there on purpose.');
} else if (roll < 0.36 && room('item.stone', 1)) {
  give('item.stone', 1);
  say('A pebble worn flat as a coin. Ballast, or a keepsake, or both.');
} else if (roll < 0.46 && room('item.stick', 1)) {
  give('item.stick', 1);
  say('A cracked oar peg. No use to her now.');
} else if (roll < 0.62) {
  say('A caulking iron, a half tin of tar, and one boot. Not a pair -- one.');
} else if (roll < 0.76) {
  say('The plank on the port side is new and pale. The one beside it is neither.');
} else if (roll < 0.90) {
  say('Sand. Rather a lot of it, given the boat has not been in the water since spring.');
} else {
  say('Something scuttles further under and waits for you to lose interest. You do.');
}
