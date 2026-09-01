// The bell in Sennen's cottage, on the Bellrock coast.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// The house is halfway up the hill and halfway down to the sea, and it has a
// bell in it because somebody has to be the one who tells both halves of the
// town the same thing at the same time. He is very pleased about this.

state.rings = (state.rings || 0) + 1;
var n = state.rings;
var roll = random();

if (n === 1) {
  say('One pull, and the whole coast hears it. The hill sends it back about a second later, slightly wrong.');
  say('That second is why the house is here. Sennen has explained this to everybody, twice.');
} else if (n === 2) {
  say('Someone down at the water rings something back. A pan, by the sound of it. Not a serious instrument.');
} else if (n === 5) {
  say('Five. Somewhere up the hill a dog has started answering, which Sennen counts as the town agreeing.');
} else if (n % 9 === 0) {
  say('Ring ' + n + '. Half the coast now knows exactly where you are standing.');
}

if (roll < 0.12) {
  earn(12);
  say('Coins in the frame, wedged under the yoke to stop it singing between rings. One works loose.');
} else if (roll < 0.24 && room('item.shell', 1)) {
  give('item.shell', 1);
  say('A shell on the plinth, put there so long ago it has left a mark. You take it and the mark stays.');
} else if (roll < 0.42) {
  say('The note goes out over the water, comes back off the hill, and the two of them argue for a moment.');
} else if (roll < 0.60) {
  say('Sea first, hill second, always. He timed it once with a candle and has never let it go.');
} else if (roll < 0.78) {
  say('You catch the bell with your hand and the whole house stops. That is louder than the ring was.');
} else {
  say('A thin, unserious ring -- you pulled too gently. Somewhere down the road somebody laughs.');
}
