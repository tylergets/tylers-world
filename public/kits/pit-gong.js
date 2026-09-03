// The Pit's fight gong.
//
// Sandbox script: `state`, random(), coins(), has(), room(), give(), take(),
// earn(), spend(), say(). Nothing here happens until the script has finished,
// and then it all happens at once -- see src/script/Sandbox.js.
//
// The gong does not START the fight. Drawing a gun in the ring does that, and
// it is the fighters who answer. What the gong does is set the mood, and now
// and then shake loose a coin somebody flicked at it years ago.

state.rung = (state.rung || 0) + 1;
var n = state.rung;
var roll = random();

if (n === 1) {
  say('BWONNNG. The whole room turns round. Somebody in the stands yells "FINALLY."');
} else if (n === 3) {
  say('Three rings. The fighters have started stretching without being asked.');
} else if (n === 10) {
  say('Ten rings. The brass has a dent in it exactly the shape of your fist. Tradition, apparently.');
} else if (n % 25 === 0) {
  say('Ring number ' + n + '. Knuckles has started calling you "the bell kid".');
}

if (roll < 0.10) {
  earn(6);
  say('A coin drops out from behind the gong. Somebody threw it at a fighter, missed, and it has been up there since.');
} else if (roll < 0.22) {
  say('The note hangs in the smoke. Tiny nods at you very slowly. That is the most he has said to anyone all week.');
} else if (roll < 0.36) {
  say('"HOUSE RULES," the Widow calls out without looking up. "You draw, we draw. You put all three of us on the sand, the house pays."');
} else if (roll < 0.50) {
  say('Chalk dust shakes off the tally board. Most of the marks under HOUSE are recent.');
} else if (roll < 0.64) {
  say('The braziers gutter and then roar back. The gong is louder than it has any right to be.');
} else if (roll < 0.78) {
  say('Somebody in the bleachers starts a slow clap. Nobody joins in. The clap keeps going anyway.');
} else if (roll < 0.90) {
  say('Stitch checks his needle kit before the sound has even faded. He knows what a gong means for business.');
} else {
  say('Knuckles cracks his neck, left then right. "Whenever you are ready, bell kid."');
}
