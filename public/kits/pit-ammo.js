// The house BB crate in The Pit.
//
// Sandbox script; see pit-gong.js for the verbs. The `when` on the fixture has
// already checked there is room in the bag for at least one BB, so a grab can
// never propose something the host will refuse.
//
// Free ammunition, but stingy: the ring wants you fighting, not stockpiling.
// Every fifth handful is a generous one because the crate has just been topped
// up, and the rest of the time it is whatever is left at the bottom.

state.grabbed = (state.grabbed || 0) + 1;
var n = state.grabbed;
var roll = random();

if (n % 5 === 0) {
  give('item.shot', 8);
  say('The crate has just been refilled. A proper handful: eight BBs, still cold from the box.');
} else if (roll < 0.62) {
  give('item.shot', 4);
  say('Four BBs, scooped from the bottom of the crate with a good deal of sawdust.');
} else if (roll < 0.86) {
  give('item.shot', 2);
  say('Two BBs. The rest of the handful is grit, splinters and one tooth you decide not to think about.');
} else {
  say('Nothing but sawdust. Ledger sells the real thing at the counter and he knows it.');
}

if (n === 1) {
  say('A sign on the lid, in chalk: HOUSE BBs. FOR THE RING. NOT FOR THE CHICKENS.');
}
