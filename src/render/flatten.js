/**
 * The view morph, as a SHADING effect.
 *
 * The central realisation behind this project: a top-down orthographic view of
 * a 3D model already *is* that model's top-down map icon. The roof of the house
 * seen from directly overhead is the Pokemon-map house. So the two views need
 * exactly ONE representation of every object -- no paired 3D-mesh/2D-sprite,
 * no crossfade, and therefore no way for the two views to disagree about what
 * is in the world.
 *
 * What actually separates the looks is SHADING, not geometry:
 *
 *   t = 0   lit, shadowed, foggy, volumetric  -> Animal Crossing
 *   t = 1   flat unlit albedo, no shadow, no fog, crisp tile grid -> Pokemon
 *
 * plus a per-type vertical squash, because a tall tree seen from above hides
 * the tile it stands on. Squashing it to a disc restores the map read.
 *
 * IMPLEMENTATION NOTE: `flatUniform` is a single object shared BY REFERENCE
 * into every patched material's uniform set. One write per frame therefore
 * updates every material in the scene. Copying the value instead would mean
 * walking every material every frame.
 */

/** Shared morph amount. 0 = full 3D, 1 = full top-down. Write `.value` only. */
export const flatUniform = { value: 0 };

/**
 * Patch a standard three material so it participates in the morph.
 *
 * @param {THREE.Material} material
 * @param {number} squash  local-Y multiplier at t=1 (1 = no squash, 0.2 = flatten hard)
 */
export function patchFlatten(material, squash = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlat = flatUniform;          // shared by reference, on purpose
    shader.uniforms.uSquash = { value: squash };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uFlat;
        uniform float uSquash;
        attribute float aBaseY;`)
      // Props are batched into ONE mesh in world space, so a naive
      // `transformed.y *= squash` would collapse the whole town to y=0 and
      // sink everything standing on the raised terrace. Each vertex therefore
      // carries the ground height of the prop it belongs to, and we squash the
      // height ABOVE that base.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y = aBaseY + (transformed.y - aBaseY) * mix(1.0, uSquash, uFlat);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFlat;`)
      // `opaque_fragment` is where three writes gl_FragColor from outgoingLight
      // (chunk name is r152+; this project pins three ^0.185).
      .replace('#include <opaque_fragment>', `
        outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.04, uFlat);
        #include <opaque_fragment>`);
  };

  // Materials whose injected SOURCE differs must not share a compiled program.
  // Only `squash` varies the source's behaviour, so it is the whole cache key.
  material.customProgramCacheKey = () => `flatten:${squash}`;
  return material;
}

/** Shared clock for animated materials (water shimmer). Write `.value` only. */
export const timeUniform = { value: 0 };
