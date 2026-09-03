// DJ Halcyon's booth on The Skydeck. Five coins in the jar buys you a moment.
//
// Sandbox script: `state`, random(), coins(), has(), room(), give(), take(),
// earn(), spend(), say(). Proposed, not performed -- the host applies the list
// only if this ran to the end. The fixture's `when` has already found the five
// coins.

state.tips = (state.tips || 0) + 1;
var n = state.tips;
var roll = random();

spend(5);

if (n === 1) {
  say('Halcyon catches the coins without looking, nods once, and the bass drops so hard the fire bowls flinch.');
} else if (n === 10) {
  say('Ten tips. Halcyon points at you across the deck and mouths "MY PERSON". The crowd has no idea what is happening.');
} else if (n % 25 === 0) {
  say('Tip number ' + n + '. There is now a track on the setlist named after you. It is mostly kick drum.');
}

if (roll < 0.10) {
  earn(5);
  say('Halcyon flicks the coins straight back. "Not tonight. Tonight you dance for free."');
} else if (roll < 0.28) {
  say('The build climbs, and climbs, and Halcyon holds it there for eight bars too long on purpose. Then: the drop. Marguerite screams.');
} else if (roll < 0.46) {
  say('A slow one. The searchlight sweeps across the helicopter and for a second the whole rooftop is silver. Somebody proposes to somebody.');
} else if (roll < 0.62) {
  say('Halcyon scratches the record back, twice, and grins. "That one was for the pilot. He hates it."');
} else if (roll < 0.78) {
  say('The pad lights start pulsing in time with the kick. Nobody wired them to do that. Halcyon will not say how.');
} else if (roll < 0.9) {
  say('Juniper turns the bar lights down to nothing but the blue strip. The song is called "Eleven Floors Up". It is about this.');
} else {
  say('Halcyon leans into the mic: "Skydeck. If you can hear me, you are in the coolest room in the county. Act like it."');
}
