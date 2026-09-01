/**
 * Water, as three levels of the same shader.
 *
 * Water is the one surface in the world that is expensive to make convincing:
 * everything else is a flat colour with a bit of AO, but a lake reads as a lake
 * only when it MOVES and when it REFLECTS. Both are per-fragment work, and a
 * laptop that renders the town at 60fps can still fall over on a place that is
 * half open sea. So the look is a player preference, not a constant.
 *
 *   0  plain     the tile's colour, still. Costs one branch.
 *   1  ripples   the crossed travelling waves this project always had.
 *   2  sunlit    a surface: a five-train swell with an analytic normal, sky
 *                reflection, sun glint, whitecaps, depth, glitter, caustics.
 *
 * WHY A UNIFORM AND NOT THREE MATERIALS
 * -------------------------------------
 * The level is a uniform the branches read, so switching it costs one number
 * and never recompiles a shader or rebuilds a mesh -- the same bargain the
 * shoreline preference makes. `uWaterQuality` is uniform across the draw, so
 * the branch is uniform control flow and the GPU skips the untaken side whole;
 * only fragments that are actually water pay for level 2 at all.
 *
 * The sun and sky arrive as uniforms rather than being read from three's light
 * list, because the glint and the reflection have to agree with the sky the
 * player can see behind the water -- and that sky is the place's ambience,
 * which the Stage already owns and lerps as the view morphs.
 */

import * as THREE from 'three';

/** How many levels there are, so callers can clamp without a magic number. */
export const WATER_LEVELS = 3;

/**
 * Shared by reference into the terrain material, like `flatUniform`: one write
 * per frame updates the shader, with no walk over materials and no recompile.
 */
export const waterUniforms = {
  /** 0 plain, 1 ripples, 2 sunlit. Whole numbers only; the shader compares. */
  quality: { value: 2 },
  /** World-space direction from the surface TOWARDS the sun. */
  sun: { value: new THREE.Vector3(-0.5, 0.79, 0.35) },
  sunColor: { value: new THREE.Color(0xfff2d8) },
  /** What the water reflects: the place's current sky. */
  sky: { value: new THREE.Color(0xbfe0f5) },
};

/**
 * Top-level declarations the terrain fragment shader needs for the water.
 *
 * `swell` is the whole trick. Adding sines gives a surface whose slope you
 * already know -- the derivative of a sine is another sine, in hand for free --
 * so the normal is exact and costs no normal map, no second pass and no texture
 * fetch. `sharp` bends each train into an exponential sine: rounded troughs and
 * pinched crests, which is what a real swell does and what a plain sine will
 * never do however many of them you add.
 */
export const WATER_FRAGMENT_HEAD = /* glsl */`
  uniform float uWaterQuality;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;

  void swell(inout float h, inout vec2 slope, vec2 p, vec2 dir,
             float freq, float amp, float speed, float sharp, float t) {
    float phase = dot(p, dir) * freq + t * speed;
    float e = exp(sharp * (sin(phase) - 1.0));
    h += amp * e;
    slope += dir * (amp * freq * sharp * cos(phase) * e);
  }`;

/**
 * The water body of the terrain fragment shader.
 *
 * Expects `vWater` (1 on liquid tiles), `vShore` (per-corner proximity to a
 * sand edge, so 1 means shallow), `vWorldPos`, `uTime`, and three's built-in
 * `cameraPosition`. Writes `outgoingLight`.
 *
 * Injected BEFORE the flatten morph, which is what makes the top-down map fall
 * back to plain albedo on its own: a mirror-bright glint drawn on a map icon
 * would read as a rendering fault rather than as sunlight.
 */
export const WATER_FRAGMENT = /* glsl */`
  if (vWater > 0.0 && uWaterQuality > 0.5) {
    vec2 wp = vWorldPos.xz;

    if (uWaterQuality < 1.5) {
      // Level 1: crossed travelling waves. Cheap, and enough to keep water alive.
      float s1 = sin(wp.x * 1.5 + wp.y * 0.9 + uTime * 1.3) * 0.5 + 0.5;
      float s2 = sin(wp.x * 0.7 - wp.y * 1.9 - uTime * 0.9) * 0.5 + 0.5;
      outgoingLight += pow(s1 * s2, 2.0) * 0.14;
    } else {
      // -- level 2: a surface, not a tint ---------------------------------
      //
      // The fine trains carry the sparkle, and at distance one screen pixel
      // covers several of their wavelengths -- which is not detail any more,
      // it is aliasing that crawls as the camera moves. So they fade out with
      // range and the big swell carries the far water on its own.
      float fade = 1.0 - smoothstep(14.0, 52.0, length(cameraPosition - vWorldPos));

      // Five trains. No two share a direction, a period or a speed, so the
      // interference never repeats inside a pond and the surface never reads
      // as the corduroy that two crossed sines give you.
      float h = 0.0;
      vec2 slope = vec2(0.0);
      swell(h, slope, wp, vec2( 0.86,  0.51),  1.30, 0.088,  0.85, 2.6, uTime);
      swell(h, slope, wp, vec2(-0.42,  0.91),  2.15, 0.052, -1.25, 2.3, uTime);
      swell(h, slope, wp, vec2( 0.72, -0.69),  3.70, 0.027,  1.80, 2.0, uTime);
      swell(h, slope, wp, vec2(-0.95, -0.31),  7.30, 0.013 * fade, -2.45, 1.8, uTime);
      swell(h, slope, wp, vec2( 0.28,  0.96), 12.90, 0.006 * fade,  3.05, 1.6, uTime);

      vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
      vec3 V = normalize(cameraPosition - vWorldPos);
      vec3 R = reflect(-V, N);
      float NdotH = max(dot(N, normalize(uSunDir + V)), 0.0);

      // Depth. Only the shore band knows where land is, so open water sits at
      // full depth and reads cold and dense, while the tiles touching a beach
      // stay light and green. Without this a lake is one flat blue however
      // big it is, which is the single most model-kit thing water can do.
      float deep = 1.0 - vShore;
      outgoingLight *= mix(vec3(1.10, 1.04, 0.94), vec3(0.30, 0.55, 0.80), deep * 0.8);

      // The reflection. Fresnel first: a near-vertical view looks INTO the
      // water and sees its colour, a grazing one sees the sky bounce off it --
      // which is why this costs nothing on the overhead map, where the view is
      // vertical and the term falls to zero by itself. Then the sky is not one
      // colour: it pales towards the horizon, so the reflected ray's pitch
      // picks the shade. That gradient, riding on the wave normals, is what
      // turns a flat wash into a surface that glitters as it tilts.
      float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
      vec3 sky = mix(uSkyColor * 1.45, uSkyColor * 0.72, clamp(R.y, 0.0, 1.0));
      outgoingLight = mix(outgoingLight, sky, fres * 0.74);

      // The glint, in two lobes: a very tight one for the sun's own disc on
      // the wave faces, and a broad soft one for the sheen around it. One lobe
      // alone reads either as a laser or as fog.
      outgoingLight += uSunColor * (pow(NdotH, 600.0) * 3.4 + pow(NdotH, 70.0) * 0.30);

      // Glitter, kept OUT of the normal: at this frequency it would only turn
      // the swell to mush, but as pinpoints it is the sparkle that sells
      // sunlight on water.
      //
      // Two sines alone lay their peaks on a LATTICE, and a lattice of white
      // dots reads as a dither screen laid over the pond rather than as light.
      // Warping the sample point by the swell's own slope drags that lattice
      // about with the waves, which is enough to break the grid -- and it puts
      // the sparks on the wave faces, which is where they belong anyway.
      // Sharp exponents and a tight lobe keep them as points inside the sun's
      // reflection instead of a wash across the whole surface.
      vec2 gp = wp + slope * 3.4;
      float g = sin(dot(gp, vec2( 0.94,  0.34)) * 21.7 + uTime * 3.10)
              * sin(dot(gp, vec2(-0.31,  0.95)) * 26.3 - uTime * 2.30);
      outgoingLight += uSunColor * pow(max(g, 0.0), 26.0) * pow(NdotH, 24.0) * 3.4 * fade;

      // Whitecaps. The steepest slope IS the crest -- that is what pinching
      // the sine did -- so foam needs no second field to tell it where to go.
      float steep = smoothstep(0.20, 0.52, length(slope));
      outgoingLight = mix(outgoingLight, vec3(0.94, 0.97, 0.98), steep * 0.34 * fade);

      // Caustics: light the crests focus onto a sandy bottom. Only shallow
      // water has a bottom close enough for it, hence the (1 - deep) gate.
      float caustic = pow(clamp(h * 6.5, 0.0, 1.0), 3.0);
      outgoingLight += vec3(0.55, 0.74, 0.60) * caustic * (1.0 - deep) * 0.22;
    }
  }`;
