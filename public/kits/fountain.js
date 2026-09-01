// The fountain's interaction.
//
// This file is NOT a module and is never imported. It is fetched as text and
// executed inside QuickJS-on-WebAssembly, whose globals are the handful of
// functions listed below and nothing else -- no window, no fetch, no console.
// See src/script/Sandbox.js.
//
//   READ    coins()                  how many coins the player is carrying
//           has(type, n)             true if the bag holds at least n
//           room(type, n)            true if the bag could take n more
//           random()                 seeded 0..1 -- see the note at the bottom
//
//   ASK     give(type, n)            put items in the bag
//           take(type, n)            remove items from the bag
//           earn(n) / spend(n)       coins
//           say(text)                one line, on screen
//
//   STATE   `state` is this fountain's own memory. Scalars only; it is saved.
//
// Nothing here happens when it is written. Every call above appends to a list,
// and the game applies that list only if this script runs to completion -- so a
// crash on the last line costs the player nothing.

spend(1);
state.wishes = (state.wishes || 0) + 1;

if (state.wishes === 1) {
  say('You drop a coin in. It turns over twice on the way down.');
} else if (state.wishes % 10 === 0) {
  say('Coin number ' + state.wishes + '. The water does not appear to be counting.');
} else {
  say('You drop a coin in and wish for something.');
}

// What the fountain gives back. `random()` is seeded by this fountain's id and
// by how many times it has been used, so the run of wishes is the same run on a
// reloaded save -- the rule every other piece of variety in this game follows
// (see src/core/rng.js). It is not Math.random, which does not exist in here.
var roll = random();

if (roll < 0.12 && room('item.shell', 1)) {
  give('item.shell', 1);
  say('Something pale is sitting on the bottom. You fish it out.');
} else if (roll < 0.2 && room('item.flower', 1)) {
  give('item.flower', 1);
  say('A wildflower is floating in the basin. It was not there a moment ago.');
} else if (state.wishes >= 5 && roll > 0.94) {
  earn(12);
  say('Your coin comes back up. With company.');
}
