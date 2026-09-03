// A slot machine on the floor of The Lucky Seven.
//
// Sandbox script: `state`, random(), coins(), has(), room(), give(), take(),
// earn(), spend(), say(). Nothing is applied until the script finishes, so a
// pull that throws costs nothing. The fixture's `when` has already made sure
// there are ten coins to take.
//
// The house edge is real and the jackpot is real: every pull feeds `state.pool`
// and a one-in-fifty roll pays the whole pool out. Because the state is saved
// per machine, a machine nobody has hit in a while is genuinely worth more, and
// three machines side by side are three different bets.

state.pulls = (state.pulls || 0) + 1;
state.pool = (state.pool || 60) + 7;

spend(10);

var roll = random();
var a = Math.floor(random() * 4), b = Math.floor(random() * 4), c = Math.floor(random() * 4);
var faces = ['CHERRY', 'BELL', 'BAR', 'SEVEN'];
var reels = faces[a] + ' | ' + faces[b] + ' | ' + faces[c];

if (roll < 0.02) {
  var pool = Math.min(state.pool, 9999);
  earn(pool);
  say('SEVEN | SEVEN | SEVEN. Every light on the machine goes off at once. JACKPOT: ' + pool + ' coins pour into the tray.');
  state.pool = 60;
} else if (roll < 0.10) {
  earn(40);
  say('BAR | BAR | BAR. Forty coins rattle down. Sable glances over from the poker table and back again.');
} else if (roll < 0.24) {
  earn(18);
  say('BELL | BELL | ' + faces[c] + '. Two bells. Eighteen coins, which is almost your money back and feels like more.');
} else if (roll < 0.40) {
  earn(10);
  say('CHERRY | ' + faces[b] + ' | ' + faces[c] + '. One cherry. The ten coins come straight back, warmer than they went in.');
} else {
  say(reels + '. Nothing. The machine plays four cheerful notes about it anyway.');
}

if (state.pulls === 1) {
  say('A brass plate on the front reads: THE POOL GROWS WITH EVERY PULL. THE HOUSE THANKS YOU FOR YOUR OPTIMISM.');
} else if (state.pulls % 20 === 0) {
  say('Pull number ' + state.pulls + '. The pool on this machine stands at ' + state.pool + ' coins. Fingers has stopped pretending not to watch.');
}
