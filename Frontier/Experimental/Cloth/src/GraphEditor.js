/**
 * Substance Designer-Style Procedural Node Graph & 2D Couture Pattern CAD Editor
 * Lives on the Left Pane of the Workspace and drives the 3D WebGPU Dress Simulation on the Right.
 */

import { COLOR_PALETTES } from "./presets.js";
import { DRESS_STYLES, WEAVE_TYPES } from "./DressGenerator.js";
import { PieSizingEstimator } from "./PieSizingEstimator.js";

export class SubstanceClothGraphEditor {
  constructor(options) {
    this.graphCanvas = options.graphCanvas;
    this.patternCanvas = options.patternCanvas;
    this.getParams = options.getParams;
    this.onChangeParam = options.onChangeParam;
    this.onSelectNode = options.onSelectNode;

    // Graph pan & zoom state
    this.panX = 24;
    this.panY = 22;
    this.zoom = 0.88;
    this.selectedNodeId = "pie";
    this.hoveredNodeId = null;
    this.hoveredHandle = null;
    this.animPhase = 0;

    // Define the 8 Substance Designer Procedural Garment, PIE Sizing & Material Nodes
    this.nodes = [
      {
        id: "bodice",
        title: "Bodice Pattern",
        category: "2D PATTERN",
        color: "#efa56f",
        x: 20,
        y: 22,
        w: 152,
        h: 128,
        bypassed: false,
        inputs: [],
        outputs: [{ id: "out", label: "Bodice 2D" }],
        params: ["necklineDepth", "strapWidth", "sleeveDrape"],
      },
      {
        id: "skirt",
        title: "Skirt Silhouette",
        category: "2D PATTERN",
        color: "#efa56f",
        x: 20,
        y: 174,
        w: 152,
        h: 128,
        bypassed: false,
        inputs: [],
        outputs: [{ id: "out", label: "Skirt 2D" }],
        params: ["dressStyle", "skirtLength", "skirtFlare", "asymmetry"],
      },
      {
        id: "pleats",
        title: "Radial Pleater",
        category: "FOLD MODIFIER",
        color: "#5bc0be",
        x: 206,
        y: 174,
        w: 152,
        h: 128,
        bypassed: false,
        inputs: [{ id: "in", label: "Skirt In" }],
        outputs: [{ id: "out", label: "Pleated" }],
        params: ["pleatCount", "pleatDepth", "bendStiffness"],
      },
      {
        id: "pie",
        title: "PIE Sizing Map",
        category: "SIGGRAPH 25",
        color: "#ff7b72",
        x: 206,
        y: 22,
        w: 152,
        h: 128,
        bypassed: false,
        inputs: [
          { id: "bodice", label: "Bodice" },
          { id: "pleats", label: "Folds" },
        ],
        outputs: [{ id: "sizing", label: "r(u,v)" }],
        params: ["pieAutoResolution", "pieAnisotropy", "pieLockingRelief", "pieShirringRatio"],
      },
      {
        id: "seams",
        title: "Seam Assembler",
        category: "3D TAILORING",
        color: "#5aa9ff",
        x: 396,
        y: 92,
        w: 156,
        h: 134,
        bypassed: false,
        inputs: [
          { id: "sizing", label: "PIE r(u,v)" },
          { id: "skirt", label: "Skirt" },
        ],
        outputs: [{ id: "mesh", label: "3D Garment" }],
        params: ["waistCinch", "gridResolution", "stretchCompliance"],
      },
      {
        id: "weave",
        title: "Weave Generator",
        category: "SUBSTANCE MAP",
        color: "#34c759",
        x: 206,
        y: 326,
        w: 152,
        h: 128,
        bypassed: false,
        inputs: [],
        outputs: [{ id: "normal", label: "Micro-Weave" }],
        params: ["weaveType", "weaveScale", "weaveBump"],
      },
      {
        id: "dye",
        title: "Dye & Sheen Ramp",
        category: "PBR FABRIC",
        color: "#c77dff",
        x: 396,
        y: 326,
        w: 156,
        h: 128,
        bypassed: false,
        inputs: [{ id: "weave", label: "Weave" }],
        outputs: [{ id: "mat", label: "PBR Shader" }],
        params: ["colorPalette", "sheenIntensity", "fabricRoughness", "hemTrim"],
      },
      {
        id: "output",
        title: "WebGPU Cloth Out",
        category: "LIVE SOLVER",
        color: "#ffd166",
        x: 590,
        y: 204,
        w: 162,
        h: 138,
        bypassed: false,
        inputs: [
          { id: "mesh", label: "Garment" },
          { id: "mat", label: "Material" },
        ],
        outputs: [],
        params: ["substeps", "windSpeed", "avatarPose"],
      },
    ];

    this.links = [
      { from: "bodice", fromOut: 0, to: "pie", toIn: 0 },
      { from: "skirt", fromOut: 0, to: "pleats", toIn: 0 },
      { from: "pleats", fromOut: 0, to: "pie", toIn: 1 },
      { from: "pie", fromOut: 0, to: "seams", toIn: 0 },
      { from: "pleats", fromOut: 0, to: "seams", toIn: 1 },
      { from: "seams", fromOut: 0, to: "output", toIn: 0 },
      { from: "weave", fromOut: 0, to: "dye", toIn: 0 },
      { from: "dye", fromOut: 0, to: "output", toIn: 1 },
    ];

    this.patternHandles = [];
    this.bindGraphEvents();
    this.bindPatternEvents();
  }

  frameAll() {
    if (!this.graphCanvas) return;
    const rect = this.graphCanvas.getBoundingClientRect();
    const graphW = 810;
    const graphH = 490;
    const zx = (rect.width - 36) / graphW;
    const zy = (rect.height - 36) / graphH;
    this.zoom = Math.max(0.45, Math.min(1.15, Math.min(zx, zy)));
    this.panX = Math.max(12, (rect.width - graphW * this.zoom) * 0.5);
    this.panY = Math.max(12, (rect.height - graphH * this.zoom) * 0.5);
    this.render();
  }

  autoLayout() {
    const positions = {
      bodice: [20, 22],
      skirt: [20, 174],
      pleats: [206, 174],
      pie: [206, 22],
      seams: [396, 92],
      weave: [206, 326],
      dye: [396, 326],
      output: [590, 204],
    };
    for (const node of this.nodes) {
      if (positions[node.id]) {
        node.x = positions[node.id][0];
        node.y = positions[node.id][1];
      }
    }
    this.frameAll();
  }

  screenToGraph(clientX, clientY) {
    const rect = this.graphCanvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  hitTestNode(gx, gy) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (gx >= n.x && gx <= n.x + n.w && gy >= n.y && gy <= n.y + n.h) {
        const isBypassBtn =
          gx >= n.x + n.w - 26 && gx <= n.x + n.w - 4 && gy >= n.y + 4 && gy <= n.y + 24;
        return { node: n, isBypassBtn };
      }
    }
    return null;
  }

  bindGraphEvents() {
    if (!this.graphCanvas) return;
    let dragState = null;

    this.graphCanvas.addEventListener("pointerdown", (e) => {
      this.graphCanvas.setPointerCapture(e.pointerId);
      const { x, y } = this.screenToGraph(e.clientX, e.clientY);
      const hit = this.hitTestNode(x, y);

      if (hit && e.button === 0) {
        const { node, isBypassBtn } = hit;
        if (isBypassBtn && node.id !== "output" && node.id !== "seams") {
          node.bypassed = !node.bypassed;
          if (node.id === "pleats") {
            this.onChangeParam?.("pleatDepth", node.bypassed ? 0.0 : 0.022);
          } else if (node.id === "weave") {
            this.onChangeParam?.("weaveBump", node.bypassed ? 0.0 : 0.45);
          } else if (node.id === "pie") {
            this.onChangeParam?.("pieAutoResolution", !node.bypassed);
          }
          this.render();
          return;
        }
        this.selectedNodeId = node.id;
        this.onSelectNode?.(node);
        dragState = {
          mode: "node",
          node,
          startX: e.clientX,
          startY: e.clientY,
          origX: node.x,
          origY: node.y,
        };
        this.render();
      } else {
        dragState = {
          mode: "pan",
          startX: e.clientX,
          startY: e.clientY,
          origPanX: this.panX,
          origPanY: this.panY,
        };
      }
    });

    this.graphCanvas.addEventListener("pointermove", (e) => {
      if (!dragState) {
        const { x, y } = this.screenToGraph(e.clientX, e.clientY);
        const hit = this.hitTestNode(x, y);
        const hovId = hit ? hit.node.id : null;
        if (hovId !== this.hoveredNodeId) {
          this.hoveredNodeId = hovId;
          this.graphCanvas.style.cursor = hovId ? "grab" : "default";
          this.render();
        }
        return;
      }
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (dragState.mode === "node") {
        dragState.node.x = Math.round(dragState.origX + dx / this.zoom);
        dragState.node.y = Math.round(dragState.origY + dy / this.zoom);
        this.render();
      } else if (dragState.mode === "pan") {
        this.panX = dragState.origPanX + dx;
        this.panY = dragState.origPanY + dy;
        this.render();
      }
    });

    ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) =>
      this.graphCanvas.addEventListener(ev, () => {
        dragState = null;
      }),
    );

    this.graphCanvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = this.graphCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const prevZoom = this.zoom;
        const factor = e.deltaY < 0 ? 1.09 : 0.92;
        this.zoom = Math.max(0.42, Math.min(1.65, this.zoom * factor));
        this.panX = mx - ((mx - this.panX) / prevZoom) * this.zoom;
        this.panY = my - ((my - this.panY) / prevZoom) * this.zoom;
        this.render();
      },
      { passive: false },
    );
  }

  bindPatternEvents() {
    if (!this.patternCanvas) return;
    let activeHandle = null;

    const getPointerLocal = (e) => {
      const rect = this.patternCanvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        w: rect.width,
        h: rect.height,
      };
    };

    this.patternCanvas.addEventListener("pointerdown", (e) => {
      const pt = getPointerLocal(e);
      for (const h of this.patternHandles) {
        if (Math.hypot(pt.x - h.x, pt.y - h.y) <= 14) {
          this.patternCanvas.setPointerCapture(e.pointerId);
          const params = this.getParams();
          activeHandle = {
            ...h,
            startX: pt.x,
            startY: pt.y,
            startVal: params[h.param],
          };
          return;
        }
      }
    });

    this.patternCanvas.addEventListener("pointermove", (e) => {
      const pt = getPointerLocal(e);
      if (!activeHandle) {
        let found = null;
        for (const h of this.patternHandles) {
          if (Math.hypot(pt.x - h.x, pt.y - h.y) <= 14) {
            found = h.id;
            break;
          }
        }
        if (found !== this.hoveredHandle) {
          this.hoveredHandle = found;
          this.patternCanvas.style.cursor = found ? "pointer" : "default";
          this.renderPattern2D();
        }
        return;
      }

      const dx = pt.x - activeHandle.startX;
      const dy = pt.y - activeHandle.startY;
      if (activeHandle.param === "skirtFlare") {
        const next = Math.max(0.10, Math.min(1.35, activeHandle.startVal + dx * 0.008));
        this.onChangeParam?.("skirtFlare", Number(next.toFixed(2)));
      } else if (activeHandle.param === "skirtLength") {
        const next = Math.max(0.35, Math.min(1.02, activeHandle.startVal + dy * 0.006));
        this.onChangeParam?.("skirtLength", Number(next.toFixed(2)));
      } else if (activeHandle.param === "waistCinch") {
        const next = Math.max(0.0, Math.min(1.0, activeHandle.startVal - dx * 0.01));
        this.onChangeParam?.("waistCinch", Number(next.toFixed(2)));
      } else if (activeHandle.param === "necklineDepth") {
        const next = Math.max(0.03, Math.min(0.24, activeHandle.startVal + dy * 0.003));
        this.onChangeParam?.("necklineDepth", Number(next.toFixed(3)));
      } else if (activeHandle.param === "pieShirringRatio") {
        const next = Math.max(0.35, Math.min(1.0, activeHandle.startVal + dx * 0.006));
        this.onChangeParam?.("pieShirringRatio", Number(next.toFixed(2)));
      }
      this.render();
    });

    ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) =>
      this.patternCanvas.addEventListener(ev, () => {
        activeHandle = null;
      }),
    );
  }

  render(time = 0) {
    this.animPhase = time;
    this.renderGraph();
    this.renderPattern2D();
  }

  renderGraph() {
    const canvas = this.graphCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);

    const cw = rect.width;
    const ch = rect.height;

    // 1. Substance Designer Dark Dotted/Grid Background
    ctx.fillStyle = "#111214";
    ctx.fillRect(0, 0, cw, ch);

    const stepMinor = 20 * this.zoom;
    const stepMajor = 100 * this.zoom;

    if (stepMinor >= 7) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.028)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ((this.panX % stepMinor) + stepMinor) % stepMinor; x < cw; x += stepMinor) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ch);
      }
      for (let y = ((this.panY % stepMinor) + stepMinor) % stepMinor; y < ch; y += stepMinor) {
        ctx.moveTo(0, y);
        ctx.lineTo(cw, y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ((this.panX % stepMajor) + stepMajor) % stepMajor; x < cw; x += stepMajor) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
    }
    for (let y = ((this.panY % stepMajor) + stepMajor) % stepMajor; y < ch; y += stepMajor) {
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
    }
    ctx.stroke();

    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    const params = this.getParams();
    const pal = COLOR_PALETTES[params.colorPalette ?? 0] || COLOR_PALETTES[0];
    const nodeMap = Object.fromEntries(this.nodes.map((n) => [n.id, n]));

    // 2. Render Cubic-Bezier Connection Wires + Animated Signal Pulses
    for (const link of this.links) {
      const fromNode = nodeMap[link.from];
      const toNode = nodeMap[link.to];
      if (!fromNode || !toNode) continue;

      const x1 = fromNode.x + fromNode.w;
      const y1 = fromNode.y + 42 + link.fromOut * 22;
      const x2 = toNode.x;
      const y2 = toNode.y + 42 + link.toIn * 24;
      const cpx = Math.max(42, Math.abs(x2 - x1) * 0.48);

      const isHighlighted =
        this.selectedNodeId === fromNode.id || this.selectedNodeId === toNode.id;
      const isBypassed = fromNode.bypassed;

      ctx.strokeStyle = isBypassed
        ? "rgba(140, 140, 140, 0.28)"
        : isHighlighted
          ? fromNode.color
          : "rgba(210, 218, 230, 0.42)";
      ctx.lineWidth = isHighlighted ? 2.4 : 1.7;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1 + cpx, y1, x2 - cpx, y2, x2, y2);
      ctx.stroke();

      // Animated data pulse along active wire
      if (!isBypassed) {
        const u = (this.animPhase * 0.55 + link.toIn * 0.3) % 1.0;
        const iu = 1 - u;
        const px =
          iu * iu * iu * x1 +
          3 * iu * iu * u * (x1 + cpx) +
          3 * iu * u * u * (x2 - cpx) +
          u * u * u * x2;
        const py =
          iu * iu * iu * y1 +
          3 * iu * iu * u * y1 +
          3 * iu * u * u * y2 +
          u * u * u * y2;
        ctx.fillStyle = fromNode.color;
        ctx.beginPath();
        ctx.arc(px, py, 3.0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 3. Render Substance Designer Nodes with Live 2D Thumbnail Previews
    for (const node of this.nodes) {
      const isSelected = node.id === this.selectedNodeId;
      const isHovered = node.id === this.hoveredNodeId;

      ctx.save();
      // Drop shadow
      ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
      ctx.shadowBlur = isSelected ? 18 : 10;
      ctx.shadowOffsetY = 4;

      // Node body rounded rect
      ctx.fillStyle = node.bypassed ? "#17181a" : "#1d1f23";
      this.roundRect(ctx, node.x, node.y, node.w, node.h, 11);
      ctx.fill();
      ctx.restore();

      // Header accent band
      ctx.save();
      this.roundRect(ctx, node.x, node.y, node.w, 28, { tl: 11, tr: 11, br: 0, bl: 0 });
      ctx.fillStyle = node.bypassed ? "#26282c" : "#25282e";
      ctx.fill();

      // Colored top stripe
      ctx.fillStyle = node.bypassed ? "#555" : node.color;
      this.roundRect(ctx, node.x, node.y, node.w, 3.5, { tl: 11, tr: 11, br: 0, bl: 0 });
      ctx.fill();
      ctx.restore();

      // Node border
      ctx.strokeStyle = isSelected
        ? node.color
        : isHovered
          ? "rgba(255, 255, 255, 0.28)"
          : "rgba(255, 255, 255, 0.09)";
      ctx.lineWidth = isSelected ? 1.8 : 1.0;
      this.roundRect(ctx, node.x, node.y, node.w, node.h, 11);
      ctx.stroke();

      // Node Title & Category
      ctx.fillStyle = node.bypassed ? "#777" : "#f0f0f0";
      ctx.font = '500 11px "DM Sans", sans-serif';
      ctx.fillText(node.title, node.x + 10, node.y + 18);

      // Bypass button on modifiable nodes
      if (node.id !== "output" && node.id !== "seams") {
        ctx.fillStyle = node.bypassed ? "#ff6b6b" : "rgba(255,255,255,0.32)";
        ctx.font = '600 8.5px "DM Sans", sans-serif';
        ctx.fillText(node.bypassed ? "OFF" : "ON", node.x + node.w - 24, node.y + 17);
      }

      // 2D Thumbnail Preview Window inside the node
      const thumbX = node.x + 34;
      const thumbY = node.y + 34;
      const thumbW = node.w - 68;
      const thumbH = node.h - 52;

      ctx.fillStyle = "#0e1013";
      this.roundRect(ctx, thumbX, thumbY, thumbW, thumbH, 6);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      this.roundRect(ctx, thumbX, thumbY, thumbW, thumbH, 6);
      ctx.clip();
      this.drawNodeThumbnail(ctx, node, thumbX, thumbY, thumbW, thumbH, params, pal);
      ctx.restore();

      // Category footer label inside node
      ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
      ctx.font = '400 8px "DM Sans", sans-serif';
      ctx.fillText(node.category, node.x + 10, node.y + node.h - 6);

      // Input sockets
      node.inputs.forEach((inp, idx) => {
        const sy = node.y + 42 + idx * 24;
        ctx.fillStyle = "#141619";
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(node.x, sy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      // Output sockets
      node.outputs.forEach((out, idx) => {
        const sy = node.y + 42 + idx * 22;
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x + node.w, sy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.restore();
  }

  drawNodeThumbnail(ctx, node, x, y, w, h, params, pal) {
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const rgbPrimary = `rgb(${Math.round(pal.primary[0] * 255)}, ${Math.round(pal.primary[1] * 255)}, ${Math.round(pal.primary[2] * 255)})`;
    const rgbSheen = `rgb(${Math.round(pal.sheen[0] * 255)}, ${Math.round(pal.sheen[1] * 255)}, ${Math.round(pal.sheen[2] * 255)})`;
    const rgbTrim = `rgb(${Math.round(pal.trim[0] * 255)}, ${Math.round(pal.trim[1] * 255)}, ${Math.round(pal.trim[2] * 255)})`;

    if (node.id === "bodice") {
      // Draw 2D Bodice pattern piece with live neckline drop & strap width
      const neckDrop = (params.necklineDepth || 0.14) * 110;
      const waistW = 28 - (params.waistCinch || 0.8) * 7;
      const bustW = 30;
      const strapW = Math.max(4, (params.strapWidth || 0.06) * 90);

      ctx.fillStyle = rgbPrimary;
      ctx.strokeStyle = rgbSheen;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - bustW, y + 12);
      ctx.lineTo(cx - bustW + strapW, y + 12);
      ctx.quadraticCurveTo(cx, y + 12 + neckDrop, cx + bustW - strapW, y + 12);
      ctx.lineTo(cx + bustW, y + 12);
      ctx.lineTo(cx + waistW, y + h - 10);
      ctx.lineTo(cx - waistW, y + h - 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (node.id === "skirt") {
      // Draw 2D Skirt pattern silhouette with live flare & length
      const waistW = 16;
      const flareW = 18 + (params.skirtFlare || 0.6) * 20;
      const lenH = 22 + (params.skirtLength || 0.9) * (h - 34);
      const asym = (params.asymmetry || 0) * 12;

      ctx.fillStyle = rgbPrimary;
      ctx.strokeStyle = rgbTrim;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - waistW, y + 8);
      ctx.lineTo(cx + waistW, y + 8);
      ctx.lineTo(cx + flareW, y + 8 + lenH + asym);
      ctx.quadraticCurveTo(cx, y + 13 + lenH, cx - flareW, y + 8 + lenH - asym);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (node.id === "pleats") {
      // Draw radial accordion pleat wave
      const pCount = Math.max(2, Math.round((params.pleatCount || 16) * 0.5));
      const pAmp = (params.pleatDepth || 0.02) * 420;
      ctx.strokeStyle = "#5bc0be";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let px = 4; px <= w - 4; px += 2) {
        const u = (px - 4) / (w - 8);
        const py = cy + Math.sin(u * pCount * Math.PI * 2) * Math.min(22, pAmp);
        if (px === 4) ctx.moveTo(x + px, py);
        else ctx.lineTo(x + px, py);
      }
      ctx.stroke();
    } else if (node.id === "pie") {
      // Zhang et al. 2025 (SIGGRAPH '25) PIE Sizing Map r(u,v) Live Heatmap Preview
      const pie = PieSizingEstimator.evaluateGarmentSizing(params);
      const step = 5;
      for (let py = 0; py < h; py += step) {
        const v = py / Math.max(1, h);
        for (let px = 0; px < w; px += step) {
          const u = px / Math.max(1, w);
          const sMm = pie.sampleSizingMeters(u, v) * 1000.0;
          const t = Math.max(0, Math.min(1, (sMm - 2.5) / 10.5));
          const rCol = Math.round(56 + t * 190);
          const gCol = Math.round(46 + Math.sin(t * Math.PI) * 175);
          const bCol = Math.round(215 - t * 155);
          ctx.fillStyle = `rgb(${rCol}, ${gCol}, ${bCol})`;
          ctx.fillRect(x + px, y + py, step - 0.5, step - 0.5);
        }
      }
      ctx.fillStyle = "rgba(10, 12, 16, 0.72)";
      ctx.fillRect(x + 3, y + h - 18, w - 6, 15);
      ctx.fillStyle = "#ffd166";
      ctx.font = '600 8.5px "DM Sans", sans-serif';
      ctx.fillText(`r_u ${pie.rWeftOptMm}mm · λ ${pie.wavelengthMm}mm`, x + 6, y + h - 7);
    } else if (node.id === "seams") {
      // Draw 4 stitched panels (Front/Back Bodice + Skirt)
      ctx.strokeStyle = "#5aa9ff";
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(x + 10, y + 8, w * 0.36, h * 0.34);
      ctx.strokeRect(x + w * 0.54, y + 8, w * 0.36, h * 0.34);
      ctx.strokeRect(x + 8, y + h * 0.48, w * 0.38, h * 0.42);
      ctx.strokeRect(x + w * 0.54, y + h * 0.48, w * 0.38, h * 0.42);
      ctx.setLineDash([]);
    } else if (node.id === "weave") {
      // Procedural Weave Map Preview
      const wType = params.weaveType ?? 0;
      const step = 6;
      for (let py = 0; py < h; py += step) {
        for (let px = 0; px < w; px += step) {
          let v = 0.5;
          if (wType === 0) v = 0.5 + 0.4 * Math.sin(px * 0.7) * Math.cos(py * 0.35);
          else if (wType === 1) v = 0.5 + 0.45 * Math.sin((px + py * 1.4) * 0.55);
          else if (wType === 2) v = 0.5 + 0.4 * Math.sin(px * 0.9 + Math.sin(py * 0.7));
          else if (wType === 3) v = 0.3 + 0.6 * Math.abs(Math.sin(px * 0.8) * Math.sin(py * 0.8));
          else if (wType === 4) v = Math.max(Math.abs(Math.sin(px * 0.6)), Math.abs(Math.sin(py * 0.6)));
          else v = ((px + py) % 12 < 6) ? 0.85 : 0.25;
          const lum = Math.round(35 + v * 175);
          ctx.fillStyle = `rgb(${lum}, ${Math.min(255, lum + 12)}, ${lum})`;
          ctx.fillRect(x + px, y + py, step - 0.5, step - 0.5);
        }
      }
    } else if (node.id === "dye") {
      // Shaded PBR Fabric Sphere Swatch
      const grad = ctx.createRadialGradient(cx - 8, cy - 8, 3, cx, cy, Math.min(w, h) * 0.42);
      grad.addColorStop(0, rgbSheen);
      grad.addColorStop(0.55, rgbPrimary);
      grad.addColorStop(1, "#090a0c");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(w, h) * 0.40, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgbTrim;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (node.id === "output") {
      // Live Garment Output Telemetry Badge
      const cols = Math.round(params.gridResolution || 56);
      const rows = Math.round(cols * 0.78);
      const verts = cols * rows;
      ctx.fillStyle = "#ffd166";
      ctx.font = '600 11px "DM Sans", sans-serif';
      ctx.fillText(`${verts.toLocaleString()} VTX`, x + 10, cy - 4);
      ctx.fillStyle = "#9ec5fe";
      ctx.font = '400 9.5px "DM Sans", sans-serif';
      ctx.fillText(`XPBD · ${params.substeps || 12} SUB`, x + 10, cy + 12);
    }
  }

  /**
   * Renders the interactive 2D Flat Garment Pattern & Seam Sewing Canvas
   * with draggable tailoring handles (Neckline, Waist Cinch, Skirt Flare, Hemline Length).
   */
  renderPattern2D() {
    const canvas = this.patternCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);

    const cw = rect.width;
    const ch = rect.height;

    // Background CAD grid
    ctx.fillStyle = "#0e1013";
    ctx.fillRect(0, 0, cw, ch);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < cw; x += 24) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
    }
    for (let y = 0; y < ch; y += 24) {
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
    }
    ctx.stroke();

    const params = this.getParams();
    const pal = COLOR_PALETTES[params.colorPalette ?? 0] || COLOR_PALETTES[0];
    const fillPrimary = `rgba(${Math.round(pal.primary[0] * 255)}, ${Math.round(pal.primary[1] * 255)}, ${Math.round(pal.primary[2] * 255)}, 0.42)`;
    const strokeSheen = `rgb(${Math.round(pal.sheen[0] * 255)}, ${Math.round(pal.sheen[1] * 255)}, ${Math.round(pal.sheen[2] * 255)})`;
    const strokeTrim = `rgb(${Math.round(pal.trim[0] * 255)}, ${Math.round(pal.trim[1] * 255)}, ${Math.round(pal.trim[2] * 255)})`;

    // Layout 2 columns: Left = FRONT PATTERN (Bodice + Skirt), Right = BACK PATTERN (Bodice + Skirt)
    const frontCX = cw * 0.30;
    const backCX = cw * 0.73;
    const topY = 26;

    const bustHalfW = Math.min(cw * 0.14, 52);
    const waistHalfW = bustHalfW * (0.92 - 0.34 * (params.waistCinch ?? 0.84));
    const strapW = Math.max(6, (params.strapWidth ?? 0.065) * 180);
    const neckDrop = (params.necklineDepth ?? 0.14) * 145;
    const bodiceH = Math.min(ch * 0.26, 58);

    const waistY = topY + bodiceH;
    const skirtTopY = waistY + 14;
    const maxSkirtH = Math.max(48, ch - skirtTopY - 24);
    const skirtH = maxSkirtH * ((params.skirtLength ?? 0.92) / 1.02);
    const hemHalfW = waistHalfW + (params.skirtFlare ?? 0.62) * Math.min(cw * 0.16, 66);
    const asymOffset = (params.asymmetry ?? 0) * 20;

    const drawPatternSet = (cx, labelPrefix, isFront) => {
      // 1. Bodice Piece
      ctx.fillStyle = fillPrimary;
      ctx.strokeStyle = strokeSheen;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - bustHalfW, topY);
      ctx.lineTo(cx - bustHalfW + strapW, topY);
      ctx.quadraticCurveTo(
        cx,
        topY + (isFront ? neckDrop : neckDrop * 0.65),
        cx + bustHalfW - strapW,
        topY,
      );
      ctx.lineTo(cx + bustHalfW, topY);
      ctx.lineTo(cx + waistHalfW, waistY);
      ctx.lineTo(cx - waistHalfW, waistY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Label
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = '500 8.5px "DM Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(`${labelPrefix} BODICE`, cx, topY + bodiceH * 0.68);

      // 2. Skirt Piece
      ctx.fillStyle = fillPrimary;
      ctx.strokeStyle = strokeSheen;
      ctx.beginPath();
      ctx.moveTo(cx - waistHalfW, skirtTopY);
      ctx.lineTo(cx + waistHalfW, skirtTopY);
      ctx.lineTo(cx + hemHalfW, skirtTopY + skirtH + (isFront ? asymOffset : -asymOffset));
      ctx.quadraticCurveTo(
        cx,
        skirtTopY + skirtH + 8,
        cx - hemHalfW,
        skirtTopY + skirtH - (isFront ? asymOffset : -asymOffset),
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Radial Pleat Fold Lines inside Skirt Pattern
      const pCount = Math.min(18, Math.round((params.pleatCount || 0) * 0.5));
      if (pCount > 0) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < pCount; i++) {
          const u = i / pCount;
          const wx = cx - waistHalfW + u * (waistHalfW * 2);
          const hx = cx - hemHalfW + u * (hemHalfW * 2);
          ctx.moveTo(wx, skirtTopY + 2);
          ctx.lineTo(hx, skirtTopY + skirtH - 2);
        }
        ctx.stroke();
      }

      // Waist Seam Stitching Line (Bodice <-> Skirt)
      ctx.strokeStyle = strokeTrim;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx - waistHalfW, waistY + 1);
      ctx.lineTo(cx - waistHalfW, skirtTopY - 1);
      ctx.moveTo(cx + waistHalfW, waistY + 1);
      ctx.lineTo(cx + waistHalfW, skirtTopY - 1);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(255,255,255,0.68)";
      ctx.fillText(`${labelPrefix} SKIRT`, cx, skirtTopY + skirtH * 0.52);
    };

    drawPatternSet(frontCX, "FRONT", true);
    drawPatternSet(backCX, "BACK", false);

    // Side Seam Stitch Connector between Front & Back Skirt
    ctx.strokeStyle = "rgba(90, 169, 255, 0.45)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frontCX + waistHalfW, skirtTopY + skirtH * 0.35);
    ctx.lineTo(backCX - waistHalfW, skirtTopY + skirtH * 0.35);
    ctx.stroke();
    ctx.setLineDash([]);

    // Interactive Tailoring Control Handles on the Front Pattern
    this.patternHandles = [
      {
        id: "neckline",
        label: "NECK",
        param: "necklineDepth",
        x: frontCX,
        y: topY + neckDrop * 0.52,
        color: "#efa56f",
      },
      {
        id: "waist",
        label: "WAIST",
        param: "waistCinch",
        x: frontCX + waistHalfW,
        y: waistY,
        color: "#5aa9ff",
      },
      {
        id: "shirring",
        label: "SHIRR (ρ)",
        param: "pieShirringRatio",
        x: frontCX,
        y: skirtTopY,
        color: "#ff7b72",
      },
      {
        id: "flare",
        label: "FLARE",
        param: "skirtFlare",
        x: frontCX + hemHalfW,
        y: skirtTopY + skirtH + asymOffset,
        color: "#34c759",
      },
      {
        id: "hem",
        label: "LENGTH",
        param: "skirtLength",
        x: frontCX,
        y: skirtTopY + skirtH + 4,
        color: "#ffd166",
      },
    ];

    for (const h of this.patternHandles) {
      const isHov = this.hoveredHandle === h.id;
      ctx.fillStyle = h.color;
      ctx.beginPath();
      ctx.arc(h.x, h.y, isHov ? 6.5 : 5.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0b0b0b";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = isHov ? "#ffffff" : "rgba(255,255,255,0.72)";
      ctx.font = '600 8px "DM Sans", sans-serif';
      ctx.textAlign = "left";
      ctx.fillText(h.label, h.x + 8, h.y + 3);
    }

    // Header overlay caption inside 2D pattern view
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = '400 9.5px "DM Sans", sans-serif';
    ctx.textAlign = "left";
    const styleName = DRESS_STYLES[params.dressStyle ?? 0]?.label || "Custom dress";
    const weaveName = WEAVE_TYPES[params.weaveType ?? 0]?.label || "Silk";
    const pie = PieSizingEstimator.evaluateGarmentSizing(params);
    ctx.fillText(
      `2D PATTERN CAD · ${styleName.toUpperCase()} · ${weaveName.toUpperCase()}`,
      12,
      15,
    );

    ctx.fillStyle = "rgba(255, 123, 114, 0.85)";
    ctx.font = '500 8.5px "DM Sans", sans-serif';
    ctx.fillText(
      `PIE [SIGGRAPH '25] · r_weft: ${pie.rWeftOptMm}mm · r_warp: ${pie.rWarpOptMm}mm · r_shirr: ${pie.rShirringMm}mm · λ: ${pie.wavelengthMm}mm · L_w: ${pie.wrinklonLwMm}mm`,
      12,
      ch - 7,
    );

    ctx.restore();
  }

  roundRect(ctx, x, y, w, h, r) {
    const radii =
      typeof r === "number" ? { tl: r, tr: r, br: r, bl: r } : r;
    ctx.beginPath();
    ctx.moveTo(x + radii.tl, y);
    ctx.lineTo(x + w - radii.tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radii.tr);
    ctx.lineTo(x + w, y + h - radii.br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radii.br, y + h);
    ctx.lineTo(x + radii.bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radii.bl);
    ctx.lineTo(x, y + radii.tl);
    ctx.quadraticCurveTo(x, y, x + radii.tl, y);
    ctx.closePath();
  }
}
