// The Moonwell itself.
//
// Sandbox script: `state`, random(), coins(), has(), room(), give(), take(),
// earn(), spend(), say(). Nothing here is performed until the script finishes.
//
// A fortune, always. And the well TRADES: drop a pebble in and it may hand a
// shell back, which is the only thing in the sanctum Hex will not explain.

state.gazed = (state.gazed || 0) + 1;
var n = state.gazed;
var roll = random();

var fortunes = [
  'The water shows you a door you have already walked through. It was the right one.',
  'Somebody is thinking about you right now. It is the cab driver. He wants his fare.',
  'You will find something you were not looking for, under something you were.',
  'The moon in the water is not the moon in the sky. Neither of them is worried about it.',
  'A stranger will become a friend. A chicken will become dinner. Both are foretold, only one is sad.',
  'Whatever you are planning for the Pit: bring more BBs than you think.',
  'The next thing you plant will grow. The thing after that, we should talk about.',
  'Red, then black, then red. The wheel at the Seven owes you nothing and knows it.',
  'You will be very rich, very briefly, on a Tuesday.',
  'The well shows a rooftop, a helicopter, and somebody dancing badly. It is you. You look happy.',
  'Deep in the water, a green light blinks. MOTHER says hello.',
  'Something you lost is in the pocket you have not checked.',
  'Sleep in your own bed tonight. The well is very clear about this and will not say why.',
  'Your reflection blinks a beat after you do. Hex says that is normal. Hex says a lot of things.',
  'The tide is coming in somewhere. That is always true, and it is always worth remembering.',
  'A door that is shut to you will open the moment you stop pushing on it and say hello instead.',
];
say(fortunes[Math.floor(random() * fortunes.length)]);

if (has('item.stone', 1) && roll < 0.55) {
  take('item.stone', 1);
  if (room('item.shell', 1) && random() < 0.7) {
    give('item.shell', 1);
    say('You let a pebble go. The water takes it without a ripple and, a moment later, floats a shell up in its place.');
  } else {
    say('You let a pebble go. The water keeps it. The glow deepens by exactly one pebble.');
  }
} else if (roll < 0.62) {
  earn(12);
  say('Coins lie on the bottom, silver and old. One rises to the surface and rests on the water until you take it. Twelve of it, in fact.');
} else if (roll < 0.72 && room('seed.flower', 1)) {
  give('seed.flower', 1);
  say('A seed drifts up from nowhere and turns slow circles on the surface. Hex says the well grows things. Hex does not say where.');
}

if (n === 1) {
  say('Carved into the rim, worn almost smooth: WHAT YOU GIVE THE WELL, THE WELL REMEMBERS.');
} else if (n === 7) {
  say('Seven gazes. Your reflection has started arriving before you do.');
} else if (n % 13 === 0) {
  say('Gaze number ' + n + '. The cats have stopped pretending they are not watching you do this.');
}
