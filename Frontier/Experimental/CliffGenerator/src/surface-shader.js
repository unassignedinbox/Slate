// Procedural rock surface injected into MeshStandardMaterial (keeps Three's PBR lighting,
// shadows, environment and fog). Everything is analytic and world-space — no textures, no UVs.
//
// Layers (each contributes height + analytic gradient → one normal perturbation):
//   1. strata colour bands with geological dip, bed seams and oxide pockets
//   2. aggregate grain  — 3D value noise, analytic gradient
//   3. mineral flakes   — stacked cellular plates with tilt (the layered "flake" look)
//   4. exfoliation      — Voronoi sheets in three states: intact (joint cracks), lifting
//                          (tilted sheet with raised edge and shadowed underside), spalled
//                          (recessed fresh rock with a rim) — the "peeling rock" effect
//   5. cover            — runoff staining, scree gravel, vegetation, moss, snow
//
// Vertex aux = (deposit, flow, hardness, cavity) from the erosion pipeline (zeros on rocks).

import * as THREE from 'three';
import { palettes } from './params.js';

const vertexHead = /* glsl */`
attribute vec4 aux;
varying vec4 vAux;
varying vec3 vWorldPos;
`;

const vertexBody = /* glsl */`
{
  vec4 wp4 = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4;
  #endif
  vWorldPos = ( modelMatrix * wp4 ).xyz;
  vAux = aux;
}
`;

const fragmentHead = /* glsl */`
varying vec4 vAux;
varying vec3 vWorldPos;
uniform vec3 uRockA, uRockB, uRockC, uFresh, uOxide;
uniform float uStrataBand, uStrataContrast, uDipX, uDipZ;
uniform float uGrainSize, uGrainStrength;
uniform float uFlakeStrength, uFlakeScale;
uniform float uPeelStrength, uPeelScale, uPeelLift;
uniform float uWetness, uSnowLine, uSnowSlopeCos, uVegetation, uMossiness;
uniform float uSeaLevel, uSeed, uIsRock;

float cgHash( uvec3 q ) {
  uint h = q.x * 1597334677u ^ q.y * 3812015801u ^ q.z * 2798796415u;
  h = ( h ^ ( h >> 16u ) ) * 2246822519u;
  h = ( h ^ ( h >> 13u ) ) * 3266489917u;
  return float( h ^ ( h >> 16u ) ) / 4294967295.0;
}
float cgHash2( ivec2 c, float seed ) { return cgHash( uvec3( ivec3( c, int( seed * 7.0 ) + 1000 ) ) ); }
float cgHash3( ivec3 c ) { return cgHash( uvec3( c + ivec3( 4096 ) ) ); }

// 3D value noise with analytic gradient: (value, dx, dy, dz)
vec4 cgNoise3( vec3 p ) {
  ivec3 cell = ivec3( floor( p ) );
  vec3 f = fract( p );
  vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec3 du = 30.0 * f * f * ( f * ( f - 2.0 ) + 1.0 );
  float a = cgHash3( cell ), b = cgHash3( cell + ivec3( 1, 0, 0 ) );
  float c = cgHash3( cell + ivec3( 0, 1, 0 ) ), d = cgHash3( cell + ivec3( 1, 1, 0 ) );
  float e = cgHash3( cell + ivec3( 0, 0, 1 ) ), f1 = cgHash3( cell + ivec3( 1, 0, 1 ) );
  float g = cgHash3( cell + ivec3( 0, 1, 1 ) ), h = cgHash3( cell + ivec3( 1, 1, 1 ) );
  float ab = mix( a, b, u.x ), cd = mix( c, d, u.x ), ef = mix( e, f1, u.x ), gh = mix( g, h, u.x );
  float lower = mix( ab, cd, u.y ), upper = mix( ef, gh, u.y );
  vec3 grad = vec3(
    mix( mix( b - a, d - c, u.y ), mix( f1 - e, h - g, u.y ), u.z ),
    mix( cd - ab, gh - ef, u.z ),
    upper - lower ) * du;
  return vec4( mix( lower, upper, u.z ), grad );
}
vec4 cgFbm3( vec3 p, int octaves ) {
  vec4 sum = vec4( 0.0 );
  float amp = 0.5, freq = 1.0, norm = 0.0;
  for ( int o = 0; o < 5; o++ ) {
    if ( o >= octaves ) break;
    vec4 n = cgNoise3( p * freq + float( o ) * 17.3 );
    sum += vec4( n.x, n.yzw * freq ) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
}

// ---- exfoliation sheets --------------------------------------------------------------------
struct PeelOut { float h; vec2 g; float fresh; float crack; float occl; };
PeelOut peelLayer( vec2 p, float scale, float lift, float aa, float seed ) {
  PeelOut o; o.h = 1.0; o.g = vec2( 0.0 ); o.fresh = 0.0; o.crack = 0.0; o.occl = 0.0;
  vec2 q = p / scale;
  ivec2 cell = ivec2( floor( q ) );
  vec2 f = fract( q );
  float F1 = 8.0, F2 = 8.0;
  vec2 d1 = vec2( 0.0 ), d2 = vec2( 0.0 );
  ivec2 id1 = cell;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    ivec2 c = cell + ivec2( x, y );
    vec2 centre = vec2( x, y ) + vec2( cgHash2( c, seed ), cgHash2( c, seed + 1.0 ) );
    vec2 d = f - centre;
    float dist = length( d );
    if ( dist < F1 ) { F2 = F1; d2 = d1; F1 = dist; d1 = d; id1 = c; }
    else if ( dist < F2 ) { F2 = dist; d2 = d; }
  }
  float b = F2 - F1;
  vec2 gb = ( d2 / max( F2, 1e-4 ) - d1 / max( F1, 1e-4 ) ) / scale;
  float state = cgHash2( id1, seed + 7.0 );
  float rimW = 0.10 + 0.10 * cgHash2( id1, seed + 9.0 );
  float w = max( rimW, aa );
  float tb = clamp( b / w, 0.0, 1.0 );
  float e = tb * tb * ( 3.0 - 2.0 * tb );
  float de = 6.0 * tb * ( 1.0 - tb ) / w;
  vec2 ge = de * gb;
  o.crack = 1.0 - smoothstep( 0.0, max( 0.035, aa ), b );
  if ( state < 0.42 ) {
    // intact sheet: flush, shallow joint groove
    o.h = 1.0 - 0.3 * ( 1.0 - e );
    o.g = 0.3 * ge;
  } else if ( state < 0.80 ) {
    // lifting sheet: anchored on one side, edge curled up on the other
    float ang = cgHash2( id1, seed + 11.0 ) * 6.2831853;
    vec2 dir = vec2( cos( ang ), sin( ang ) );
    float t = clamp( dot( d1, dir ) + 0.5, 0.0, 1.2 );
    float curl = t * t;
    float liftH = lift * 2.2 * curl;
    o.h = e * ( 1.0 + liftH );
    o.g = ge * ( 1.0 + liftH ) + e * lift * 2.2 * 2.0 * t * dir / scale;
    o.occl = ( 1.0 - e ) * smoothstep( 0.3, 1.0, t ) * lift;
    o.crack *= 0.6;
  } else {
    // spalled: the sheet is gone, fresh rock exposed in a recess
    o.h = 0.0;
    o.g = vec2( 0.0 );
    o.fresh = 1.0;
    o.occl = ( 1.0 - e ) * 0.7;
  }
  return o;
}

// ---- mineral flakes ------------------------------------------------------------------------
struct FlakeOut { float cover; vec2 g; float tint; float finish; };
FlakeOut flakeLayer( vec2 p, float scale, float aa, float seed ) {
  FlakeOut o; o.cover = 0.0; o.g = vec2( 0.0 ); o.tint = 0.5; o.finish = 0.5;
  vec2 q = p / scale;
  ivec2 cell = ivec2( floor( q ) );
  vec2 f = fract( q );
  float front = -1.0;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    ivec2 c = cell + ivec2( x, y );
    float pr = cgHash2( c, seed );
    if ( pr < 0.3 ) continue;
    vec2 centre = vec2( x, y ) + vec2( cgHash2( c, seed + 1.0 ), cgHash2( c, seed + 2.0 ) );
    float ang = cgHash2( c, seed + 3.0 ) * 6.2831853;
    float ca = cos( ang ), sa = sin( ang );
    mat2 R = mat2( ca, sa, -sa, ca );
    vec2 local = R * ( f - centre );
    float h4 = cgHash2( c, seed + 4.0 ), h5 = cgHash2( c, seed + 5.0 );
    vec2 axes = vec2( 0.8 + h4 * 0.6, 0.75 + pr * 0.8 );
    vec2 d = abs( local ) * axes;
    float bevel = dot( d, vec2( 0.6 + pr * 0.25, 0.55 + h5 * 0.35 ) );
    float dist = max( max( d.x, d.y ), bevel );
    float radius = 0.28 + h4 * 0.36;
    float cover = 1.0 - smoothstep( radius - aa, radius + aa, dist );
    if ( cover > 0.001 && pr > front ) {
      front = pr;
      o.cover = cover;
      vec2 tilt = ( vec2( h5, cgHash2( c, seed + 6.0 ) ) - 0.5 ) * 1.6;
      vec2 edgeDir = transpose( R ) * ( sign( local ) * axes );
      float te = clamp( ( dist - radius + aa ) / ( 2.0 * aa ), 0.0, 1.0 );
      float dcover = -6.0 * te * ( 1.0 - te ) / ( 2.0 * aa );
      o.g = ( transpose( R ) * tilt * cover * 5.0 + edgeDir * dcover * 0.6 ) / scale;
      o.tint = cgHash2( c, seed + 8.0 );
      o.finish = cgHash2( c, seed + 9.0 );
    }
  }
  return o;
}

struct Surface { vec3 albedo; vec3 normalW; float roughness; float ao; };

Surface evaluateCliffSurface( vec3 wp, vec3 n, vec4 aux ) {
  float deposit = aux.x * ( 1.0 - uIsRock );
  float flow = aux.y * ( 1.0 - uIsRock );
  float cavity = aux.w;
  float footprint = max( length( dFdx( wp ) ), length( dFdy( wp ) ) ) + 1e-5;

  // Triplanar weights
  vec3 w = pow( abs( n ), vec3( 5.0 ) );
  w /= dot( w, vec3( 1.0 ) );

  vec3 G = vec3( 0.0 );
  float fresh = 0.0, crack = 0.0, occl = 0.0, flakeCover = 0.0, flakeTint = 0.0, flakeFinish = 0.0;

  float peelThick = 0.045 * uPeelStrength;
  float peelThick2 = 0.015 * uPeelStrength;
  float flakeH = 0.006 * uFlakeStrength;

  for ( int axis = 0; axis < 3; axis++ ) {
    float wa = axis == 0 ? w.x : ( axis == 1 ? w.y : w.z );
    if ( wa < 0.02 ) continue;
    vec2 pp = axis == 0 ? wp.yz : ( axis == 1 ? wp.xz : wp.xy );
    pp += vec2( float( axis ) * 37.0, uSeed );
    vec2 g2 = vec2( 0.0 );

    if ( uPeelStrength > 0.0 ) {
      float fade = 1.0 - smoothstep( 0.08, 0.35, footprint / uPeelScale );
      if ( fade > 0.0 ) {
        PeelOut a = peelLayer( pp, uPeelScale, uPeelLift, max( 0.02, 1.5 * footprint / uPeelScale ), uSeed + float( axis ) * 13.0 );
        g2 += a.g * peelThick * fade;
        fresh += a.fresh * fade * wa;
        crack += a.crack * fade * wa;
        occl += a.occl * fade * wa;
        float fade2 = 1.0 - smoothstep( 0.08, 0.35, footprint / ( uPeelScale * 0.27 ) );
        if ( fade2 > 0.0 ) {
          PeelOut b = peelLayer( pp + vec2( 31.0, 17.0 ), uPeelScale * 0.27, uPeelLift * 0.6, max( 0.02, 1.5 * footprint / ( uPeelScale * 0.27 ) ), uSeed + 101.0 + float( axis ) * 13.0 );
          float keep = 1.0 - a.fresh * 0.6;
          g2 += b.g * peelThick2 * fade2 * keep;
          fresh += b.fresh * fade2 * wa * 0.5 * keep;
          crack += b.crack * fade2 * wa * 0.5 * keep;
          occl += b.occl * fade2 * wa * 0.5 * keep;
        }
      }
    }

    if ( uFlakeStrength > 0.0 ) {
      float fadeA = 1.0 - smoothstep( 0.1, 0.45, footprint / uFlakeScale );
      if ( fadeA > 0.0 ) {
        FlakeOut fa = flakeLayer( pp, uFlakeScale, max( 0.03, 1.2 * footprint / uFlakeScale ), uSeed + 211.0 + float( axis ) * 7.0 );
        float alpha = fa.cover * fadeA * 0.85;
        g2 += fa.g * flakeH * fadeA;
        flakeCover += alpha * wa;
        flakeTint += fa.tint * alpha * wa;
        flakeFinish += fa.finish * alpha * wa;
        float fadeB = 1.0 - smoothstep( 0.1, 0.45, footprint / ( uFlakeScale * 0.33 ) );
        if ( fadeB > 0.0 ) {
          FlakeOut fb = flakeLayer( pp + vec2( 5.0, 23.0 ), uFlakeScale * 0.33, max( 0.03, 1.2 * footprint / ( uFlakeScale * 0.33 ) ), uSeed + 307.0 + float( axis ) * 7.0 );
          float alphaB = fb.cover * fadeB * 0.6;
          g2 += fb.g * flakeH * 0.6 * fadeB;
          flakeCover += alphaB * wa * ( 1.0 - alpha );
          flakeTint += fb.tint * alphaB * wa * ( 1.0 - alpha );
          flakeFinish += fb.finish * alphaB * wa * ( 1.0 - alpha );
        }
      }
    }

    vec3 g3 = axis == 0 ? vec3( 0.0, g2.x, g2.y ) : ( axis == 1 ? vec3( g2.x, 0.0, g2.y ) : vec3( g2.x, g2.y, 0.0 ) );
    G += g3 * wa;
  }
  flakeTint = flakeCover > 1e-4 ? flakeTint / flakeCover : 0.5;
  flakeFinish = flakeCover > 1e-4 ? flakeFinish / flakeCover : 0.5;

  // Aggregate grain (3D, no projection needed)
  float grainFade = 1.0 - smoothstep( 0.15, 0.6, footprint / uGrainSize );
  vec4 grain = cgFbm3( wp / uGrainSize, 4 );
  vec4 grainFine = cgFbm3( wp / ( uGrainSize * 0.23 ) + 11.0, 3 );
  float grainAmp = 0.035 * uGrainStrength * grainFade;
  G += ( grain.yzw / uGrainSize * grainAmp + grainFine.yzw / ( uGrainSize * 0.23 ) * grainAmp * 0.25 * ( 1.0 - smoothstep( 0.15, 0.6, footprint / ( uGrainSize * 0.23 ) ) ) );

  // Normal perturbation from the composite height gradient
  vec3 Gt = G - n * dot( n, G );
  vec3 nW = normalize( n - Gt );

  // ---- colour --------------------------------------------------------------------------------
  float bandY = wp.y + uDipX * wp.x + uDipZ * wp.z;
  float warp = cgNoise3( wp * 0.012 ).x * 9.0 + cgNoise3( wp * 0.07 + 3.0 ).x * 1.6;
  float tb = ( bandY + warp ) / uStrataBand;
  float bi = floor( tb );
  float bf = fract( tb );
  float bh = cgHash( uvec3( ivec3( int( bi ) + 2048, 17, int( uSeed ) ) ) );
  float bh2 = cgHash( uvec3( ivec3( int( bi ) + 2048, 29, int( uSeed ) ) ) );
  vec3 bandCol = mix( uRockA, uRockB, smoothstep( 0.3, 0.7, bh ) );
  bandCol = mix( bandCol, uRockC, smoothstep( 0.72, 0.95, bh2 ) * 0.85 );
  bandCol *= 1.0 - 0.2 * ( 1.0 - bf );
  float seam = 1.0 - smoothstep( 0.0, 0.07, min( bf, 1.0 - bf ) );
  bandCol *= 1.0 - 0.35 * seam;
  vec3 rock = mix( uRockA, bandCol, uStrataContrast );

  // mottle & grain tint
  rock *= 0.82 + 0.36 * ( grain.x * 0.5 + 0.5 );
  rock *= 0.92 + 0.16 * ( grainFine.x * 0.5 + 0.5 );

  // oxide pockets
  float ox = smoothstep( 0.52, 0.8, cgNoise3( wp * 0.016 + 7.0 ).x * 0.6 + cgNoise3( wp * 0.055 ).x * 0.4 );
  rock = mix( rock, uOxide, ox * 0.65 );

  // exfoliation colour: pale fresh rock in spalls, dark joints, shadow under lifted edges
  rock = mix( rock, uFresh, clamp( fresh, 0.0, 1.0 ) * 0.85 );
  rock *= 1.0 - clamp( crack, 0.0, 1.0 ) * 0.5;
  rock *= 1.0 - clamp( occl, 0.0, 1.0 ) * 0.55;

  // flakes: per-plate tint
  rock = mix( rock, rock * ( 0.7 + 0.6 * flakeTint ), clamp( flakeCover, 0.0, 1.0 ) * 0.75 );

  // cavity / convexity
  rock *= 1.0 + cavity * 0.22;

  // runoff staining
  float wall = 1.0 - abs( n.y );
  float streak = cgNoise3( vec3( wp.x * 0.3, wp.y * 0.015, wp.z * 0.3 ) ).x * 0.6 + cgNoise3( vec3( wp.x * 1.1, wp.y * 0.03, wp.z * 1.1 ) + 5.0 ).x * 0.4;
  streak = smoothstep( 0.56, 0.78, streak );
  float wet = clamp( uWetness * ( flow * 0.9 + streak * wall * 0.7 ), 0.0, 1.0 );
  rock *= 1.0 - wet * 0.5;

  // scree gravel on deposits
  float speckle = cgNoise3( wp * 2.3 ).x;
  vec3 gravel = mix( uRockC, uRockA, 0.5 ) * ( 0.75 + 0.5 * speckle );
  float gravelMix = smoothstep( 0.1, 0.6, deposit ) * 0.9;
  rock = mix( rock, gravel, gravelMix );

  // vegetation on gentle ground
  float flatness = smoothstep( 0.6, 0.86, n.y );
  float vegNoise = cgNoise3( wp * 0.008 ).x * 0.5 + cgNoise3( wp * 0.045 + 2.0 ).x * 0.5;
  float belowSnow = 1.0 - smoothstep( uSnowLine - 160.0, uSnowLine - 20.0, wp.y );
  float aboveWater = smoothstep( uSeaLevel + 1.0, uSeaLevel + 7.0, wp.y );
  float veg = uVegetation * flatness * smoothstep( 0.3, 0.6, vegNoise + uVegetation * 0.35 - 0.15 ) * ( 1.0 - gravelMix * 0.8 ) * ( 1.0 - uIsRock * 0.9 ) * belowSnow * aboveWater;
  veg = clamp( veg, 0.0, 1.0 );
  vec3 grass = mix( vec3( 0.16, 0.22, 0.08 ), vec3( 0.40, 0.37, 0.16 ), cgNoise3( wp * 0.12 ).x * 0.7 + 0.15 );
  grass *= 0.85 + 0.3 * speckle;

  // moss in sheltered concavities
  float moss = uMossiness * ( 0.35 + 0.65 * smoothstep( 0.0, 0.6, -cavity ) ) * smoothstep( 0.05, 0.7, n.y + 0.2 )
    * smoothstep( 0.5, 0.78, cgNoise3( wp * 0.35 ).x * 0.6 + cgNoise3( wp * 0.05 + 9.0 ).x * 0.4 ) * belowSnow * aboveWater * ( 1.0 - crack * 0.5 );
  moss = clamp( moss, 0.0, 1.0 );

  vec3 color = mix( rock, grass, veg );
  color = mix( color, vec3( 0.14, 0.2, 0.07 ) * ( 0.8 + 0.4 * speckle ), moss * 0.7 );

  // snow
  float snowNoise = cgNoise3( wp * 0.02 ).x * 70.0;
  float snow = smoothstep( uSnowLine - 45.0 + snowNoise, uSnowLine + 45.0 + snowNoise, wp.y ) * smoothstep( uSnowSlopeCos - 0.12, uSnowSlopeCos + 0.1, nW.y );
  snow = clamp( snow * ( 1.0 + deposit * 0.6 + max( 0.0, -cavity ) * 0.4 ), 0.0, 1.0 );
  color = mix( color, vec3( 0.86, 0.88, 0.93 ), snow );

  // wet sand below water
  color *= mix( 0.55, 1.0, smoothstep( uSeaLevel - 1.5, uSeaLevel + 2.5, wp.y ) );

  float roughness = 0.93 - clamp( flakeCover, 0.0, 1.0 ) * 0.3 * flakeFinish - wet * 0.4 - fresh * 0.05;
  roughness = mix( roughness, 0.95, veg );
  roughness = mix( roughness, 0.72, snow );

  float ao = ( 1.0 - clamp( crack, 0.0, 1.0 ) * 0.45 ) * ( 1.0 - clamp( occl, 0.0, 1.0 ) * 0.6 ) * ( 1.0 - max( 0.0, -cavity ) * 0.35 );
  ao = mix( ao, 1.0, snow * 0.6 );

  vec3 nFinal = normalize( mix( nW, n, max( snow, veg * 0.6 ) ) );

  Surface s;
  s.albedo = color;
  s.normalW = nFinal;
  s.roughness = clamp( roughness, 0.3, 1.0 );
  s.ao = ao;
  return s;
}
`;

const fragmentBody = /* glsl */`
{
  vec3 geomN = inverseTransformDirection( normal, viewMatrix );
  Surface s = evaluateCliffSurface( vWorldPos, geomN, vAux );
  diffuseColor.rgb = s.albedo;
  roughnessFactor = s.roughness;
  normal = normalize( ( viewMatrix * vec4( s.normalW, 0.0 ) ).xyz );
  cgAO = s.ao;
}
`;

export function makeSurfaceUniforms() {
  return {
    uRockA: { value: new THREE.Color() }, uRockB: { value: new THREE.Color() }, uRockC: { value: new THREE.Color() },
    uFresh: { value: new THREE.Color() }, uOxide: { value: new THREE.Color() },
    uStrataBand: { value: 26 }, uStrataContrast: { value: 0.7 }, uDipX: { value: 0 }, uDipZ: { value: 0 },
    uGrainSize: { value: 0.9 }, uGrainStrength: { value: 0.6 },
    uFlakeStrength: { value: 0.6 }, uFlakeScale: { value: 0.35 },
    uPeelStrength: { value: 0.7 }, uPeelScale: { value: 2.2 }, uPeelLift: { value: 0.6 },
    uWetness: { value: 0.6 }, uSnowLine: { value: 430 }, uSnowSlopeCos: { value: Math.cos((48 * Math.PI) / 180) },
    uVegetation: { value: 0.6 }, uMossiness: { value: 0.5 },
    uSeaLevel: { value: 0 }, uSeed: { value: 428 },
  };
}

export function updateSurfaceUniforms(uniforms, v) {
  const pal = palettes[v.palette] || palettes.granite;
  uniforms.uRockA.value.setRGB(...pal.rockA);
  uniforms.uRockB.value.setRGB(...pal.rockB);
  uniforms.uRockC.value.setRGB(...pal.rockC);
  uniforms.uFresh.value.setRGB(...pal.fresh);
  uniforms.uOxide.value.setRGB(...pal.oxide);
  uniforms.uStrataBand.value = v.strataBand;
  uniforms.uStrataContrast.value = v.strataContrast;
  const dipRad = (v.strataDip * Math.PI) / 180, dirRad = (v.strataDipDirection * Math.PI) / 180;
  uniforms.uDipX.value = Math.tan(dipRad) * Math.cos(dirRad);
  uniforms.uDipZ.value = Math.tan(dipRad) * Math.sin(dirRad);
  uniforms.uGrainSize.value = v.grainSize;
  uniforms.uGrainStrength.value = v.grainStrength;
  uniforms.uFlakeStrength.value = v.flakeStrength;
  uniforms.uFlakeScale.value = v.flakeScale;
  uniforms.uPeelStrength.value = v.peelStrength;
  uniforms.uPeelScale.value = v.peelScale;
  uniforms.uPeelLift.value = v.peelLift;
  uniforms.uWetness.value = v.wetness;
  uniforms.uSnowLine.value = v.snowLine;
  uniforms.uSnowSlopeCos.value = Math.cos((v.snowSlope * Math.PI) / 180);
  uniforms.uVegetation.value = v.vegetation;
  uniforms.uMossiness.value = v.mossiness;
  uniforms.uSeaLevel.value = v.waterEnabled ? v.seaLevel : -1e6;
  uniforms.uSeed.value = v.seed % 1000;
}

export function makeSurfaceMaterial(uniforms, { isRock = false } = {}) {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uIsRock: { value: isRock ? 1 : 0 } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${vertexBody}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentHead}\nfloat cgAO = 1.0;`)
      .replace('#include <normal_fragment_maps>', fragmentBody)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= cgAO;\nreflectedLight.indirectSpecular *= cgAO;\nreflectedLight.directDiffuse *= mix( 1.0, cgAO, 0.5 );`);
  };
  material.customProgramCacheKey = () => `cliff-surface-${isRock ? 'rock' : 'terrain'}`;
  return material;
}
