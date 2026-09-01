// Tobin's brass orrery.
//
// Sandbox script. See kits/fountain.js for the verbs it is allowed.
//
// The one thing in his house he made for no reason, and the only way to find
// that out is to wind it, because he will not say so. Every so often the
// mainspring throws a coin out of the case, which is where his change goes.

state.winds = (state.winds || 0) + 1;
var n = state.winds;
var roll = random();

if (n === 1) {
  say('The key takes six turns and gets tighter about the fifth. Then the whole sky starts moving, very slowly.');
  say('Nothing on it is labelled. He knows which one is which.');
} else if (n === 2) {
  say('It runs about a minute to the turn. He has not built anything since that keeps that kind of time.');
} else if (n % 10 === 0) {
  say('Wind ' + n + '. The small pale one has been round more times than you have been in this house.');
}

if (roll < 0.10) {
  earn(9);
  say('A coin drops out of the case and rolls under the bench. You keep it. He would insist.');
} else if (roll < 0.24 && room('item.stick', 1)) {
  give('item.stick', 1);
  say('A shaped dowel falls out of the works. It was doing something in there and now it is not.');
} else if (roll < 0.44) {
  say('The arms come round and very nearly agree with each other, then think better of it.');
} else if (roll < 0.62) {
  say('Something inside it ticks twice for every turn, which is either the point or the fault.');
} else if (roll < 0.80) {
  say('A brass ring goes over, then under, then over. You lose about a minute to it.');
} else {
  say('It winds down mid-sweep and stops with the pale one halfway home. It always stops there.');
}
