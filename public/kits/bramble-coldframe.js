// Bramble's cold frame.
//
// Sandbox script -- fetched as text, run in QuickJS with only the verbs listed
// at the top of kits/fountain.js. No window, no console, no Math.random.
//
// It is a seed frame, so what it gives back is what a seed frame gives back:
// mostly nothing, occasionally a mushroom out of the shady end, and now and
// then a flower that was not sown on purpose. The lines are the point -- this
// is the one object in Bramble's house that talks about Bramble.

state.lifted = (state.lifted || 0) + 1;
var n = state.lifted;
var roll = random();

if (n === 1) {
  say('The glass is warmer than the room. Underneath, a dozen small green arguments about which way is up.');
} else if (n === 4) {
  say('Someone has written the date on the inside of the glass in soil. Twice, and disagreed with themselves.');
} else if (n % 12 === 0) {
  say('Lift number ' + n + '. Whatever is in here has stopped being surprised by you.');
}

if (roll < 0.26 && room('item.mushroom', 1)) {
  give('item.mushroom', 1);
  say('One has come up in the shady corner that Bramble did not sow. You take it before he sees.');
} else if (roll < 0.44 && room('item.flower', 1)) {
  give('item.flower', 1);
  say('A wildflower, right in the middle of the seed tray, brazen about it. You pick it.');
} else if (roll < 0.52) {
  say('Damp soil, and a smell like rain on a hot path. Nothing ready.');
} else if (roll < 0.68) {
  say('Two rows of seedlings, leaning hard at the glass. You turn the tray round for him.');
} else if (roll < 0.84) {
  say('A snail has got in and made a very slow decision about the lettuce. You put it out.');
} else {
  say('Nothing doing yet. You lower the glass gently, the way he would.');
}
