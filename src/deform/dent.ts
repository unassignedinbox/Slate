/**
 * RUNTIME: Vertex Animation Texture (VAT) dent deformation.
 *
 * The baked panel fields (see panel.ts) are packed into a single half-float
 * texture: one G x G tile per severity frame, stacked vertically, RGB = the
 * (u, v, w) displacement of that node in panel space.
 *
 * At runtime a dent is just a LATTICE placed on the body: a position, an
 * orthonormal frame (tangent, bitangent, surface normal), an extent and a
 * severity. The vertex shader transforms each vertex into every active
 * lattice's space, samples the VAT bilinearly (and linearly between severity
 * frames), fades the displacement with depth into the body, and accumulates.
 *
 * Consequences:
 *  - zero CPU work per frame: dents are 12 uniforms, the GPU does the rest;
 *  - the mesh can stay ONE geometry, fully static/instanced — nothing is
 *    re-uploaded when it deforms;
 *  - displacement is a pure function of object-space position, so duplicated
 *    vertices at UV/material seams move identically: no cracks;
 *  - hitting the same place twice just raises that lattice's severity, which
 *    walks up the baked plastic history (a real accumulation, not a scale);
 *  - normals are re-derived in-shader by finite-differencing the same field,
 *    so lighting shows the crumple.
 */
import {
  DataTexture, HalfFloatType, LinearFilter, Matrix3, Matrix4, Mesh, RGBAFormat,
  ClampToEdgeWrapping, Vector2, Vector3, Vector4, type Material, type IUniform,
} from 'three';
import type { DentField } from './panel';

export const MAX_DENTS = 12;

function toHalf(v: number) {
  // float32 -> float16 bit pattern
  const f = new Float32Array(1); const i = new Int32Array(f.buffer);
  f[0] = v; const x = i[0];
  const sign = (x >> 16) & 0x8000;
  let exp = ((x >> 23) & 0xff) - 127 + 15;
  let man = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7bff;
  man = man >> 13;
  return sign | (exp << 10) | man;
}

export function packVAT(fields: DentField[]): { tex: DataTexture; tiles: number; grid: number } {
  const G = fields[0].grid;
  const frames = fields[0].frames;
  const tiles = fields.length * frames;
  const w = G, hgt = G * tiles;
  const buf = new Uint16Array(w * hgt * 4);
  let tile = 0;
  for (const fld of fields) {
    for (let f = 0; f < fld.frames; f++) {
      const base = f * G * G * 3;
      for (let y = 0; y < G; y++) {
        for (let x = 0; x < G; x++) {
          const src = base + (y * G + x) * 3;
          const dst = ((tile * G + y) * w + x) * 4;
          buf[dst] = toHalf(fld.data[src]);
          buf[dst + 1] = toHalf(fld.data[src + 1]);
          buf[dst + 2] = toHalf(fld.data[src + 2]);
          buf[dst + 3] = toHalf(1);
        }
      }
      tile++;
    }
  }
  const tex = new DataTexture(buf, w, hgt, RGBAFormat, HalfFloatType);
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, tiles, grid: G };
}

export interface Dent {
  pos: Vector3;        // object space
  rot: Matrix3;        // dent -> object (columns: tangent, bitangent, normal)
  rotT: Matrix3;       // object -> dent
  size: Vector3;       // x,y extent and z depth falloff
  severity: number;    // 0 .. frames-1 (fractional)
  amp: number;
  archetype: number;   // which baked field
}

const VERT_HEAD = /* glsl */`
uniform sampler2D uDentTex;
uniform float uDentCount;
uniform float uDentFrames;
uniform float uDentArchetypes;
uniform vec3  uDentPos[${MAX_DENTS}];
uniform mat3  uDentRot[${MAX_DENTS}];
uniform mat3  uDentRotT[${MAX_DENTS}];
uniform vec4  uDentSize[${MAX_DENTS}];   // xy extent, z depth falloff, w amp
uniform vec2  uDentSev[${MAX_DENTS}];    // x severity, y archetype index

vec3 dentTexel(vec2 uv, float tile) {
  float tiles = uDentFrames * uDentArchetypes;
  vec2 t = vec2(uv.x, (tile + clamp(uv.y, 0.002, 0.998)) / tiles);
  return texture2D(uDentTex, t).xyz;
}

vec3 dentSample(vec2 uv, float sev, float arch) {
  float f0 = floor(sev);
  float f1 = min(f0 + 1.0, uDentFrames - 1.0);
  float w = sev - f0;
  float base = arch * uDentFrames;
  return mix(dentTexel(uv, base + f0), dentTexel(uv, base + f1), w);
}

vec3 dentDisplace(vec3 p) {
  vec3 total = vec3(0.0);
  for (int i = 0; i < ${MAX_DENTS}; i++) {
    if (float(i) >= uDentCount) break;
    vec3 l = uDentRotT[i] * (p - uDentPos[i]);
    vec2 uv = l.xy / uDentSize[i].xy + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    // fade into the body: the far side of the panel barely moves
    float fall = exp(-max(l.z, 0.0) / uDentSize[i].z) * exp(-max(-l.z, 0.0) / (uDentSize[i].z * 2.0));
    vec3 d = dentSample(uv, uDentSev[i].x, uDentSev[i].y);
    total += (uDentRot[i] * d) * fall * uDentSize[i].w;
  }
  return total;
}
`;

const NORMAL_PATCH = /* glsl */`
#include <beginnormal_vertex>
if (uDentCount > 0.0) {
  vec3 dP = dentDisplace(position);
  vec3 ref = abs(objectNormal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, objectNormal));
  vec3 t2 = cross(objectNormal, t1);
  float e = 0.025;
  vec3 pa = position + t1 * e;
  vec3 pb = position + t2 * e;
  vec3 a = (pa + dentDisplace(pa)) - (position + dP);
  vec3 b = (pb + dentDisplace(pb)) - (position + dP);
  vec3 n = cross(a, b);
  if (length(n) > 1e-8) objectNormal = normalize(n);
}
`;

const POSITION_PATCH = /* glsl */`
#include <begin_vertex>
if (uDentCount > 0.0) transformed += dentDisplace(position);
`;

export class DentSystem {
  readonly dents: Dent[] = [];
  readonly uniforms: Record<string, IUniform> = {};
  private frames: number;
  private archetypes: number;

  constructor(fields: DentField[]) {
    const { tex } = packVAT(fields);
    this.frames = fields[0].frames;
    this.archetypes = fields.length;
    this.uniforms = {
      uDentTex: { value: tex },
      uDentCount: { value: 0 },
      uDentFrames: { value: this.frames },
      uDentArchetypes: { value: this.archetypes },
      uDentPos: { value: Array.from({ length: MAX_DENTS }, () => new Vector3()) },
      uDentRot: { value: Array.from({ length: MAX_DENTS }, () => new Matrix3()) },
      uDentRotT: { value: Array.from({ length: MAX_DENTS }, () => new Matrix3()) },
      // NOTE: three's uniform array packer calls .toArray() on every element,
      // so these MUST be real Vector4/Vector2 objects, not plain {x,y,z,w}.
      uDentSize: { value: Array.from({ length: MAX_DENTS }, () => new Vector4(1, 1, 1, 1)) },
      uDentSev: { value: Array.from({ length: MAX_DENTS }, () => new Vector2(0, 0)) },
    };
  }

  /** Patch any standard/physical material so it reads the VAT. */
  attach(material: Material) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = VERT_HEAD + shader.vertexShader
        .replace('#include <beginnormal_vertex>', NORMAL_PATCH)
        .replace('#include <begin_vertex>', POSITION_PATCH);
    };
    material.customProgramCacheKey = () => 'dent-vat';
    material.needsUpdate = true;
  }

  /**
   * Add or deepen a dent. `point` / `normal` are in the mesh's object space.
   * Energy is mapped onto the baked severity ladder.
   */
  hit(point: Vector3, normal: Vector3, energy: number, extent = 0.85, archetype = 0) {
    // energy -> severity ladder. 60 J tap ~ 10 mm ding, 1.2 kJ ~ 40 mm caved panel
    const sevGain = Math.min(this.frames - 1, Math.max(0.0, Math.log2(1 + energy / 140) * 1.15));

    // re-hitting the same panel deepens the existing plastic set
    for (const d of this.dents) {
      if (d.pos.distanceTo(point) < extent * 0.32 && d.archetype === archetype) {
        d.severity = Math.min(this.frames - 1, d.severity + sevGain * 0.55);
        this.sync();
        return d;
      }
    }

    const n = normal.clone().normalize();
    const ref = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const t1 = ref.clone().cross(n).normalize();
    const t2 = n.clone().cross(t1).normalize();
    const rot = new Matrix3().set(t1.x, t2.x, n.x, t1.y, t2.y, n.y, t1.z, t2.z, n.z);
    const rotT = rot.clone().transpose();

    const dent: Dent = {
      pos: point.clone(), rot, rotT,
      size: new Vector3(extent, extent, extent * 0.22),
      severity: sevGain, amp: 1, archetype,
    };
    if (this.dents.length >= MAX_DENTS) this.dents.shift();   // oldest dent retires
    this.dents.push(dent);
    this.sync();
    return dent;
  }

  clear() { this.dents.length = 0; this.sync(); }

  /** Push the dent list into the uniform arrays. */
  sync() {
    const u = this.uniforms;
    u.uDentCount.value = this.dents.length;
    for (let i = 0; i < this.dents.length; i++) {
      const d = this.dents[i];
      (u.uDentPos.value as Vector3[])[i].copy(d.pos);
      (u.uDentRot.value as Matrix3[])[i].copy(d.rot);
      (u.uDentRotT.value as Matrix3[])[i].copy(d.rotT);
      (u.uDentSize.value as Vector4[])[i].set(d.size.x, d.size.y, d.size.z, d.amp);
      (u.uDentSev.value as Vector2[])[i].set(d.severity, d.archetype);
    }
  }

  /** Cheap CPU-side query so physics/collision can follow the dent. */
  displacementAt(p: Vector3, fields: DentField[], out = new Vector3()) {
    out.set(0, 0, 0);
    const tmp = new Vector3();
    for (const d of this.dents) {
      const l = tmp.copy(p).sub(d.pos).applyMatrix3(d.rotT);
      const ux = l.x / d.size.x + 0.5, uy = l.y / d.size.y + 0.5;
      if (ux < 0 || ux > 1 || uy < 0 || uy > 1) continue;
      const f = fields[d.archetype];
      const G = f.grid;
      const gx = Math.min(G - 1, Math.max(0, Math.round(ux * (G - 1))));
      const gy = Math.min(G - 1, Math.max(0, Math.round(uy * (G - 1))));
      const fr = Math.min(f.frames - 1, Math.round(d.severity));
      const k = (fr * G * G + gy * G + gx) * 3;
      const disp = new Vector3(f.data[k], f.data[k + 1], f.data[k + 2]).applyMatrix3(d.rot);
      out.addScaledVector(disp, Math.exp(-Math.abs(l.z) / d.size.z));
    }
    return out;
  }
}

/** Utility: object-space hit info from a world-space raycast on a mesh. */
export function toObjectSpace(mesh: Mesh, pointWorld: Vector3, normalWorld: Vector3) {
  const inv = new Matrix4().copy(mesh.matrixWorld).invert();
  const p = pointWorld.clone().applyMatrix4(inv);
  const n = normalWorld.clone().transformDirection(inv).normalize();
  return { p, n };
}
