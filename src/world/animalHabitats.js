import { animalType } from './animalTypes.js';
import { objectType } from './objectTypes.js';

/** Whether a tile satisfies the species' optional starting habitat. */
export function isAnimalSpawnTile(world, typeId, x, z) {
  const type = animalType(typeId);
  if (!type.swims && world.surfaceAt(x, z).name === 'concrete') return false;

  const habitat = type.habitat;
  if (!habitat) return true;

  const surfaces = habitat.surfaces ?? (habitat.surface ? [habitat.surface] : null);
  if (surfaces && !surfaces.includes(world.surfaceAt(x, z).name)) return false;

  if (habitat.outskirts !== undefined) {
    const edge = Math.min(x, z, world.width - 1 - x, world.height - 1 - z);
    if (edge > Math.min(world.width, world.height) * habitat.outskirts) return false;
  }

  if (habitat.buildingDistance !== undefined) {
    const distance2 = habitat.buildingDistance ** 2;
    for (const obj of world.objects) {
      if (world.felled?.has(obj.id) || objectType(obj.type).category !== 'building') continue;
      const [ax, az] = obj.tile;
      const dx = Math.max(ax - x, 0, x - (ax + obj.shape.w - 1));
      const dz = Math.max(az - z, 0, z - (az + obj.shape.d - 1));
      if (dx * dx + dz * dz < distance2) return false;
    }
  }

  return true;
}
