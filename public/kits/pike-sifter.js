// Pike's sand sifter, on Rimrock Mesa.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// He makes a living out of the fact that sand gets into everything, and this is
// the machine that gets it back out. What it hands over is mostly pebbles,
// because sand is what a mesa has instead of soil.

state.turns = (state.turns || 0) + 1;
var n = state.turns;
var roll = random();

if (n === 1) {
  say('The drum takes a while to come up to speed and then keeps going long after you stop. That is deliberate.');
} else if (n === 3) {
  say('The pan underneath is scratched through to bare metal in one arc. Fourteen years of the same arc.');
} else if (n % 13 === 0) {
  say('Turn ' + n + '. The pile by the leg is measurably bigger than when you came in.');
}

if (roll < 0.32 && room('item.stone', 2)) {
  give('item.stone', 2);
  say('Two pebbles come out the low end, sand-blasted round. Up here that is what a stone looks like.');
} else if (roll < 0.44) {
  earn(11);
  say('Something metal rings on the pan. A coin, worn nearly smooth, and it has been in that drum a while.');
} else if (roll < 0.58 && room('item.stick', 1)) {
  give('item.stick', 1);
  say('A juniper peg, split clean. It does not warp, he says, and it has not.');
} else if (roll < 0.74) {
  say('Grit through the mesh, grit on the floor, grit in the air. The trade in one revolution.');
} else if (roll < 0.88) {
  say('The crank has a flat worn into the handle exactly where a hand goes. Not your hand.');
} else {
  say('You turn it until it turns itself, then stand and listen to it wind down. It takes longer than you expect.');
}
