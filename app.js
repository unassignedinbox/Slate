(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const svgRoot = document.getElementById('skeletonCanvas');
  const groups = {
    rulers: document.getElementById('stageRulers'),
    farLimbs: document.getElementById('farLimbs'),
    tail: document.getElementById('tail'),
    ribs: document.getElementById('ribs'),
    spine: document.getElementById('spine'),
    pelvis: document.getElementById('pelvis'),
    nearLimbs: document.getElementById('nearLimbs'),
    skull: document.getElementById('skull'),
    mechanics: document.getElementById('mechanics'),
    annotations: document.getElementById('annotations'),
    ground: document.getElementById('groundLine')
  };

  const TAU = Math.PI * 2;
  const groundY = 727;
  const state = {
    mode: 'walk',
    playing: true,
    time: 0,
    speed: 1,
    zoom: 1,
    labels: true,
    mechanics: true,
    lastFrame: performance.now()
  };

  const cycleData = {
    walk: {
      title: 'Resonant walk', hz: 0.66, speed: '4.6', phase: '180°', duration: 1 / 0.66,
      tag: 'WALK / 0.66 Hz', label: 'CYCLE 01 / WALK',
      description: 'A measured, alternating bipedal gait. The tail is not a rigid counterweight: its interspinous ligaments are represented as a delayed vertical wave.'
    },
    run: {
      title: 'Fast walk / no turn', hz: 1.12, speed: '7.8', phase: '180°', duration: 1 / 1.12,
      tag: 'RUN / NO TURN', label: 'CYCLE 02 / RUN',
      description: 'A faster, grounded cycle rather than a movie-style sprint. Both feet stay in a plausible power exchange; the body does not pivot or turn.'
    },
    idle: {
      title: 'Alert idle', hz: 0.18, speed: '—', phase: 'weight', duration: 5.56,
      tag: 'IDLE / ALERT', label: 'LOOP 03 / IDLE',
      description: 'Small postural corrections keep the skeleton alive: a weight shift at the hips, a breathing-scale rib motion, and a quiet tail suspension.'
    },
    roar: {
      title: 'Threat display', hz: 0.32, speed: '—', phase: 'jaw', duration: 3.125,
      tag: 'ROAR / DISPLAY', label: 'LOOP 04 / ROAR',
      description: 'The neck rises from its resting S-curve and the lower jaw rotates from its joint. This is a skeletal display, not a fleshed-out vocalization.'
    },
    sniff: {
      title: 'Ground search', hz: 0.28, speed: '—', phase: 'head', duration: 3.57,
      tag: 'SNIFF / SEARCH', label: 'LOOP 05 / SNIFF',
      description: 'A restrained head-and-neck dip. The torso remains balanced over the hips while the skull searches low, without collapsing the vertebral column.'
    }
  };

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    });
    if (parent) parent.appendChild(node);
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function setAttrs(node, attrs) { Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value))); return node; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mod(v, n) { return ((v % n) + n) % n; }
  function deg(rad) { return rad * 180 / Math.PI; }
  function pt(x, y) { return { x, y }; }
  function add(a, b) { return pt(a.x + b.x, a.y + b.y); }
  function sub(a, b) { return pt(a.x - b.x, a.y - b.y); }
  function mul(a, k) { return pt(a.x * k, a.y * k); }
  function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function angle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  function rotate(p, radians) { return pt(p.x * Math.cos(radians) - p.y * Math.sin(radians), p.x * Math.sin(radians) + p.y * Math.cos(radians)); }
  function fmt(n) { return Number(n).toFixed(1); }

  function path(parent, d, cls, extra = {}) {
    return el('path', { d, class: cls, ...extra }, parent);
  }
  function line(parent, a, b, cls, extra = {}) {
    return el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls, ...extra }, parent);
  }
  function circle(parent, p, r, cls, extra = {}) {
    return el('circle', { cx: p.x, cy: p.y, r, class: cls, ...extra }, parent);
  }
  function text(parent, value, x, y, cls, extra = {}) {
    const node = el('text', { x, y, class: cls, ...extra }, parent);
    node.textContent = value;
    return node;
  }

  function worldPoint(origin, localX, localY, rotation) {
    return add(origin, rotate(pt(localX, localY), rotation));
  }

  function poseAt(time) {
    const data = cycleData[state.mode];
    const phase = time * TAU * data.hz;
    let bob = 0;
    let bodyAngle = 0;
    let headAngle = 0;
    let jawOpen = 3;
    let stride = 78;
    let footLift = 36;
    let tailAmp = 1;
    let headDip = 0;

    if (state.mode === 'walk') {
      bob = -6 * Math.abs(Math.sin(phase));
      bodyAngle = 0.009 * Math.sin(phase + .35);
      stride = 76;
      footLift = 32;
      tailAmp = 1;
    } else if (state.mode === 'run') {
      bob = -11 * Math.abs(Math.sin(phase));
      bodyAngle = 0.014 * Math.sin(phase + .35);
      stride = 126;
      footLift = 62;
      tailAmp = 1.22;
    } else if (state.mode === 'idle') {
      bob = -2.5 * Math.sin(phase);
      bodyAngle = 0.008 * Math.sin(phase + .5);
      stride = 5;
      footLift = 0;
      tailAmp = .42;
      headDip = 1.5 * Math.sin(phase + .4);
    } else if (state.mode === 'roar') {
      const roar = (Math.sin(phase - Math.PI / 2) + 1) / 2;
      const eased = roar * roar * (3 - 2 * roar);
      bob = -5 * eased;
      bodyAngle = -0.015 * eased;
      headAngle = -0.105 * eased;
      jawOpen = 5 + 25 * eased;
      tailAmp = .35;
      headDip = -7 * eased;
    } else if (state.mode === 'sniff') {
      const sniff = (Math.sin(phase - .7) + 1) / 2;
      const eased = sniff * sniff * (3 - 2 * sniff);
      bob = 3 * eased;
      bodyAngle = 0.012 * eased;
      headAngle = 0.14 * eased;
      jawOpen = 3 + 4 * eased;
      tailAmp = .46;
      headDip = 27 * eased;
    }

    const pelvis = pt(691, 438 + bob);
    const body = (x, y, extra = 0) => worldPoint(pelvis, x, y, bodyAngle + extra);
    const tail = [];
    const tailBase = body(-7, -7);
    for (let i = 0; i < 47; i++) {
      const u = i / 46;
      const x = tailBase.x - i * (13.5 - u * 2.8);
      const naturalCurve = 6 + 66 * u + 15 * u * u;
      const elasticWave = Math.sin(phase - u * 1.14 + .42) * (1.8 + 8.5 * u) * tailAmp;
      const idleSway = state.mode === 'idle' ? Math.sin(phase * .8 - u) * 3 * u : 0;
      tail.push(pt(x, tailBase.y + naturalCurve + elasticWave + idleSway));
    }

    const dorsals = [];
    for (let i = 0; i < 13; i++) dorsals.push(body(25 + i * 13.1, -38 + Math.sin(i * .55) * .8));
    const sacrals = [];
    for (let i = 0; i < 5; i++) sacrals.push(body(-27 + i * 12, -25 + Math.sin(i * .55) * .6));
    const cervicals = [];
    for (let i = 0; i < 10; i++) {
      const u = i / 9;
      cervicals.push(body(188 + i * 12.1, -40 - 56 * u + Math.sin(u * Math.PI) * 4 + headDip * u));
    }
    const shoulder = body(190, -43);
    const skullOrigin = body(298, -103 + headDip, headAngle);
    const hips = body(0, 0);
    const com = body(58, -4);

    return { data, phase, pelvis, body, tail, dorsals, sacrals, cervicals, shoulder, skullOrigin, hips, com, bodyAngle, headAngle, jawOpen, stride, footLift, groundY };
  }

  function drawRulers() {
    clear(groups.rulers);
    line(groups.rulers, pt(35, 80), pt(35, 705), 'axis-line');
    line(groups.rulers, pt(35, 705), pt(1163, 705), 'axis-line');
    for (let y = 105; y <= 680; y += 95) {
      line(groups.rulers, pt(29, y), pt(41, y), 'ground-tick');
      text(groups.rulers, String(800 - Math.round(y)), 8, y + 3, 'callout-small', { 'text-anchor': 'start', opacity: '.52' });
    }
    text(groups.rulers, 'mm / schematic', 8, 88, 'callout-small', { opacity: '.55' });
    text(groups.rulers, '0', 29, 716, 'callout-small', { opacity: '.55' });
  }

  function bonePath(a, b, widthA, widthB = widthA * .88, extra = 0) {
    const d = sub(b, a);
    const len = Math.max(.01, Math.hypot(d.x, d.y));
    const n = pt(-d.y / len, d.x / len);
    const u = pt(d.x / len, d.y / len);
    const aa = add(a, mul(u, -extra));
    const bb = add(b, mul(u, extra));
    const p1 = add(aa, mul(n, widthA));
    const p2 = add(bb, mul(n, widthB));
    const p3 = add(bb, mul(n, -widthB));
    const p4 = add(aa, mul(n, -widthA));
    const flareA = add(aa, mul(u, -Math.min(8, widthA * .42)));
    const flareB = add(bb, mul(u, Math.min(8, widthB * .42)));
    return `M ${fmt(p1.x)} ${fmt(p1.y)} Q ${fmt(flareA.x)} ${fmt(flareA.y)} ${fmt(p4.x)} ${fmt(p4.y)} L ${fmt(p3.x)} ${fmt(p3.y)} Q ${fmt(flareB.x)} ${fmt(flareB.y)} ${fmt(p2.x)} ${fmt(p2.y)} Z`;
  }

  function longBone(parent, a, b, width, cls = 'bone', opts = {}) {
    path(parent, bonePath(a, b, width, width * (opts.taper || .84), opts.flare || 0), cls);
    const d = sub(b, a);
    const len = Math.max(1, Math.hypot(d.x, d.y));
    const n = pt(-d.y / len, d.x / len);
    const start = add(a, add(mul(d, .18), mul(n, width * .18)));
    const end = add(a, add(mul(d, .8), mul(n, width * .12)));
    path(parent, `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(end.x)} ${fmt(end.y)}`, 'bone-highlight');
    if (opts.joints !== false) {
      circle(parent, a, width * .82, cls === 'far-bone' ? 'joint' : 'joint');
      circle(parent, b, width * .66, cls === 'far-bone' ? 'joint' : 'joint');
    }
  }

  function vertebra(parent, p, radians, len, h, kind = 'dorsal', opacity = 1) {
    const g = el('g', { transform: `translate(${fmt(p.x)} ${fmt(p.y)}) rotate(${fmt(deg(radians))})`, opacity }, parent);
    const bodyD = `M ${fmt(-len * .53)} ${fmt(-h * .28)} Q ${fmt(-len * .38)} ${fmt(-h * .54)} 0 ${fmt(-h * .46)} Q ${fmt(len * .4)} ${fmt(-h * .48)} ${fmt(len * .55)} ${fmt(-h * .2)} L ${fmt(len * .5)} ${fmt(h * .25)} Q ${fmt(len * .28)} ${fmt(h * .46)} 0 ${fmt(h * .39)} Q ${fmt(-len * .4)} ${fmt(h * .45)} ${fmt(-len * .52)} ${fmt(h * .18)} Z`;
    path(g, bodyD, kind === 'caudal' ? 'bone-light' : 'bone');
    const spineHeight = kind === 'cervical' ? h * 1.12 : kind === 'caudal' ? h * 1.25 : h * 1.55;
    path(g, `M ${fmt(-len * .23)} ${fmt(-h * .27)} L ${fmt(-len * .09)} ${fmt(-spineHeight)} Q 0 ${fmt(-spineHeight * 1.12)} ${fmt(len * .12)} ${fmt(-h * .25)} Z`, 'vertebra-spine');
    if (kind !== 'caudal' || len > 11) {
      path(g, `M ${fmt(-len * .12)} ${fmt(h * .2)} Q 0 ${fmt(h * .7)} ${fmt(len * .15)} ${fmt(h * .16)}`, 'vertebra-process');
      line(g, pt(-len * .52, 0), pt(len * .52, 0), 'bone-detail', { opacity: '.55' });
    }
    if (kind === 'sacral') {
      path(g, `M ${fmt(-len * .42)} ${fmt(-h * .7)} Q 0 ${fmt(-h * 1.18)} ${fmt(len * .38)} ${fmt(-h * .64)}`, 'bone-highlight');
    }
    return g;
  }

  function drawTail(pose) {
    clear(groups.tail);
    const tail = pose.tail;
    for (let i = 46; i >= 0; i--) {
      const p = tail[i];
      const next = tail[Math.max(0, i - 1)];
      const prev = tail[Math.min(46, i + 1)];
      const rad = angle(prev, next);
      const u = i / 46;
      const len = 18 - 8.6 * u;
      const h = 12.8 - 9.4 * u;
      vertebra(groups.tail, p, rad, len, h, 'caudal', .96);
      if (i < 45) {
        const c = add(p, mul(sub(next, p), .55));
        const width = Math.max(1.3, 3.4 - u * 2.1);
        path(groups.tail, `M ${fmt(c.x - width)} ${fmt(c.y + 2)} L ${fmt(c.x)} ${fmt(c.y + width * 2.2)} L ${fmt(c.x + width)} ${fmt(c.y + 2)}`, 'vertebra-spine', { opacity: '.72' });
      }
    }
    // A small, unmistakable serial marker keeps the count legible without turning the model into a diagram.
    const marker = tail[13];
    circle(groups.tail, marker, 4, 'callout-dot', { opacity: '.9' });
  }

  function drawRibs(pose) {
    clear(groups.ribs);
    pose.dorsals.forEach((p, i) => {
      const u = i / 12;
      const end = pose.body(28 + i * 13.1 + 9, 95 + Math.sin(u * Math.PI) * 10);
      const c1 = pose.body(18 + i * 13.1, 25);
      const c2 = pose.body(25 + i * 13.1, 84 + Math.sin(u * Math.PI) * 8);
      path(groups.ribs, `M ${fmt(p.x - 4)} ${fmt(p.y + 5)} C ${fmt(c1.x - 18)} ${fmt(c1.y)} ${fmt(c2.x - 29)} ${fmt(c2.y)} ${fmt(end.x)} ${fmt(end.y)} C ${fmt(end.x + 5)} ${fmt(end.y + 5)} ${fmt(end.x + 5)} ${fmt(end.y + 9)} ${fmt(end.x + 2)} ${fmt(end.y + 13)}`, 'rib', { opacity: .75 - .13 * u });
      // A short proximal articulation makes the rib look seated in the transverse process.
      circle(groups.ribs, p, 3.1, 'joint', { opacity: .8 });
    });

    // Eighteen segmented gastralia, curved like paired belly ribs rather than straight decorative lines.
    for (let i = 0; i < 18; i++) {
      const u = i / 17;
      const x = 35 + u * 183;
      const p = pose.body(x, 78 + 6 * Math.sin(u * Math.PI));
      const left = pt(p.x - 19, p.y + 11);
      const right = pt(p.x + 17, p.y + 11);
      path(groups.ribs, `M ${fmt(left.x)} ${fmt(left.y)} Q ${fmt(p.x)} ${fmt(p.y - 7)} ${fmt(right.x)} ${fmt(right.y)}`, 'gastralia', { opacity: .72 - .16 * u });
    }
  }

  function drawSpine(pose) {
    clear(groups.spine);
    pose.sacrals.forEach((p, i) => vertebra(groups.spine, p, pose.bodyAngle, 19, 19, 'sacral', .97));
    // a subtle fused neural ridge conveys the sacrum as a unit
    if (pose.sacrals.length) {
      const a = pose.sacrals[0];
      const b = pose.sacrals[4];
      path(groups.spine, `M ${fmt(a.x - 7)} ${fmt(a.y - 17)} Q ${fmt((a.x + b.x) / 2)} ${fmt(a.y - 34)} ${fmt(b.x + 10)} ${fmt(b.y - 15)}`, 'bone-detail', { 'stroke-width': '3', opacity: '.9' });
    }
    pose.dorsals.forEach((p, i) => vertebra(groups.spine, p, pose.bodyAngle, 19.5, 17.5, 'dorsal', .98));
    pose.cervicals.forEach((p, i) => {
      const next = pose.cervicals[Math.min(9, i + 1)];
      const prev = pose.cervicals[Math.max(0, i - 1)];
      vertebra(groups.spine, p, angle(prev, next), 18.5 - i * .25, 19 - Math.abs(i - 4.5) * .6, 'cervical', .97);
    });
  }

  function drawPelvis(pose) {
    clear(groups.pelvis);
    const g = el('g', { transform: `translate(${fmt(pose.pelvis.x)} ${fmt(pose.pelvis.y)}) rotate(${fmt(deg(pose.bodyAngle))})` }, groups.pelvis);
    // The tall ilium, deep acetabulum, long pubis and descending ischium are kept as one connected pelvis.
    path(g, 'M -38 -7 L -28 -66 Q 2 -95 61 -77 L 91 -52 L 67 -25 L 25 -13 L 51 42 L 41 83 L 17 88 L 4 31 L -17 13 L -54 26 L -72 10 Z', 'bone-light');
    path(g, 'M 26 -10 Q 72 2 94 29 L 80 42 L 50 33 L 22 9 Z', 'bone');
    path(g, 'M -11 10 L 38 31 L 29 80 L 8 82 L -2 35 Z', 'bone');
    path(g, 'M 32 -72 L 73 -52 L 59 -34 L 17 -38 Z', 'bone-detail');
    circle(g, pt(5, 2), 18, 'socket');
    circle(g, pt(5, 2), 8, 'joint');
    path(g, 'M -43 -4 Q -15 -35 20 -40', 'bone-highlight');
    path(g, 'M -17 13 Q 15 25 42 69', 'bone-highlight');
  }

  function solveTwoBone(hip, target, l1, l2, bend = -1) {
    const dx = target.x - hip.x;
    const dy = target.y - hip.y;
    const raw = Math.hypot(dx, dy);
    const d = clamp(raw, Math.abs(l1 - l2) + .01, l1 + l2 - .01);
    const base = Math.atan2(dy, dx);
    const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const knee = add(hip, pt(Math.cos(base + bend * a) * l1, Math.sin(base + bend * a) * l1));
    return { hip, knee, ankle: target };
  }

  function stepTarget(pose, side) {
    const data = pose.data;
    if (state.mode === 'idle' || state.mode === 'roar' || state.mode === 'sniff') {
      const quiet = state.mode === 'idle' ? Math.sin(pose.phase + side * Math.PI) * 3 : 0;
      return pt(pose.hips.x + 21 + quiet + side * 7, groundY - (state.mode === 'idle' ? Math.max(0, -Math.sin(pose.phase + side * Math.PI)) * 2 : 0));
    }
    const cycle = mod(pose.phase / TAU + side * .5, 1);
    const stance = .59;
    let x;
    let lift = 0;
    if (cycle < stance) {
      const u = cycle / stance;
      x = lerp(-pose.stride * .5, pose.stride * .5, u);
    } else {
      const u = (cycle - stance) / (1 - stance);
      x = lerp(pose.stride * .5, -pose.stride * .5, u);
      lift = Math.sin(Math.PI * u) * pose.footLift;
    }
    return pt(pose.hips.x + 21 + x + side * 7, groundY - lift);
  }

  function drawFoot(parent, ankle, target, cls) {
    const dir = pt(1, 0);
    const footBase = pt(target.x - 1, target.y - 3);
    longBone(parent, ankle, footBase, 10, cls, { taper: .72, flare: 2 });
    // Arctometatarsus: the central metatarsal is pinched between II and IV.
    const toes = [
      { y: -12, len: 42, w: 5 },
      { y: -2, len: 51, w: 5.5 },
      { y: 9, len: 38, w: 4.5 }
    ];
    toes.forEach((toe, i) => {
      const start = pt(footBase.x + 4, footBase.y + toe.y);
      const mid = pt(start.x + toe.len * .56, start.y + toe.y * .12);
      const tip = pt(start.x + toe.len, start.y + toe.y * .18 + (i === 0 ? -5 : i === 2 ? 5 : 0));
      longBone(parent, start, mid, toe.w, cls, { taper: .7, flare: 1 });
      longBone(parent, mid, tip, toe.w * .7, cls, { taper: .68, flare: 0 });
      const claw = pt(tip.x + 12, tip.y + (i === 0 ? 7 : i === 2 ? 5 : 6));
      path(parent, `M ${fmt(tip.x - 2)} ${fmt(tip.y - 1)} Q ${fmt(tip.x + 10)} ${fmt(tip.y + 1)} ${fmt(claw.x)} ${fmt(claw.y)} Q ${fmt(tip.x + 8)} ${fmt(tip.y + 8)} ${fmt(tip.x - 2)} ${fmt(tip.y + 4)} Z`, cls === 'far-bone' ? 'far-bone' : 'bone-light');
    });
  }

  function drawLeg(parent, pose, side, far = false) {
    const hip = pose.body(-1 + side * 7, 8);
    const target = stepTarget(pose, side);
    const leg = solveTwoBone(hip, target, 171, 177, -1);
    const cls = far ? 'far-bone' : 'bone';
    // Femur has a visibly expanded head and distal condyles; it is not a line segment.
    longBone(parent, leg.hip, leg.knee, far ? 17 : 20, cls, { taper: .78, flare: 4 });
    longBone(parent, leg.knee, leg.ankle, far ? 13 : 16, cls, { taper: .72, flare: 3 });
    circle(parent, leg.hip, far ? 15 : 17, far ? 'far-bone' : 'joint');
    circle(parent, leg.knee, far ? 14 : 16, far ? 'far-bone' : 'joint');
    circle(parent, leg.ankle, far ? 10 : 12, far ? 'far-bone' : 'joint');
    drawFoot(parent, leg.ankle, target, cls);
    // Patella/ankle articulation marks
    line(parent, add(leg.knee, pt(-7, -4)), add(leg.knee, pt(8, 3)), 'bone-detail', { opacity: far ? '.3' : '.7' });
  }

  function armPose(pose, side) {
    const shoulder = pose.body(185 + side * 8, -48 + side * 5);
    const wrist = pose.body(249 + side * 7, 57 + side * 7 + (state.mode === 'roar' ? 5 : 0));
    const elbow = pt(shoulder.x + 37 + side * 5, shoulder.y + 47 + side * 3);
    return { shoulder, elbow, wrist };
  }

  function drawArm(parent, pose, side, far = false) {
    const a = armPose(pose, side);
    const cls = far ? 'far-bone' : 'bone';
    // Scapula is a broad blade tucked behind the shoulder girdle.
    path(parent, `M ${fmt(a.shoulder.x - 29)} ${fmt(a.shoulder.y - 19)} Q ${fmt(a.shoulder.x - 4)} ${fmt(a.shoulder.y - 31)} ${fmt(a.shoulder.x + 22)} ${fmt(a.shoulder.y - 8)} L ${fmt(a.shoulder.x + 7)} ${fmt(a.shoulder.y + 11)} L ${fmt(a.shoulder.x - 27)} ${fmt(a.shoulder.y + 2)} Z`, cls);
    longBone(parent, a.shoulder, a.elbow, far ? 10 : 12, cls, { taper: .76, flare: 3 });
    longBone(parent, a.elbow, a.wrist, far ? 8 : 10, cls, { taper: .72, flare: 2 });
    circle(parent, a.shoulder, 10, far ? 'far-bone' : 'joint');
    circle(parent, a.elbow, 8, far ? 'far-bone' : 'joint');
    circle(parent, a.wrist, 7, far ? 'far-bone' : 'joint');
    // Two functional digits and a vestigial splint-like third metacarpal.
    const hand = pt(a.wrist.x + 7, a.wrist.y + 3);
    for (let i = 0; i < 2; i++) {
      const base = pt(hand.x + i * 4, hand.y + i * 5 - 4);
      const tip = pt(base.x + 25 - i * 3, base.y + 12 + i * 5);
      longBone(parent, base, tip, far ? 3.1 : 3.8, cls, { taper: .65, flare: 1 });
      path(parent, `M ${fmt(tip.x - 2)} ${fmt(tip.y)} Q ${fmt(tip.x + 8)} ${fmt(tip.y + 3)} ${fmt(tip.x + 13)} ${fmt(tip.y + 11)} Q ${fmt(tip.x + 4)} ${fmt(tip.y + 7)} ${fmt(tip.x - 3)} ${fmt(tip.y + 4)} Z`, far ? 'far-bone' : 'bone-light');
    }
    line(parent, pt(hand.x + 2, hand.y - 3), pt(hand.x + 15, hand.y - 5), 'bone-detail', { opacity: far ? '.3' : '.7' });
  }

  function drawLimbs(pose) {
    clear(groups.farLimbs);
    clear(groups.nearLimbs);
    // Far side is darker and placed first so the articulation depth reads in 2D.
    drawLeg(groups.farLimbs, pose, 1, true);
    drawArm(groups.farLimbs, pose, 1, true);
    drawLeg(groups.nearLimbs, pose, 0, false);
    drawArm(groups.nearLimbs, pose, 0, false);
  }

  function drawSkull(pose) {
    clear(groups.skull);
    const o = pose.skullOrigin;
    const g = el('g', { transform: `translate(${fmt(o.x)} ${fmt(o.y)}) rotate(${fmt(deg(pose.headAngle + pose.bodyAngle))})` }, groups.skull);
    // High occiput, deep cheek and long rostrum based on tyrannosaurid skull architecture.
    path(g, 'M -6 15 Q 0 -26 35 -63 Q 61 -84 107 -88 L 173 -80 L 213 -59 L 270 -30 L 264 -7 L 223 1 L 186 22 L 119 25 L 69 33 L 28 29 Z', 'bone-light');
    path(g, 'M 17 -49 Q 46 -87 91 -75 L 117 -54 L 82 -36 L 44 -33 Z', 'bone');
    path(g, 'M 178 -75 L 211 -57 L 236 -35 L 219 -16 L 181 -25 L 150 -49 Z', 'bone');
    // Major fenestrae are open/dark so this reads as a skull rather than a solid mask.
    el('ellipse', { cx: 83, cy: -48, rx: 25, ry: 17, class: 'fenestra', transform: 'rotate(-7 83 -48)' }, g);
    el('ellipse', { cx: 151, cy: -42, rx: 32, ry: 20, class: 'fenestra', transform: 'rotate(7 151 -42)' }, g);
    el('ellipse', { cx: 214, cy: -30, rx: 16, ry: 10, class: 'fenestra' }, g);
    el('ellipse', { cx: 228, cy: -25, rx: 7, ry: 4, class: 'socket' }, g);
    circle(g, pt(80, -35), 7, 'socket');
    circle(g, pt(80, -35), 2.2, 'joint');
    path(g, 'M 38 -16 Q 102 -2 160 -7 Q 213 -8 261 -21', 'skull-line');
    path(g, 'M 110 -59 Q 134 -24 177 -18', 'skull-line');
    path(g, 'M 18 3 Q 78 12 127 8', 'skull-line');
    // Upper tooth row.
    for (let i = 0; i < 9; i++) {
      const x = 101 + i * 17;
      const h = i < 2 ? 10 : i > 7 ? 7 : 13;
      path(g, `M ${x} -4 L ${x + 6} -3 L ${x + 3} ${h} Z`, 'tooth');
    }
    // Lower jaw is a real articulated element, not a painted mouth line.
    const jaw = el('g', { transform: `rotate(${fmt(pose.jawOpen)} 7 24)` }, g);
    path(jaw, 'M 7 22 L 258 7 L 239 31 L 170 43 L 79 49 L 32 40 Z', 'bone-light');
    path(jaw, 'M 40 27 Q 122 34 213 19', 'skull-line');
    path(jaw, 'M 10 23 L 34 40', 'bone-highlight');
    for (let i = 0; i < 8; i++) {
      const x = 96 + i * 17;
      path(jaw, `M ${x} ${28 - i * .5} L ${x + 5} ${28 - i * .5} L ${x + 2} ${16 - i * .2} Z`, 'tooth');
    }
    // Quadrate and the mandibular hinge remain visible behind the jaw.
    line(g, pt(12, 9), pt(18, 25), 'bone-detail', { 'stroke-width': '4' });
    circle(g, pt(8, 20), 8, 'joint');
  }

  function drawGround() {
    clear(groups.ground);
    line(groups.ground, pt(48, groundY + 1), pt(1160, groundY + 1), 'ground');
    for (let x = 85; x < 1160; x += 80) line(groups.ground, pt(x, groundY - 3), pt(x, groundY + 8), 'ground-tick');
    text(groups.ground, 'ground reference / feet do not slide through plane', 883, groundY + 23, 'callout-small', { 'text-anchor': 'end', opacity: '.5' });
  }

  function callout(parent, title, subtitle, anchor, label, side = 'right') {
    const elbowX = side === 'right' ? label.x - 20 : label.x + 20;
    const endX = side === 'right' ? label.x - 8 : label.x + 8;
    path(parent, `M ${fmt(anchor.x)} ${fmt(anchor.y)} L ${fmt(elbowX)} ${fmt(anchor.y)} L ${fmt(endX)} ${fmt(label.y - 5)}`, 'callout-line');
    circle(parent, anchor, 3, 'callout-dot');
    text(parent, title, label.x, label.y, 'callout-text', { 'text-anchor': side === 'right' ? 'start' : 'end' });
    text(parent, subtitle, label.x, label.y + 15, 'callout-small', { 'text-anchor': side === 'right' ? 'start' : 'end' });
  }

  function drawMechanics(pose) {
    clear(groups.mechanics);
    if (!state.mechanics) return;
    circle(groups.mechanics, pose.com, 10, 'com-ring');
    line(groups.mechanics, pt(pose.com.x - 15, pose.com.y), pt(pose.com.x + 15, pose.com.y), 'com-cross');
    line(groups.mechanics, pt(pose.com.x, pose.com.y - 15), pt(pose.com.x, pose.com.y + 15), 'com-cross');
    text(groups.mechanics, 'COM', pose.com.x + 15, pose.com.y - 10, 'callout-small', { fill: '#d88863' });
    const wavePoints = pose.tail.filter((_, i) => i % 2 === 0);
    const d = wavePoints.map((p, i) => `${i ? 'L' : 'M'} ${fmt(p.x)} ${fmt(p.y - 25)}`).join(' ');
    path(groups.mechanics, d, 'tail-wave');
    text(groups.mechanics, 'elastic tail wave', 236, 593, 'callout-small', { fill: '#d88863', opacity: '.75' });
    path(groups.mechanics, `M ${fmt(pose.tail[4].x)} ${fmt(pose.tail[4].y - 22)} Q 174 590 232 590`, 'callout-line', { stroke: '#d88863', opacity: '.5' });
  }

  function drawAnnotations(pose) {
    clear(groups.annotations);
    if (!state.labels) return;
    callout(groups.annotations, '10 cervical', 'short, deep S-curve', pose.cervicals[4], pt(1018, 164), 'right');
    callout(groups.annotations, '47 caudals', 'tapering serial bones', pose.tail[20], pt(220, 664), 'left');
    callout(groups.annotations, 'arctometatarsus', 'pinched central metatarsal', pose.body(29, 270), pt(942, 705), 'right');
    callout(groups.annotations, 'two digits', 'functional claws / hand', pose.body(273, 66), pt(1017, 532), 'right');
    callout(groups.annotations, 'horizontal trunk', 'tail clears the ground', pose.body(120, -38), pt(570, 152), 'right');
  }

  function render() {
    const pose = poseAt(state.time);
    drawRulers();
    drawGround();
    drawTail(pose);
    drawRibs(pose);
    drawSpine(pose);
    drawPelvis(pose);
    drawLimbs(pose);
    drawSkull(pose);
    drawMechanics(pose);
    drawAnnotations(pose);
    updateUi(pose);
  }

  function updateUi(pose) {
    const data = cycleData[state.mode];
    const cycleTime = mod(state.time, data.duration);
    const progress = cycleTime / data.duration;
    const timeline = document.getElementById('timeline');
    timeline.value = String(Math.round(progress * 1000));
    timeline.style.setProperty('--progress', `${progress * 100}%`);
    document.getElementById('timeLabel').textContent = `${cycleTime.toFixed(2).padStart(5, '0')} s`;
    document.getElementById('cycleLabel').textContent = data.label;
    document.getElementById('modelTagText').textContent = data.tag;
    document.getElementById('cycleTitle').textContent = data.title;
    document.getElementById('cycleDescription').textContent = data.description;
    document.getElementById('cycleHz').textContent = state.mode === 'idle' || state.mode === 'roar' || state.mode === 'sniff' ? '—' : data.hz.toFixed(2);
    document.getElementById('cycleSpeed').textContent = data.speed;
    document.getElementById('cyclePhase').textContent = data.phase;
  }

  function chooseMode(mode) {
    if (!cycleData[mode]) return;
    state.mode = mode;
    state.time = 0;
    document.querySelectorAll('.mode-tab').forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    render();
  }

  document.querySelectorAll('.mode-tab').forEach(button => button.addEventListener('click', () => chooseMode(button.dataset.mode)));
  document.querySelectorAll('.speed-control button').forEach(button => button.addEventListener('click', () => {
    state.speed = Number(button.dataset.speed);
    document.querySelectorAll('.speed-control button').forEach(item => item.classList.toggle('selected', item === button));
  }));

  document.getElementById('playToggle').addEventListener('click', () => {
    state.playing = !state.playing;
    const button = document.getElementById('playToggle');
    button.setAttribute('aria-label', state.playing ? 'Pause animation' : 'Play animation');
    document.querySelector('.play-icon').textContent = state.playing ? 'Ⅱ' : '▶';
    document.getElementById('playText').textContent = state.playing ? 'Pause' : 'Play';
  });

  document.getElementById('timeline').addEventListener('input', event => {
    state.time = Number(event.target.value) / 1000 * cycleData[state.mode].duration;
    render();
  });

  document.getElementById('labelsToggle').addEventListener('click', event => {
    state.labels = !state.labels;
    event.currentTarget.setAttribute('aria-pressed', state.labels ? 'true' : 'false');
    render();
  });
  document.getElementById('mechanicsToggle').addEventListener('click', event => {
    state.mechanics = !state.mechanics;
    event.currentTarget.setAttribute('aria-pressed', state.mechanics ? 'true' : 'false');
    render();
  });

  function applyZoom() {
    document.getElementById('skeletonCanvas').style.transform = `scale(${state.zoom})`;
    document.getElementById('zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
  }
  document.getElementById('zoomIn').addEventListener('click', () => { state.zoom = clamp(state.zoom + .1, .8, 1.35); applyZoom(); });
  document.getElementById('zoomOut').addEventListener('click', () => { state.zoom = clamp(state.zoom - .1, .8, 1.35); applyZoom(); });
  document.getElementById('zoomReset').addEventListener('click', () => { state.zoom = 1; applyZoom(); });

  function frame(now) {
    const dt = Math.min(.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    if (state.playing) state.time += dt * state.speed;
    render();
    requestAnimationFrame(frame);
  }

  drawRulers();
  drawGround();
  render();
  requestAnimationFrame(frame);
})();
