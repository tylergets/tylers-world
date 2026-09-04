import { fullDateLabel } from '../sim/Clock.js';

export const AIRPORT_WORLD_ID = 'airport.terminal';
export const AIRPORT_SECURITY_Z = 36;
export const BOARDING_EARLY_HOURS = 1;
export const BOARDING_LATE_HOURS = 0.5;

export const FLIGHT_DESTINATIONS = Object.freeze([
  {
    id: 'cloudbreak', name: 'Cloudbreak Cay', code: 'CBC', flight: 'TW 104', gate: 'A1',
    form: 'island', seed: 0x43424331, departure: 6.5, duration: 2.25, price: 420,
    swatch: 0x3d9fb5, note: 'Bright coves, high bluffs, and a town above the surf.',
  },
  {
    id: 'copperglass', name: 'Copperglass Mesa', code: 'CGM', flight: 'TW 218', gate: 'B1',
    form: 'mesa', seed: 0x43474d32, departure: 10.25, duration: 3.1, price: 560,
    swatch: 0xc4773d, note: 'A red tableland with long views over the desert floor.',
  },
  {
    id: 'moonfen', name: 'Moonfen', code: 'MNF', flight: 'TW 332', gate: 'A2',
    form: 'fen', seed: 0x4d4e4633, departure: 14, duration: 1.75, price: 380,
    swatch: 0x668d79, note: 'Lantern reeds, narrow channels, and silver evening fog.',
  },
  {
    id: 'sunspoke', name: 'Sunspoke Coast', code: 'SSC', flight: 'TW 446', gate: 'B2',
    form: 'coast', seed: 0x53534334, departure: 19.5, duration: 2.6, price: 490,
    swatch: 0xe09a45, note: 'A warm harbor backed by green downs and wind-bent pines.',
  },
]);

export const flightTicketType = (flight) => `item.ticket.${flight.id}`;
export const flightWorldUrl = (flight) => `flight:${flight.id}`;

export function hasFlightTicket(inventory) {
  return FLIGHT_DESTINATIONS.some((flight) => inventory.count(flightTicketType(flight)) > 0);
}

export function flightForId(id) {
  return FLIGHT_DESTINATIONS.find((flight) => flight.id === id) ?? null;
}

export function flightForGate(gate) {
  return FLIGHT_DESTINATIONS.find((flight) => flight.gate.toLowerCase() === String(gate).toLowerCase()) ?? null;
}

export function flightForUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('flight:')) return null;
  return flightForId(url.slice('flight:'.length));
}

export function formatFlightTime(hours) {
  const h = Math.floor(hours) % 24;
  const minutes = Math.round((hours - Math.floor(hours)) * 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function nextFlight(clock, flight) {
  let day = clock.day;
  const todayDeparture = day + flight.departure / 24;
  const late = BOARDING_LATE_HOURS / 24;
  if (clock.stamp > todayDeparture + late) day++;
  const stamp = day + flight.departure / 24;
  const untilHours = (stamp - clock.stamp) * 24;
  const boarding = day === clock.day
    && untilHours <= BOARDING_EARLY_HOURS
    && untilHours >= -BOARDING_LATE_HOURS;
  return {
    ...flight,
    ticketType: flightTicketType(flight),
    url: flightWorldUrl(flight),
    day,
    date: fullDateLabel(day),
    time: formatFlightTime(flight.departure),
    arrival: formatFlightTime((flight.departure + flight.duration) % 24),
    untilHours,
    boarding,
    status: boarding ? 'BOARDING' : day === clock.day ? 'ON TIME' : 'TOMORROW',
  };
}

export function flightSchedule(clock) {
  return FLIGHT_DESTINATIONS.map((flight) => nextFlight(clock, flight));
}
