/** Deterministically adds shared service buildings to every exterior town. */

import { placeBuildingAtSafeSite } from './buildingPlacement.js';

const BUSINESSES = [
  ['business.internet-cafe', 'building.internet-cafe', 'Coffee Shop', 'worlds/interiors/internet-cafe.json'],
  ['business.clinic', 'building.clinic', 'Clinic & Pharmacy', 'worlds/interiors/doctors-office.json'],
];
const SERVICE_TYPES = new Set(BUSINESSES.map(([, type]) => type));
const SERVICE_CLEARANCE = 6;
const LANDMARK_CLEARANCE = 10;

function clearance(obj) {
  if (obj.id === 'cab.vehicle' || obj.type === 'building.townhall') return LANDMARK_CLEARANCE;
  return SERVICE_TYPES.has(obj.type) ? SERVICE_CLEARANCE : 0;
}

function place(world, spec, occupied) {
  const [id, type, label, interior] = spec;
  return placeBuildingAtSafeSite(world, {
    id, type, props: { label, interior }, occupied, clearance,
  });
}

export function addBusinessServices(world) {
  if (world.kind !== 'exterior' || BUSINESSES.every(([id]) => world.objectById(id))) return world;
  const occupied = new Set([
    ...world.npcs.map((npc) => world.idx(...npc.tile)),
    ...world.items.map((item) => world.idx(...item.tile)),
    ...world.exits.map((exit) => world.idx(...exit.tile)),
    world.idx(...world.spawn.tile),
  ]);
  for (const spec of BUSINESSES) {
    if (world.objectById(spec[0]) || place(world, spec, occupied)) continue;
    console.warn(`[business] no site found for "${spec[2]}" in "${world.meta.name}"`);
  }

  // Loader-added businesses are baseline objects, just like the shared cab.
  world.authoredObjectCount = world.objects.length;
  for (const [id] of BUSINESSES) {
    const obj = world.objectById(id);
    if (!obj) continue;
    world.baseObjectTiles.set(id, [...obj.tile]);
    world.baseObjectRotations.set(id, obj.rotation ?? 0);
  }
  return world;
}
