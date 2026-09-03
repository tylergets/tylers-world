// The vending machine in Sub-Level 9. Eight coins, one can of VOLT.
//
// Sandbox script; see bunker-exploit.js for the verbs. The fixture's `when`
// has already checked the coins. The room in the bag is checked HERE and not
// in `when`, because the can is defined in this same kit and a kit's `when` is
// validated before its own items are registered.

if (!room('kititem.volt-can', 1)) {
  say('The machine hums, considers your full pockets, and declines to take your money. Which is more than most machines would do.');
} else {
  spend(8);
  give('kititem.volt-can', 1);

  var roll = random();
  if (roll < 0.08) {
    give('kititem.volt-can', 1);
    say('THUNK. Then, after a thoughtful pause, THUNK again. Two cans. The machine has always liked you.');
  } else if (roll < 0.2) {
    say('The can gets stuck, you kick the glass, and MOTHER says "please do not" from every speaker in the room. It drops.');
  } else if (roll < 0.5) {
    say('A can of VOLT. The label says TASTES LIKE UPTIME and has a lightning bolt on it that is, legally, not a trademark.');
  } else {
    say('THUNK. The can is cold enough to hurt. Patch swears it is the only reason anybody stays down here.');
  }
}
