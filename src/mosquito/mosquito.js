import * as THREE from 'three';
import * as G from './geom.js';
import { makeMaterials, makeWingDeformable } from './materials.js';

const D = Math.PI / 180;

/**
 * Builds a robotic female Anopheles.
 *
 * Coordinate convention for the whole animal:
 *   +Z = anterior (the way the head points)
 *   +Y = dorsal (up)
 *   +X = the animal's right
 *
 * Every articulated part is a real node in the hierarchy so the animation
 * layer only ever writes joint angles - there is no baked motion anywhere.
 */
export function buildMosquito(S) {
  const M = makeMaterials();
  const L = S.bodyLength;

  const root = new THREE.Group();            // world placement
  const orient = new THREE.Group();          // yaw / pitch / roll
  orient.rotation.order = 'YXZ';
  const body = new THREE.Group();            // per-wingbeat heave
  root.add(orient); orient.add(body);

  const rig = {
    root, orient, body, materials: M,
    wings: [], halteres: [], legs: [], abdomenSegs: [],
    labiumJoints: [], maxillae: [], mandibles: [],
    wingUniforms: [],
  };

  // ======================================================================
  // THORAX  - Anopheles has a strongly arched mesonotum (scutum)
  // ======================================================================
  const tl = S.thoraxLength * L, th = S.thoraxHeight * L, tw = S.thoraxWidth * L;
  const thorax = new THREE.Group();
  body.add(thorax);
  rig.thorax = thorax;

  {
    const prof = (t) => {
      const base = Math.sin(Math.PI * Math.pow(t, 0.82));
      const hump = S.scutumHump * Math.exp(-Math.pow((t - 0.42) / 0.26, 2));
      return (0.5 * th) * (0.42 + 0.58 * base + hump);
    };
    const g = G.bodySegment(tl, prof, 1.0, (tw / th), 22, 26);
    g.rotateY(Math.PI); g.translate(0, 0, tl * 0.5); // centre, nose +Z
    // The pharyngeal pump lives here. Give it its own node so it can
    // pulse without dragging the legs and wings around with it.
    const pharynx = new THREE.Group();
    thorax.add(pharynx);
    rig.pharyngealPump = pharynx;
    const m = new THREE.Mesh(g, M.shell);
    m.castShadow = m.receiveShadow = true;
    pharynx.add(m);

    // Ventral graphite cradle - where the legs bolt on
    const gv = G.bodySegment(tl * 0.94, (t) => prof(t) * 0.52, 0.5, (tw / th) * 1.02, 18, 20);
    gv.rotateY(Math.PI); gv.translate(0, -th * 0.30, tl * 0.47);
    thorax.add(new THREE.Mesh(gv, M.frame));

    // Panel seams
    for (const z of [-0.28, 0.02, 0.3]) {
      const r = prof(0.5 + z * 0.8) * 1.005;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, S.panelInset * L, 6, 30),
        M.shellDark
      );
      ring.position.z = z * tl; ring.scale.x = tw / th;
      thorax.add(ring);
    }

    // Sensor pod + strobe beacon: the "police drone" tell
    const pod = new THREE.Mesh(
      new THREE.SphereGeometry(S.sensorPodRadius * L, 18, 12),
      M.eye
    );
    pod.position.set(0, th * 0.52, tl * 0.18);
    thorax.add(pod); rig.sensorPod = pod;

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(S.beaconRadius * L, 14, 10),
      M.accent.clone()
    );
    beacon.position.set(0, th * 0.58, -tl * 0.26);
    thorax.add(beacon); rig.beacon = beacon;
  }

  // ======================================================================
  // HEAD
  // ======================================================================
  const neck = new THREE.Group();
  neck.position.set(0, -th * 0.06, tl * 0.5);
  thorax.add(neck);
  const head = new THREE.Group();
  neck.add(head);
  rig.neck = neck; rig.head = head;

  const hl = S.headLength * L, hw = S.headWidth * L;
  {
    const g = G.bodySegment(hl, (t) => (hw * 0.5) * Math.sin(Math.PI * Math.pow(t, 0.75)) * 1.02, 0.92, 1.0, 20, 18);
    g.rotateY(Math.PI); g.translate(0, 0, hl * 0.5);
    // Cibarial pump chamber - the first of the two pumps, and the one you
    // can actually see working on a feeding mosquito.
    const cibarium = new THREE.Group();
    head.add(cibarium);
    rig.cibarialPump = cibarium;
    cibarium.add(new THREE.Mesh(g, M.shellDark));

    // Compound eyes - huge, wrap most of the head
    for (const side of [-1, 1]) {
      // facet count across the eye -> icosahedron subdivision
      const det = Math.max(1, Math.min(5, Math.round(Math.log2(S.eyeFacetDensity / 3.2))));
      const e = new THREE.Mesh(G.compoundEye(S.eyeRadius * L, det), M.eye);
      e.position.set(side * S.eyeSeparation * L, hl * 0.06, hl * 0.06);
      e.rotation.y = side * 0.36; e.rotation.z = side * -0.12;
      head.add(e);
    }

    // Antennae: 13 flagellomeres, female = short sparse whorls
    for (const side of [-1, 1]) {
      const ab = new THREE.Group();
      ab.position.set(side * hw * 0.26, hl * 0.22, hl * 0.62);
      ab.rotation.order = 'YXZ';
      ab.rotation.y = side * S.antennaSpread;
      ab.rotation.x = -0.34;
      head.add(ab);
      const segLen = (S.antennaLength * L) / S.antennaFlagellomeres;
      let cur = ab;
      const chain = [];
      for (let i = 0; i < S.antennaFlagellomeres; i++) {
        const n = new THREE.Group();
        if (i > 0) n.position.z = segLen;
        cur.add(n); cur = n; chain.push(n);
        const r = S.antennaBaseRadius * L * (1 - 0.55 * (i / S.antennaFlagellomeres));
        const sm = new THREE.Mesh(G.taperedTube(segLen * 0.93, () => r, { radial: 7, steps: 2 }), M.frame);
        n.add(sm);
        n.add(new THREE.Mesh(G.collar(r * 1.35, segLen * 0.1, 0.4, 8), M.joint));
        // sensory whorl
        if (i > 0 && i < S.antennaFlagellomeres - 1) {
          for (let w = 0; w < S.antennaWhorlCount; w++) {
            const a = (w / S.antennaWhorlCount) * Math.PI * 2;
            const hgeo = G.taperedTube(S.antennaWhorlLength * L, (t) => r * 0.22 * (1 - t), { radial: 4, steps: 2 });
            const hm = new THREE.Mesh(hgeo, M.frame);
            hm.position.set(Math.cos(a) * r, Math.sin(a) * r, segLen * 0.2);
            hm.rotation.x = Math.sin(a) * 1.0 - 0.9; hm.rotation.y = -Math.cos(a) * 1.0;
            n.add(hm);
          }
        }
      }
      rig[side > 0 ? 'antennaR' : 'antennaL'] = chain;
    }

    // Maxillary palps - FEMALE ANOPHELES: as long as the proboscis.
    for (const side of [-1, 1]) {
      const pb = new THREE.Group();
      pb.position.set(side * hw * 0.18, -hl * 0.10, hl * 0.78);
      pb.rotation.order = 'YXZ';
      pb.rotation.y = side * 0.10;
      pb.rotation.x = 0.06;
      head.add(pb);
      const n = S.palpSegments, segLen = (S.palpLength * L) / n;
      let cur = pb; const chain = [];
      for (let i = 0; i < n; i++) {
        const node = new THREE.Group();
        if (i > 0) node.position.z = segLen;
        cur.add(node); cur = node; chain.push(node);
        const r0 = S.palpRadius * L * (1 - 0.35 * (i / n));
        const r1 = S.palpRadius * L * (1 - 0.35 * ((i + 1) / n));
        node.add(new THREE.Mesh(
          G.taperedTube(segLen * 0.94, (t) => r0 + (r1 - r0) * t, { radial: 9, steps: 3 }),
          i % 2 ? M.shellDark : M.shell));       // banded, like real palps
      }
      rig[side > 0 ? 'palpR' : 'palpL'] = chain;
    }
  }

  // ======================================================================
  // PROBOSCIS
  //   labium  = outer gutter. Never enters the target. Buckles into a bow.
  //   fascicle = 6 stylets that actually go in: labrum, hypopharynx,
  //              2 mandibles, 2 maxillae (the serrated microsaws).
  // ======================================================================
  const pRoot = new THREE.Group();
  pRoot.position.set(0, -hl * 0.20, hl * 0.80);
  pRoot.rotation.x = 0.10;
  head.add(pRoot);
  rig.proboscisRoot = pRoot;

  const pl = S.proboscisLength * L;
  const pr0 = S.proboscisBaseRadius * L, pr1 = S.proboscisTipRadius * L;
  const pRad = (t) => pr0 + (pr1 - pr0) * Math.pow(t, 0.72);

  {
    // --- labium: a chain of open gutter segments so it can bow backwards
    const n = Math.max(3, Math.round(S.labiumSegments));
    const segLen = pl / n;
    let cur = pRoot;
    for (let i = 0; i < n; i++) {
      const node = new THREE.Group();
      if (i > 0) node.position.z = segLen;
      cur.add(node); cur = node;
      rig.labiumJoints.push(node);
      const t0 = i / n, t1 = (i + 1) / n;
      const g = G.gutterSegment(segLen * 1.02,
        (t) => pRad(t0 + (t1 - t0) * t), S.labiumWallThickness,
        { radial: 16, steps: 4 });
      const mesh = new THREE.Mesh(g, i % 2 ? M.shellDark : M.shell);
      mesh.material.side = THREE.DoubleSide;
      mesh.scale.y = 0.86;
      node.add(mesh);
      node.add(new THREE.Mesh(G.collar(pRad(t0) * 1.22, segLen * 0.09, 0.4, 10), M.joint));
    }
    rig.labiumTip = cur;

    // labella - the two taste lobes that stay in contact with the surface
    const lab = new THREE.Group();
    lab.position.z = segLen;
    cur.add(lab); rig.labella = lab;
    for (const side of [-1, 1]) {
      const lobe = new THREE.Mesh(
        new THREE.SphereGeometry(S.labellaLength * L * 0.5, 12, 8),
        M.shellDark
      );
      lobe.scale.set(0.8, 0.7, 1.5);
      lobe.position.set(side * pr1 * 0.9, 0, S.labellaLength * L * 0.3);
      lab.add(lobe);
      rig[side > 0 ? 'labellaR' : 'labellaL'] = lobe;
    }

    // --- fascicle: slides out of the labium along +Z ---
    const fasc = new THREE.Group();
    pRoot.add(fasc);
    rig.fascicle = fasc;

    const fr = pr0 * S.fascicleRadius;
    const styletLen = pl * 1.02;
    const mkStylet = (dx, dy, r, mat, serrated) => {
      const n2 = new THREE.Group();
      n2.position.set(dx, dy, 0);
      fasc.add(n2);
      n2.add(new THREE.Mesh(
        G.taperedTube(styletLen, (t) => r * (1 - 0.55 * Math.pow(t, 2.2)), { radial: 8, steps: 12 }),
        mat));
      if (serrated) {
        // microsaw teeth on the distal third of the maxillae
        const teeth = 14;
        for (let i = 0; i < teeth; i++) {
          const t = 0.66 + 0.33 * (i / teeth);
          const tooth = new THREE.Mesh(
            new THREE.ConeGeometry(r * 0.5, r * 1.5, 4),
            M.steel);
          tooth.position.set(Math.sign(dx || 1) * r * 0.8, 0, t * styletLen);
          tooth.rotation.z = Math.sign(dx || 1) * Math.PI / 2;
          tooth.rotation.y = -0.5;
          n2.add(tooth);
        }
      }
      return n2;
    };
    // labrum: biggest, carries the food canal
    rig.labrum = mkStylet(0, fr * 0.55, fr * 0.62, M.stylet, false);
    // hypopharynx: salivary/anticoagulant duct
    rig.hypopharynx = mkStylet(0, -fr * 0.55, fr * 0.36, M.steel, false);
    // mandibles: sharp, hold the cut open
    for (const side of [-1, 1])
      rig.mandibles.push(mkStylet(side * fr * 0.5, fr * 0.1, fr * 0.26, M.steel, false));
    // maxillae: the alternating microsaws
    for (const side of [-1, 1])
      rig.maxillae.push(mkStylet(side * fr * 0.85, -fr * 0.15, fr * 0.30, M.steel, true));

    // Robotic addition: a rotary boring head, because a fuel tank is steel.
    const drill = new THREE.Group();
    drill.position.z = styletLen * 0.985;
    fasc.add(drill); rig.drill = drill;
    for (const gg of G.drillHead(pl * 0.11, fr * 1.25, S.drillFluteCount, S.drillFlutePitch * L)) {
      drill.add(new THREE.Mesh(gg, M.steel));
    }
    const glow = new THREE.Mesh(new THREE.SphereGeometry(fr * 1.0, 10, 8), M.accentHot.clone());
    glow.visible = false; glow.position.z = pl * 0.10;
    drill.add(glow); rig.drillGlow = glow;

    // Visible fluid column inside the labrum while feeding
    const col = new THREE.Mesh(
      G.taperedTube(pl * 0.9, () => fr * 0.34, { radial: 7, steps: 2 }),
      M.fluid.clone());
    col.position.set(0, fr * 0.55, 0); col.visible = false;
    fasc.add(col); rig.fluidColumn = col;
  }

  // ======================================================================
  // ABDOMEN - 8 terga, tapering, able to distend
  // ======================================================================
  const abRoot = new THREE.Group();
  abRoot.position.set(0, -th * 0.02, -tl * 0.46);
  abRoot.rotation.y = Math.PI;               // chain runs aft (-Z)
  thorax.add(abRoot);
  rig.abdomenRoot = abRoot;

  {
    const n = S.abdomenSegments;
    const al = S.abdomenLength * L, ar = S.abdomenRadius * L;
    const segLen = al / n;
    const radAt = (t) => ar * (1 - (1 - S.abdomenTaper) * Math.pow(t, 1.5)) *
      (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, 0.25 + t * 1.1)));
    let cur = abRoot;
    for (let i = 0; i < n; i++) {
      const node = new THREE.Group();
      if (i > 0) node.position.z = segLen;
      cur.add(node); cur = node;
      const holder = new THREE.Group();   // scaled for distension
      node.add(holder);
      rig.abdomenSegs.push({ joint: node, holder });

      const t0 = i / n, t1 = (i + 1) / n;
      const g = G.taperedTube(segLen * 1.06, (t) => radAt(t0 + (t1 - t0) * t), { radial: 18, steps: 5 });
      const mesh = new THREE.Mesh(g, M.shell);
      mesh.scale.y = 0.88; mesh.castShadow = true;
      holder.add(mesh);

      // dark tergal band at each segment boundary - the banded abdomen
      const band = new THREE.Mesh(
        G.taperedTube(segLen * 0.30, (t) => radAt(t0 + 0.02) * (1.015 - 0.04 * t), { radial: 18, steps: 2 }),
        M.shellDark);
      band.scale.y = 0.88;
      holder.add(band);

      // Structural ribs, distributed evenly along the whole abdomen
      // rather than one per tergum, so the count is independent of the
      // segment count.
      const ribs = Math.max(0, Math.round(S.ribCount));
      for (let rIdx = 0; rIdx < ribs; rIdx++) {
        const rt = (rIdx + 0.5) / ribs;
        if (rt < t0 || rt >= t1) continue;
        const local = (rt - t0) / (t1 - t0);
        const rib = new THREE.Mesh(
          new THREE.TorusGeometry(radAt(rt) * 0.99, ar * 0.045, 6, 22), M.frame);
        rib.position.z = segLen * local; rib.scale.y = 0.88;
        holder.add(rib);
      }
      // translucent window so the fuel load is readable
      if (i >= 1 && i <= n - 3) {
        const win = new THREE.Mesh(
          G.taperedTube(segLen * 0.62, (t) => radAt(t0 + 0.05) * 0.965, { radial: 18, steps: 3 }),
          M.fluid.clone());
        win.scale.y = 0.86; win.position.z = segLen * 0.2;
        win.material.opacity = 0.0; win.material.transparent = true;
        holder.add(win);
        rig.abdomenSegs[i].window = win;
      }
    }
    rig.abdomenTip = cur;
  }

  // ======================================================================
  // WINGS + HALTERES
  // ======================================================================
  const wl = S.wingLength * L, wc = S.wingChord * wl;
  for (const side of [1, -1]) {
    const mount = new THREE.Group();
    mount.position.set(side * tw * 0.30, th * S.wingRootHeight * 0.5, S.wingRootOffset * L);
    thorax.add(mount);

    const plane = new THREE.Group();   // stroke plane frame
    mount.add(plane);
    const phiBase = new THREE.Group(); // span points laterally at phi = 0
    phiBase.rotation.y = side * Math.PI / 2;
    plane.add(phiBase);
    const phi = new THREE.Group(); phiBase.add(phi);
    const theta = new THREE.Group(); phi.add(theta);
    const alpha = new THREE.Group(); theta.add(alpha);

    const wingMat = M.membrane.clone();
    const uni = {};
    makeWingDeformable(wingMat, uni);
    uni.uSpanLen.value = wl;
    rig.wingUniforms.push(uni);

    const wg = G.wingGeometry(wl, wc, S.wingCamber, S.wingTwistDeg);
    const wm = new THREE.Mesh(wg, wingMat);
    wm.renderOrder = 2;
    alpha.add(wm);

    // veins
    const veinMat = M.frame.clone();
    for (const vg of G.wingVeins(wl, wc, S.wingVeinCount)) {
      alpha.add(new THREE.Mesh(vg, veinMat));
    }
    // Anopheles diagnostic: blocks of dark scales along the veins
    for (let b = 0; b < S.wingScaleBlocks; b++) {
      const t = 0.18 + 0.78 * (b / Math.max(1, S.wingScaleBlocks - 1));
      const grow = Math.pow(Math.min(1, t / 0.18), 0.65);
      const tip = Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.9)), 0.55);
      const hwd = 0.5 * wc * grow * tip;
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(hwd * 1.8, wl * 0.055),
        M.scaleBand);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(0.12 * wc * Math.pow(t, 1.7), wc * 0.012, t * wl);
      alpha.add(patch);
    }
    // wing base sclerites
    const hinge = new THREE.Mesh(new THREE.SphereGeometry(wc * 0.26, 12, 8), M.joint);
    plane.add(hinge);

    // ---- stroke-blur ghosts ------------------------------------------
    // A wingbeat is always faster than the display. At 26 Hz on a 60 Hz
    // screen there are 2.3 frames per beat, so a single crisp wing
    // aliases into a slow wobble - the single most "fake" thing a bug can
    // do. These ghosts sample the wing back across the beat that just
    // happened and composite into the blurred fan a real mosquito shows.
    const ghosts = [];
    const GHOSTS = 11;
    const ghostMat = M.membrane.clone();
    ghostMat.transmission = 0;
    ghostMat.transparent = true;
    ghostMat.opacity = 0;
    ghostMat.depthWrite = false;
    ghostMat.iridescence = 0.35;
    const gUni = {};
    makeWingDeformable(ghostMat, gUni);
    gUni.uSpanLen.value = wl;
    for (let i = 0; i < GHOSTS; i++) {
      const gp = new THREE.Group(); gp.rotation.y = side * Math.PI / 2; plane.add(gp);
      const gphi = new THREE.Group(); gp.add(gphi);
      const gth = new THREE.Group(); gphi.add(gth);
      const gal = new THREE.Group(); gth.add(gal);
      const gm = new THREE.Mesh(wg, ghostMat);   // shares geometry
      gm.castShadow = false; gm.receiveShadow = false; gm.renderOrder = 1;
      gal.add(gm);
      ghosts.push({ phi: gphi, theta: gth, alpha: gal, mesh: gm });
    }

    rig.wings.push({
      side, mount, plane, phiBase, phi, theta, alpha, mesh: wm, uni,
      ghosts, ghostMat, ghostUni: gUni,
    });

    // Haltere: modified hindwing, beats antiphase. Missing = instantly wrong.
    const hm2 = new THREE.Group();
    hm2.position.set(side * tw * 0.26, -th * 0.06, -tl * 0.30);
    thorax.add(hm2);
    const hsw = new THREE.Group(); hm2.add(hsw);
    const hLen = S.haltereLength * L;
    hsw.add(new THREE.Mesh(
      G.taperedTube(hLen, (t) => S.haltereKnobRadius * L * (0.28 + 0.14 * t), { radial: 7, steps: 4 }), M.frame));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(S.haltereKnobRadius * L, 12, 9), M.shellDark);
    knob.position.z = hLen; hsw.add(knob);
    hsw.rotation.x = 1.15; hsw.rotation.y = side * 0.5;
    rig.halteres.push({ side, node: hsw, base: { x: 1.15, y: side * 0.5 } });
  }

  // ======================================================================
  // LEGS - coxa, trochanter, femur, tibia, 5 tarsomeres, pretarsus
  // ======================================================================
  const legDefs = [
    { pair: 0, z: 0.34, yaw: 52 * D, scale: S.legScalePair1 },   // fore
    { pair: 1, z: 0.00, yaw: 92 * D, scale: S.legScalePair2 },   // mid
    { pair: 2, z: -0.34, yaw: 133 * D, scale: S.legScalePair3 }, // hind
  ];
  for (const def of legDefs) {
    for (const side of [1, -1]) {
      const rootN = new THREE.Group();
      rootN.position.set(side * tw * 0.36, -th * 0.30, def.z * tl);
      rootN.rotation.order = 'YXZ';
      rootN.rotation.y = side * def.yaw;
      rootN.rotation.x = 0.55;
      thorax.add(rootN);

      const sc = def.scale * L;
      const lens = {
        coxa: S.legCoxa * sc, troch: S.legTrochanter * sc,
        femur: S.legFemur * sc, tibia: S.legTibia * sc,
        tarsus: S.legTarsus * sc,
      };
      const rad = S.legRadius * sc;

      const mk = (parent, len, r0, r1, mat, offset) => {
        const n = new THREE.Group();
        n.rotation.order = 'YXZ';
        if (offset) n.position.z = offset;
        parent.add(n);
        n.add(new THREE.Mesh(
          G.taperedTube(len, (t) => r0 + (r1 - r0) * t, { radial: 9, steps: 4 }), mat));
        n.add(new THREE.Mesh(G.collar(r0 * 1.4, len * 0.05, 0.4, 9), M.joint));
        n.userData.len = len;
        return n;
      };

      // One taper curve runs the whole limb, coxa to claw: r(u) shrinks
      // from the base to the tip by legTaper.
      const tp = Math.max(0.05, Math.min(1, S.legTaper));
      const rAt = (u) => rad * 1.5 * (1 - (1 - tp) * Math.pow(u, 0.85));
      const total = lens.coxa + lens.troch + lens.femur + lens.tibia + lens.tarsus;
      let acc = 0;
      const seg = (len) => { const a = acc / total; acc += len; return [rAt(a), rAt(acc / total)]; };

      let [r0, r1] = seg(lens.coxa);
      const coxa = mk(rootN, lens.coxa, r0, r1, M.joint, 0);
      [r0, r1] = seg(lens.troch);
      const troch = mk(coxa, lens.troch, r0, r1, M.joint, lens.coxa);
      [r0, r1] = seg(lens.femur);
      const femur = mk(troch, lens.femur, r0, r1, M.shellDark, lens.troch);
      [r0, r1] = seg(lens.tibia);
      const tibia = mk(femur, lens.tibia, r0, r1, M.frame, lens.femur);

      // 5 tarsomeres, progressively shorter, then the pretarsus + claws
      const tars = [];
      let cur = tibia, off = lens.tibia;
      const weights = [0.38, 0.22, 0.16, 0.13, 0.11];
      for (let i = 0; i < S.legTarsomeres; i++) {
        const w = weights[i % weights.length];
        const [tr0, tr1] = seg(lens.tarsus * w);
        const sgm = mk(cur, lens.tarsus * w, tr0, tr1, i % 2 ? M.shell : M.frame, off);
        tars.push(sgm);
        cur = sgm; off = lens.tarsus * w;
      }
      const pretarsus = new THREE.Group();
      pretarsus.position.z = off;
      cur.add(pretarsus);
      for (const cs of [-1, 1]) {
        const claw = new THREE.Mesh(
          G.taperedTube(S.clawLength * sc, (t) => rad * 0.3 * (1 - t), { radial: 6, steps: 4 }), M.steel);
        claw.position.x = cs * rad * 0.28;
        claw.rotation.x = 0.85; claw.rotation.y = cs * 0.45;
        pretarsus.add(claw);
      }
      // magnetic pad - robotic stand-in for the pulvilli
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.9, rad * 1.1, rad * 0.5, 12), M.accent.clone());
      pad.material.emissiveIntensity = 0.0;
      pad.rotation.x = Math.PI / 2; pad.position.z = rad * 0.3;
      pretarsus.add(pad);

      rig.legs.push({
        pair: def.pair, side, root: rootN, coxa, troch, femur, tibia,
        tarsomeres: tars, pretarsus, pad, lens,
        baseYaw: side * def.yaw, basePitch: 0.55,
        planted: false, plantPoint: new THREE.Vector3(), contact: 0,
      });
    }
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return rig;
}
