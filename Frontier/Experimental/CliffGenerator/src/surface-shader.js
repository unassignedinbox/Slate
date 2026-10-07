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
uniform float uFlakeStrength, uFlakeScale, uFlakeColor, uFlakeRelief, uFlakeSheen;
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
    o.crack *= 0.35;
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
// Overlapping angular plates; the front-most plate wins so plates occlude rather than add.
struct FlakeOut { float cover; vec2 g; vec3 color; float finish; float edge; float relief; };
FlakeOut flakeLayer( vec2 p, float scale, float aa, float seed ) {
  FlakeOut o; o.cover = 0.0; o.g = vec2( 0.0 ); o.color = vec3( 0.5 ); o.finish = 0.5; o.edge = 0.0; o.relief = 0.0;
  vec2 q = p / scale;
  ivec2 cell = ivec2( floor( q ) );
  vec2 f = fract( q );
  float front = -1.0;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    ivec2 c = cell + ivec2( x, y );
    float pr = cgHash2( c, seed );
    if ( pr < 0.22 ) continue;
    vec2 centre = vec2( x, y ) + vec2( cgHash2( c, seed + 1.0 ), cgHash2( c, seed + 2.0 ) );
    float ang = cgHash2( c, seed + 3.0 ) * 6.2831853;
    float ca = cos( ang ), sa = sin( ang );
    mat2 R = mat2( ca, sa, -sa, ca );
    vec2 local = R * ( f - centre );
    float h4 = cgHash2( c, seed + 4.0 ), h5 = cgHash2( c, seed + 5.0 );
    vec2 axes = vec2( 0.8 + h4 * 0.65, 0.75 + pr * 0.8 );
    vec2 d = abs( local ) * axes;
    // six irregular edges: box, bevel diagonal and one oblique cut → angular chips, not pebbles
    float bevel = dot( d, vec2( 0.6 + pr * 0.25, 0.55 + h5 * 0.35 ) );
    float cut = dot( local, normalize( vec2( pr - 0.35, 0.65 ) ) ) * 1.18;
    float dist = max( max( d.x, d.y ), max( bevel, cut ) );
    float radius = 0.27 + h4 * 0.38;
    float cover = 1.0 - smoothstep( radius - aa, radius + aa, dist );
    if ( cover > 0.001 && pr > front ) {
      front = pr;
      o.cover = cover;
      vec2 tilt = ( vec2( h5, cgHash2( c, seed + 6.0 ) ) - 0.5 ) * 2.0;
      vec2 edgeDir = transpose( R ) * ( sign( local ) * axes );
      float edge = 1.0 - smoothstep( aa, aa + 0.06, abs( dist - radius ) );
      o.edge = edge * cover;
      o.relief = step( 1.0 - uFlakeRelief, cgHash2( c, seed + 7.0 ) );
      // plate tilt plus a bevel at the rim
      o.g = ( transpose( R ) * tilt * cover * 4.0 + edgeDir * o.edge * 3.0 ) / scale * o.relief;
      o.color = vec3( cgHash2( c, seed + 8.0 ), cgHash2( c, seed + 9.0 ), cgHash2( c, seed + 10.0 ) );
      o.finish = cgHash2( c, seed + 11.0 );
    }
  }
  return o;
}
// Three independently seeded layers: basal chips, mid laminae, fine flecks. Foreground covers background.
FlakeOut flakeStack( vec2 p, float scale, float footprint, float seed ) {
  FlakeOut r; r.cover = 0.0; r.g = vec2( 0.0 ); r.color = vec3( 0.5 ); r.finish = 0.5; r.edge = 0.0; r.relief = 0.0;
  for ( int layer = 0; layer < 3; layer++ ) {
    float s = layer == 0 ? 1.65 : ( layer == 1 ? 0.6 : 0.21 );
    float ls = scale * s;
    float vis = 1.0 - smoothstep( 0.12, 0.5, footprint / ls );
    if ( vis < 0.001 ) continue;
    FlakeOut f = flakeLayer( p + vec2( float( layer ) * 19.0, 7.0 ), ls, max( 0.025, 1.3 * footprint / ls ), seed + float( layer ) * 71.0 );
    float alpha = f.cover * vis * ( layer == 0 ? 0.8 : ( layer == 1 ? 0.75 : 0.55 ) );
    r.cover = mix( r.cover, 1.0, alpha );
    r.g = mix( r.g, f.g, alpha );
    r.color = mix( r.color, f.color, alpha );
    r.finish = mix( r.finish, f.finish, alpha );
    r.edge = mix( r.edge, f.edge, alpha );
    r.relief = mix( r.relief, f.relief, alpha );
  }
  return r;
}

struct Surface { vec3 albedo; vec3 normalW; float roughness; float ao; };

Surface evaluateCliffSurface( vec3 wp, vec3 n, vec4 aux ) {
  float deposit = aux.x * ( 1.0 - uIsRock );
  float flow = aux.y * ( 1.0 - uIsRock );
  float hardness = aux.z;
  float cavity = aux.w;
  float footprint = max( length( dFdx( wp ) ), length( dFdy( wp ) ) ) + 1e-5;
  float wall = 1.0 - abs( n.y );

  // ---- cover masks first, so rock micro-detail only grows where rock is exposed ----------------
  float speckle = cgNoise3( wp * 2.3 ).x;
  float flatness = smoothstep( 0.6, 0.86, n.y );
  float vegNoise = cgNoise3( wp * 0.008 ).x * 0.5 + cgNoise3( wp * 0.045 + 2.0 ).x * 0.5;
  float belowSnow = 1.0 - smoothstep( uSnowLine - 160.0, uSnowLine - 20.0, wp.y );
  float aboveWater = smoothstep( uSeaLevel + 1.0, uSeaLevel + 7.0, wp.y );
  float gravelMix = smoothstep( 0.1, 0.6, deposit ) * 0.9;
  float veg = uVegetation * flatness * smoothstep( 0.3, 0.6, vegNoise + uVegetation * 0.35 - 0.15 ) * ( 1.0 - gravelMix * 0.8 ) * ( 1.0 - uIsRock * 0.9 ) * belowSnow * aboveWater;
  veg = clamp( veg, 0.0, 1.0 );
  float snowNoise = cgNoise3( wp * 0.02 ).x * 70.0;
  float snowAlt = smoothstep( uSnowLine - 45.0 + snowNoise, uSnowLine + 45.0 + snowNoise, wp.y );
  float rockMask = ( 1.0 - veg ) * ( 1.0 - gravelMix ) * ( 1.0 - snowAlt * smoothstep( uSnowSlopeCos - 0.2, uSnowSlopeCos + 0.1, n.y ) );

  // Triplanar weights
  vec3 w = pow( abs( n ), vec3( 5.0 ) );
  w /= dot( w, vec3( 1.0 ) );

  vec3 G = vec3( 0.0 );
  float fresh = 0.0, crack = 0.0, occl = 0.0, flakeCover = 0.0, flakeFinish = 0.0, flakeEdge = 0.0;
  vec3 flakeCol = vec3( 0.0 );

  // exfoliation happens in patches, mostly on faces; sheets are stretched along bedding
  float peelPatch = smoothstep( 0.42, 0.62, cgNoise3( wp * 0.03 + 13.0 ).x * 0.65 + cgNoise3( wp * 0.11 ).x * 0.35 + uPeelStrength * 0.25 - 0.1 );
  float peelAmount = uPeelStrength * rockMask * peelPatch;
  float peelThick = 0.05 * peelAmount;
  float peelThick2 = 0.016 * peelAmount;
  float flakeAmount = uFlakeStrength * rockMask;
  float flakeH = 0.012 * flakeAmount;
  float cellVar = 0.75 + 0.6 * cgNoise3( wp * 0.05 + 31.0 ).x;   // non-uniform sheet sizes
  vec3 warp3 = vec3( cgNoise3( wp * 0.35 ).x, cgNoise3( wp * 0.35 + 17.0 ).x, cgNoise3( wp * 0.35 + 41.0 ).x ) - 0.5;

  for ( int axis = 0; axis < 3; axis++ ) {
    float wa = axis == 0 ? w.x : ( axis == 1 ? w.y : w.z );
    if ( wa < 0.02 ) continue;
    vec3 wq = wp + warp3 * uPeelScale * 0.25;
    vec2 pp = axis == 0 ? wq.yz : ( axis == 1 ? wq.xz : wq.xy );
    pp += vec2( float( axis ) * 37.0, uSeed );
    vec2 g2 = vec2( 0.0 );

    if ( peelAmount > 0.003 ) {
      // vertical projections: compress the up axis so sheets follow bedding
      vec2 stretch = axis == 1 ? vec2( 1.0 ) : ( axis == 0 ? vec2( 0.6, 1.4 ) : vec2( 1.4, 0.6 ) );
      float sc = uPeelScale * cellVar;
      float fade = 1.0 - smoothstep( 0.08, 0.35, footprint / sc );
      if ( fade > 0.0 ) {
        PeelOut a = peelLayer( pp * stretch, sc, uPeelLift, max( 0.02, 1.5 * footprint / sc ), uSeed + float( axis ) * 13.0 );
        g2 += a.g * stretch * peelThick * fade;
        fresh += a.fresh * fade * wa * peelPatch;
        crack += a.crack * fade * wa * peelPatch;
        occl += a.occl * fade * wa * peelPatch;
        float sc2 = sc * 0.27;
        float fade2 = 1.0 - smoothstep( 0.08, 0.35, footprint / sc2 );
        if ( fade2 > 0.0 ) {
          PeelOut b = peelLayer( pp * stretch + vec2( 31.0, 17.0 ), sc2, uPeelLift * 0.6, max( 0.02, 1.5 * footprint / sc2 ), uSeed + 101.0 + float( axis ) * 13.0 );
          float keep = 1.0 - a.fresh * 0.6;
          g2 += b.g * stretch * peelThick2 * fade2 * keep;
          fresh += b.fresh * fade2 * wa * 0.5 * keep * peelPatch;
          crack += b.crack * fade2 * wa * 0.5 * keep * peelPatch;
          occl += b.occl * fade2 * wa * 0.5 * keep * peelPatch;
        }
      }
    }

    if ( flakeAmount > 0.003 ) {
      FlakeOut fs = flakeStack( pp, uFlakeScale, footprint, uSeed + 211.0 + float( axis ) * 7.0 );
      g2 += fs.g * flakeH;
      flakeCover += fs.cover * wa;
      flakeCol += fs.color * fs.cover * wa;
      flakeFinish += fs.finish * fs.cover * wa;
      flakeEdge += fs.edge * wa;
    }

    vec3 g3 = axis == 0 ? vec3( 0.0, g2.x, g2.y ) : ( axis == 1 ? vec3( g2.x, 0.0, g2.y ) : vec3( g2.x, g2.y, 0.0 ) );
    G += g3 * wa;
  }
  flakeCol = flakeCover > 1e-4 ? flakeCol / flakeCover : vec3( 0.5 );
  flakeFinish = flakeCover > 1e-4 ? flakeFinish / flakeCover : 0.5;
  flakeCover = clamp( flakeCover * flakeAmount, 0.0, 1.0 );

  // Aggregate grain (3D, no projection needed)
  float grainFade = 1.0 - smoothstep( 0.15, 0.6, footprint / uGrainSize );
  vec4 grain = cgFbm3( wp / uGrainSize, 4 );
  vec4 grainFine = cgFbm3( wp / ( uGrainSize * 0.23 ) + 11.0, 3 );
  float grainAmp = 0.035 * uGrainStrength * grainFade * ( 0.3 + 0.7 * rockMask );
  G += ( grain.yzw / uGrainSize * grainAmp + grainFine.yzw / ( uGrainSize * 0.23 ) * grainAmp * 0.25 * ( 1.0 - smoothstep( 0.15, 0.6, footprint / ( uGrainSize * 0.23 ) ) ) );

  // Normal perturbation from the composite height gradient
  vec3 Gt = G - n * dot( n, G );
  vec3 nW = normalize( n - Gt );

  // ---- colour --------------------------------------------------------------------------------
  // strata: beds of varying thickness in the dipped frame, wavy, with soft broken seams
  float bandY = wp.y + uDipX * wp.x + uDipZ * wp.z;
  float warp = cgNoise3( wp * 0.012 ).x * 9.0 + cgNoise3( wp * 0.07 + 3.0 ).x * 1.6;
  float tb = ( bandY + warp ) / uStrataBand;
  float bi = floor( tb );
  float bf = fract( tb );
  float bh = cgHash( uvec3( ivec3( int( bi ) + 2048, 17, int( uSeed ) ) ) );
  float bh2 = cgHash( uvec3( ivec3( int( bi ) + 2048, 29, int( uSeed ) ) ) );
  float bh3 = cgHash( uvec3( ivec3( int( bi ) + 2048, 43, int( uSeed ) ) ) );
  // sub-beds: some beds are laminated into 2–4 thinner layers
  float lam = floor( bh3 * 3.0 ) + 1.0;
  float sf = fract( bf * lam );
  vec3 bandCol = mix( uRockA, uRockB, smoothstep( 0.3, 0.7, bh ) );
  bandCol = mix( bandCol, uRockC, smoothstep( 0.72, 0.95, bh2 ) * 0.85 );
  bandCol *= 1.0 - 0.12 * ( 1.0 - bf ) - 0.06 * ( 1.0 - sf );
  float seamNoise = smoothstep( 0.35, 0.7, cgNoise3( wp * vec3( 0.09, 0.4, 0.09 ) ).x );
  float seam = ( 1.0 - smoothstep( 0.0, 0.05, min( bf, 1.0 - bf ) ) ) * seamNoise;
  bandCol *= 1.0 - 0.22 * seam;
  vec3 rock = mix( uRockA, bandCol, uStrataContrast );
  // terrain beds carry the erosion hardness: caprock paler and cleaner, soft beds darker and warmer
  rock = mix( rock, rock * 1.12 + uRockC * 0.06, hardness * 0.6 * ( 1.0 - uIsRock ) );
  rock = mix( rock, rock * vec3( 0.86, 0.78, 0.7 ), ( 1.0 - hardness ) * 0.35 * ( 1.0 - uIsRock ) * uStrataContrast );

  // mottle & grain tint
  rock *= 0.82 + 0.36 * ( grain.x * 0.5 + 0.5 );
  rock *= 0.92 + 0.16 * ( grainFine.x * 0.5 + 0.5 );

  // oxide pockets
  float ox = smoothstep( 0.52, 0.8, cgNoise3( wp * 0.016 + 7.0 ).x * 0.6 + cgNoise3( wp * 0.055 ).x * 0.4 );
  rock = mix( rock, uOxide, ox * 0.65 );

  // exfoliation colour: pale fresh rock in spalls, dark joints, shadow under lifted edges
  rock = mix( rock, uFresh, clamp( fresh, 0.0, 1.0 ) * 0.85 );
  rock *= 1.0 - clamp( crack, 0.0, 1.0 ) * 0.3;
  rock *= 1.0 - clamp( occl, 0.0, 1.0 ) * 0.55;

  // flakes: per-plate colour (geology tint → independent hue as uFlakeColor rises) and rim highlight
  vec3 plateTint = mix( vec3( 0.65 + 0.7 * flakeCol.x ), 0.4 + 1.2 * flakeCol, uFlakeColor );
  rock = mix( rock, rock * plateTint, flakeCover * 0.85 );
  rock += vec3( 0.06 ) * clamp( flakeEdge, 0.0, 1.0 ) * flakeAmount;

  // cavity / convexity
  rock *= 1.0 + cavity * 0.22;

  // runoff staining
  float streak = cgNoise3( vec3( wp.x * 0.3, wp.y * 0.015, wp.z * 0.3 ) ).x * 0.6 + cgNoise3( vec3( wp.x * 1.1, wp.y * 0.03, wp.z * 1.1 ) + 5.0 ).x * 0.4;
  streak = smoothstep( 0.56, 0.78, streak );
  float wet = clamp( uWetness * ( flow * 0.9 + streak * wall * 0.7 ), 0.0, 1.0 );
  rock *= 1.0 - wet * 0.5;

  // scree gravel on deposits
  vec3 gravel = mix( uRockC, uRockA, 0.5 ) * ( 0.75 + 0.5 * speckle );
  rock = mix( rock, gravel, gravelMix );

  // vegetation: grass with dry patches and bare soil
  float dry = smoothstep( 0.45, 0.7, cgNoise3( wp * 0.02 + 23.0 ).x );
  vec3 grass = mix( vec3( 0.16, 0.22, 0.08 ), vec3( 0.40, 0.37, 0.16 ), cgNoise3( wp * 0.12 ).x * 0.7 + 0.15 );
  grass = mix( grass, vec3( 0.42, 0.34, 0.2 ), dry * 0.6 );
  grass *= 0.85 + 0.3 * speckle;

  // moss in sheltered concavities
  float moss = uMossiness * ( 0.35 + 0.65 * smoothstep( 0.0, 0.6, -cavity ) ) * smoothstep( 0.05, 0.7, n.y + 0.2 )
    * smoothstep( 0.5, 0.78, cgNoise3( wp * 0.35 ).x * 0.6 + cgNoise3( wp * 0.05 + 9.0 ).x * 0.4 ) * belowSnow * aboveWater * ( 1.0 - crack * 0.5 );
  moss = clamp( moss, 0.0, 1.0 );

  vec3 color = mix( rock, grass, veg );
  color = mix( color, vec3( 0.14, 0.2, 0.07 ) * ( 0.8 + 0.4 * speckle ), moss * 0.7 );

  // snow
  float snow = snowAlt * smoothstep( uSnowSlopeCos - 0.12, uSnowSlopeCos + 0.1, nW.y );
  snow = clamp( snow * ( 1.0 + deposit * 0.6 + max( 0.0, -cavity ) * 0.4 ), 0.0, 1.0 );
  color = mix( color, vec3( 0.86, 0.88, 0.93 ), snow );

  // wet sand below water
  color *= mix( 0.55, 1.0, smoothstep( uSeaLevel - 1.5, uSeaLevel + 2.5, wp.y ) );

  float roughness = 0.93 - wet * 0.4 - fresh * 0.05;
  roughness = mix( roughness, mix( 0.75, 0.3, flakeFinish ) , flakeCover * uFlakeSheen );
  roughness = mix( roughness, 0.95, veg );
  roughness = mix( roughness, 0.72, snow );

  float ao = ( 1.0 - clamp( crack, 0.0, 1.0 ) * 0.35 ) * ( 1.0 - clamp( occl, 0.0, 1.0 ) * 0.6 ) * ( 1.0 - max( 0.0, -cavity ) * 0.35 );
  ao = mix( ao, 1.0, snow * 0.6 );

  vec3 nFinal = normalize( mix( nW, n, max( snow, veg * 0.8 ) ) );

  Surface s;
  s.albedo = color;
  s.normalW = nFinal;
  s.roughness = clamp( roughness, 0.25, 1.0 );
  s.ao = ao;
  return s;
}
`;

const fragmentBody = /* glsl */`
{
  vec3 geomN = inverseTransformDirection( normal, viewMatrix );
  Surface s = evaluateCliffSurface( vWorldPos, geomN, vAux );
  diffuseColor.rgb = s.albedo;
  #ifdef USE_COLOR
    diffuseColor.rgb *= vColor.rgb;
  #endif
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
    uFlakeStrength: { value: 0.6 }, uFlakeScale: { value: 0.35 }, uFlakeColor: { value: 0.5 }, uFlakeRelief: { value: 0.6 }, uFlakeSheen: { value: 0.4 },
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
  uniforms.uFlakeColor.value = v.flakeColor;
  uniforms.uFlakeRelief.value = v.flakeRelief;
  uniforms.uFlakeSheen.value = v.flakeSheen;
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
