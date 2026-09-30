/**
 * Jolt Physics backend (WASM build of jrouwe/JoltPhysics — the engine used by
 * Horizon Forbidden West / Godot 4).
 *
 * Why Jolt for fracture:
 *  - convex hull shapes are first class, and every fragment the solver emits is
 *    already a convex polyhedron, so colliders are free (no hull fitting, no
 *    decomposition);
 *  - large island counts are cheap: deterministic multi-island solver, real
 *    sleeping, and LinearCast CCD for the projectile so bullets never tunnel
 *    through a 14 mm glass pane;
 *  - breakable constraints: we read the accumulated Lagrange multiplier out of
 *    each rebar link every frame and cut it when the bar yields.
 *
 * Everything below is a thin, allocation-conscious wrapper; all Jolt objects
 * that we own are explicitly destroyed (embind has no GC).
 */
import type Jolt from 'jolt-physics';
import { Quaternion, Vector3 } from 'three';
import type { Piece } from '../core/convex';

export const LAYER_STATIC = 0;
export const LAYER_MOVING = 1;

export interface Handle {
  id: Jolt.BodyID;
  mass: number;
  /** cached last linear speed — used to detect hard landings for secondary fracture */
  lastSpeed: number;
  dynamic: boolean;
}

export interface Link {
  c: Jolt.DistanceConstraint;
  maxForce: number;
  a: Handle;
  b: Handle;
}

let J: typeof Jolt;

/** CreateAndAddBody hands back a temporary BodyID; copy it into one we own. */
function ownId(tmp: Jolt.BodyID): Jolt.BodyID {
  return new J.BodyID(tmp.GetIndexAndSequenceNumber());
}

export class Physics {
  jolt!: Jolt.JoltInterface;
  system!: Jolt.PhysicsSystem;
  bi!: Jolt.BodyInterface;
  private tmpV!: Jolt.Vec3;
  private tmpV2!: Jolt.Vec3;
  private tmpR!: Jolt.RVec3;
  private tmpQ!: Jolt.Quat;
  readonly links: Link[] = [];
  private handles = new Set<Handle>();

  /** true when we got the SharedArrayBuffer multithreaded Jolt build */
  static multithreaded = false;

  static async create(maxBodies = 4096) {
    // The multithreaded WASM build needs cross-origin isolation (COOP/COEP,
    // set in vite.config.ts). Fall back to the single-thread build otherwise.
    const isolated = typeof self !== 'undefined' && (self as any).crossOriginIsolated === true;
    if (isolated) {
      try {
        J = await (await import('jolt-physics/wasm-multithread')).default();
        Physics.multithreaded = true;
      } catch { /* fall through */ }
    }
    if (!J) J = await (await import('jolt-physics/wasm')).default();
    const p = new Physics();

    const nObj = 2, nBp = 2;
    const objFilter = new J.ObjectLayerPairFilterTable(nObj);
    objFilter.EnableCollision(LAYER_STATIC, LAYER_MOVING);
    objFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);
    const bpInterface = new J.BroadPhaseLayerInterfaceTable(nObj, nBp);
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, new J.BroadPhaseLayer(0));
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, new J.BroadPhaseLayer(1));

    const s = new J.JoltSettings();
    s.mMaxBodies = maxBodies;
    s.mMaxBodyPairs = 32768;
    s.mMaxContactConstraints = 16384;
    if (Physics.multithreaded) {
      s.mMaxWorkerThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    }
    s.mObjectLayerPairFilter = objFilter;
    s.mBroadPhaseLayerInterface = bpInterface;
    s.mObjectVsBroadPhaseLayerFilter =
      new J.ObjectVsBroadPhaseLayerFilterTable(bpInterface, nBp, objFilter, nObj);

    p.jolt = new J.JoltInterface(s);
    J.destroy(s);
    p.system = p.jolt.GetPhysicsSystem();
    p.bi = p.system.GetBodyInterface();

    const ps = p.system.GetPhysicsSettings();
    ps.mNumVelocitySteps = 6;
    ps.mNumPositionSteps = 1;
    ps.mTimeBeforeSleep = 0.3;
    ps.mPointVelocitySleepThreshold = 0.15;
    ps.mAllowSleeping = true;
    p.system.SetPhysicsSettings(ps);
    p.system.SetGravity(new J.Vec3(0, -9.82, 0));

    p.tmpV = new J.Vec3(); p.tmpV2 = new J.Vec3();
    p.tmpR = new J.RVec3(); p.tmpQ = new J.Quat(0, 0, 0, 1);
    return p;
  }

  /* ---------------------------- shapes ---------------------------- */

  /** Fragment -> ConvexHullShape. Vertices are expected centred on the COM. */
  private hullShape(piece: Piece, center: Vector3): Jolt.Shape | null {
    const pts = new J.ArrayVec3();
    for (const v of piece.verts) {
      const t = new J.Vec3(v.x - center.x, v.y - center.y, v.z - center.z);
      pts.push_back(t);
      J.destroy(t);
    }
    const settings = new J.ConvexHullShapeSettings();
    settings.mPoints = pts;
    settings.mHullTolerance = 1e-4;
    settings.mMaxConvexRadius = 0.004;
    const res = settings.Create();
    const ok = res.IsValid();
    const shape = ok ? res.Get() : null;
    if (shape) shape.AddRef();
    J.destroy(settings); J.destroy(pts);
    return shape;
  }

  /* ---------------------------- bodies ---------------------------- */

  addStaticPlane(y = 0) {
    const shape = new J.BoxShapeSettings(new J.Vec3(60, 0.5, 60), 0.05);
    const s = shape.Create().Get();
    const bcs = new J.BodyCreationSettings(
      s, new J.RVec3(0, y - 0.5, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, LAYER_STATIC);
    bcs.mFriction = 0.75;
    bcs.mRestitution = 0.05;
    const id = ownId(this.bi.CreateAndAddBody(bcs, J.EActivation_DontActivate));
    J.destroy(bcs); J.destroy(shape);
    return { id, mass: 0, lastSpeed: 0, dynamic: false } as Handle;
  }

  addStaticBox(pos: Vector3, half: Vector3, friction = 0.7) {
    const ss = new J.BoxShapeSettings(new J.Vec3(half.x, half.y, half.z), 0.01);
    const s = ss.Create().Get();
    const bcs = new J.BodyCreationSettings(
      s, new J.RVec3(pos.x, pos.y, pos.z), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, LAYER_STATIC);
    bcs.mFriction = friction;
    const id = ownId(this.bi.CreateAndAddBody(bcs, J.EActivation_DontActivate));
    J.destroy(bcs); J.destroy(ss);
    const h: Handle = { id, mass: 0, lastSpeed: 0, dynamic: false };
    this.handles.add(h);
    return h;
  }

  addSphere(pos: Vector3, radius: number, mass: number, vel: Vector3) {
    const ss = new J.SphereShapeSettings(radius);
    const s = ss.Create().Get();
    const bcs = new J.BodyCreationSettings(
      s, new J.RVec3(pos.x, pos.y, pos.z), new J.Quat(0, 0, 0, 1), J.EMotionType_Dynamic, LAYER_MOVING);
    bcs.mMotionQuality = J.EMotionQuality_LinearCast;   // real CCD for bullets
    bcs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    bcs.mMassPropertiesOverride.mMass = mass;
    bcs.mLinearVelocity = new J.Vec3(vel.x, vel.y, vel.z);
    bcs.mRestitution = 0.1;
    bcs.mFriction = 0.4;
    bcs.mMaxLinearVelocity = 800;
    const id = ownId(this.bi.CreateAndAddBody(bcs, J.EActivation_Activate));
    J.destroy(bcs); J.destroy(ss);
    const h: Handle = { id, mass, lastSpeed: vel.length(), dynamic: true };
    this.handles.add(h);
    return h;
  }

  /** Convex fragment body. `center` is the fragment COM in object space. */
  addFragment(
    piece: Piece, center: Vector3, pos: Vector3, quat: Quaternion, mass: number,
    friction: number, restitution: number, vel: Vector3, spin: Vector3, fast = false,
  ): Handle | null {
    const shape = this.hullShape(piece, center);
    if (!shape) return null;
    const bcs = new J.BodyCreationSettings(
      shape, new J.RVec3(pos.x, pos.y, pos.z), new J.Quat(quat.x, quat.y, quat.z, quat.w),
      J.EMotionType_Dynamic, LAYER_MOVING);
    bcs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    bcs.mMassPropertiesOverride.mMass = Math.max(0.004, mass);
    bcs.mFriction = friction;
    bcs.mRestitution = restitution;
    bcs.mLinearDamping = 0.03;
    bcs.mAngularDamping = 0.07;
    bcs.mAllowSleeping = true;
    bcs.mEnhancedInternalEdgeRemoval = true;     // stops shards catching on seams
    if (fast) bcs.mMotionQuality = J.EMotionQuality_LinearCast;
    bcs.mLinearVelocity = new J.Vec3(vel.x, vel.y, vel.z);
    bcs.mAngularVelocity = new J.Vec3(spin.x, spin.y, spin.z);
    const id = ownId(this.bi.CreateAndAddBody(bcs, J.EActivation_Activate));
    J.destroy(bcs);
    shape.Release();
    const h: Handle = { id, mass, lastSpeed: vel.length(), dynamic: true };
    this.handles.add(h);
    return h;
  }

  /** Static convex body (a wall / pane held in its frame before it breaks). */
  addStaticConvex(piece: Piece, center: Vector3, pos: Vector3, friction: number) {
    const shape = this.hullShape(piece, center);
    if (!shape) return null;
    const bcs = new J.BodyCreationSettings(
      shape, new J.RVec3(pos.x, pos.y, pos.z), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, LAYER_STATIC);
    bcs.mFriction = friction;
    const id = ownId(this.bi.CreateAndAddBody(bcs, J.EActivation_DontActivate));
    J.destroy(bcs); shape.Release();
    const h: Handle = { id, mass: 0, lastSpeed: 0, dynamic: false };
    this.handles.add(h);
    return h;
  }

  remove(h: Handle) {
    for (let i = this.links.length - 1; i >= 0; i--) {
      if (this.links[i].a === h || this.links[i].b === h) this.breakLink(i);
    }
    if (this.bi.IsAdded(h.id)) this.bi.RemoveBody(h.id);
    this.bi.DestroyBody(h.id);
    J.destroy(h.id);
    this.handles.delete(h);
  }

  /* -------------------------- interaction ------------------------- */

  getTransform(h: Handle, outPos: Vector3, outQuat: Quaternion) {
    this.bi.GetPositionAndRotation(h.id, this.tmpR, this.tmpQ);
    outPos.set(this.tmpR.GetX(), this.tmpR.GetY(), this.tmpR.GetZ());
    outQuat.set(this.tmpQ.GetX(), this.tmpQ.GetY(), this.tmpQ.GetZ(), this.tmpQ.GetW());
  }

  getVelocity(h: Handle, out: Vector3) {
    const v = this.bi.GetLinearVelocity(h.id);
    out.set(v.GetX(), v.GetY(), v.GetZ());
    J.destroy(v);
    return out;
  }

  applyImpulse(h: Handle, impulse: Vector3, atWorld: Vector3) {
    this.tmpV.Set(impulse.x, impulse.y, impulse.z);
    this.tmpR.Set(atWorld.x, atWorld.y, atWorld.z);
    this.bi.AddImpulse(h.id, this.tmpV, this.tmpR);
  }

  isSleeping(h: Handle) { return !this.bi.IsActive(h.id); }

  /* ------------------ breakable rebar / hinge links ---------------- */

  addLink(a: Handle, b: Handle, at: Vector3, maxForce: number) {
    const s = new J.DistanceConstraintSettings();
    s.mSpace = J.EConstraintSpace_WorldSpace;
    s.mPoint1 = new J.RVec3(at.x, at.y, at.z);
    s.mPoint2 = new J.RVec3(at.x, at.y, at.z);
    s.mMinDistance = 0;
    s.mMaxDistance = 0.012;                 // the bar can stretch a little, then yields
    const spring = s.mLimitsSpringSettings;
    spring.mFrequency = 12;
    spring.mDamping = 0.6;
    const raw = this.bi.CreateConstraint(s, a.id, b.id);
    const c = J.castObject(raw, J.DistanceConstraint);
    this.system.AddConstraint(c);
    J.destroy(s);
    const link: Link = { c, maxForce, a, b };
    this.links.push(link);
    return link;
  }

  private breakLink(i: number) {
    const l = this.links[i];
    this.system.RemoveConstraint(l.c);
    this.links.splice(i, 1);
  }

  /** Read each bar's accumulated impulse; snap the ones past their yield load. */
  updateLinks(dt: number) {
    let broken = 0;
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      const lambda = Math.abs(l.c.GetTotalLambdaPosition());
      if (lambda / Math.max(dt, 1e-4) > l.maxForce) { this.breakLink(i); broken++; }
    }
    return broken;
  }

  /* ----------------------------- step ----------------------------- */

  step(dt: number, collisionSteps = 1) {
    this.jolt.Step(dt, collisionSteps);
  }

  optimize() { this.system.OptimizeBroadPhase(); }

  get numActive() { return this.system.GetNumActiveBodies(0); }
  get numBodies() { return this.system.GetNumBodies(); }
}

export function joltVersionNote() { return 'Jolt Physics (WASM)'; }
