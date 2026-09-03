// The roulette wheel at The Lucky Seven. Red only: the house keeps it simple
// and keeps the green.
//
// Sandbox script; see casino-slot.js for the verbs. The fixture's `when` has
// already checked for the twenty-coin stake.

state.spins = (state.spins || 0) + 1;
spend(20);

var roll = random();
var pocket = Math.floor(random() * 37);

if (roll < 0.473) {
  earn(40);
  state.streak = (state.streak || 0) + 1;
  say('The ball hops, settles... RED ' + (pocket || 1) + '. Forty coins slide back across the felt.');
  if (state.streak === 3) say('Three reds running. The Baroness raises one eyebrow, which for her is a standing ovation.');
  if (state.streak >= 5) say('Streak of ' + state.streak + '. Brick has moved a little closer to the table. Purely coincidence.');
} else if (roll < 0.50) {
  state.streak = 0;
  say('The ball drops into the GREEN ZERO. The whole table exhales. The house takes everything, and looks sorry about it, briefly.');
} else {
  state.streak = 0;
  say('BLACK ' + (pocket || 2) + '. Twenty coins gone. The wheel keeps turning as if nothing happened, which is its whole job.');
}

if (state.spins === 1) {
  say('Sable, without looking up from the poker table: "Red pays even. Zero pays the house. Everybody knows that and everybody bets anyway."');
}
