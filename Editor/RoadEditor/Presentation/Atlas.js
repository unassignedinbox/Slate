//============================================================================================================================================
// 📦 Editor/RoadEditor/Presentation/Atlas.js — Pavement legends and sign plates, drawn at runtime
//============================================================================================================================================
// Painted arrows, words and regulatory plates are the one part of a road that is genuinely bitmap art, so they are drawn into a canvas atlas at
//    boot instead of shipping textures: 8×8 cells, one per symbol id, white on transparent so the shader can tint and wear them with the same code
//    it uses for procedural stripes. Sign plates get their own atlas because they are coloured. Both are indexed by the kernel enums — a symbol id is
//    an array offset, nothing else, so a new marking is one enum entry plus one draw call here.
'use strict';

import { SIGN } from '../Kernel/PropSolver.js';

export const ATLAS_GRID = 8;
export const ATLAS_CELL = 128;

if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        const rr = Math.min(typeof r === 'number' ? r : 0, w * 0.5, h * 0.5);
        this.moveTo(x + rr, y);
        this.lineTo(x + w - rr, y); this.arcTo(x + w, y, x + w, y + rr, rr);
        this.lineTo(x + w, y + h - rr); this.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        this.lineTo(x + rr, y + h); this.arcTo(x, y + h, x, y + h - rr, rr);
        this.lineTo(x, y + rr); this.arcTo(x, y, x + rr, y, rr);
        return this;
    };
}

const cellOf = (id) => ({ x: (id % ATLAS_GRID) * ATLAS_CELL, y: Math.floor(id / ATLAS_GRID) * ATLAS_CELL });

/* ── painted legend ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/** @param {HTMLCanvasElement} [target] @returns {HTMLCanvasElement} white-on-transparent symbols, cell index = SYM id */
export function markingAtlas(target = document.createElement('canvas'), ink = '#f6f4ec') {
    const S = ATLAS_CELL;
    target.width = target.height = S * ATLAS_GRID;
    const g = target.getContext('2d');
    g.clearRect(0, 0, target.width, target.height);
    g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round';
    const put = (id, draw) => {
        const c = cellOf(id);
        g.save(); g.translate(c.x, c.y); draw(g, S); g.restore();
    };
    const head = (x, y, rot) => {
        g.save(); g.translate(x, y); g.rotate(rot);
        g.beginPath(); g.moveTo(0, -S * 0.14); g.lineTo(S * 0.12, S * 0.07); g.lineTo(-S * 0.12, S * 0.07); g.closePath(); g.fill();
        g.restore();
    };
    const arrow = ({ left = false, right = false, thru = true, uturn = false } = {}) => (gg, s) => {
        const cx = s * 0.5, w = s * 0.09;
        gg.lineWidth = w * 1.9;
        if (uturn) {
            gg.beginPath(); gg.moveTo(cx + w * 1.7, s * 0.9); gg.lineTo(cx + w * 1.7, s * 0.36);
            gg.arc(cx, s * 0.36, w * 1.7, 0, Math.PI, true); gg.lineTo(cx - w * 1.7, s * 0.78); gg.stroke();
            head(cx - w * 1.7, s * 0.86, Math.PI / 2);
            return;
        }
        if (thru) { gg.beginPath(); gg.moveTo(cx, s * 0.9); gg.lineTo(cx, s * 0.32); gg.stroke(); head(cx, s * 0.3, 0); }
        if (left || right) {
            const dir = left ? -1 : 1;
            gg.beginPath(); gg.moveTo(cx, s * 0.9); gg.lineTo(cx, s * 0.66); gg.lineTo(cx + dir * s * 0.26, s * 0.66); gg.stroke();
            head(cx + dir * s * 0.28, s * 0.66, dir * Math.PI / 2);
        }
    };
    const word = (text, stretch = 1.85, frac = 0.19) => (gg, s) => {
        gg.save(); gg.translate(s * 0.5, s * 0.5);
        gg.textAlign = 'center'; gg.textBaseline = 'middle';
        gg.font = `800 ${Math.floor(s * frac)}px "Inter","Segoe UI",system-ui,sans-serif`;
        gg.scale(1, stretch); gg.fillText(text, 0, 0);
        gg.restore();
    };
    const bike = (gg, s) => {
        const r = s * 0.14;
        gg.lineWidth = s * 0.055;
        for (const dy of [-s * 0.24, s * 0.24]) { gg.beginPath(); gg.arc(s * 0.5, s * 0.5 + dy, r, 0, 6.3); gg.stroke(); }
        gg.beginPath();
        gg.moveTo(s * 0.5 - r * 0.05, s * 0.5 - r * 0.15); gg.lineTo(s * 0.5 - r * 0.6, s * 0.5 + r * 0.75);
        gg.moveTo(s * 0.5 - r * 0.05, s * 0.5 - r * 0.15); gg.lineTo(s * 0.5 + r * 0.55, s * 0.5 + r * 0.55);
        gg.moveTo(s * 0.5 - r * 0.62, s * 0.5 - r * 0.55); gg.lineTo(s * 0.5 + r * 0.6, s * 0.5 - r * 0.55);
        gg.stroke();
    };
    const bus = (gg, s) => {
        gg.lineWidth = s * 0.06;
        gg.beginPath(); gg.roundRect(s * 0.26, s * 0.19, s * 0.48, s * 0.62, s * 0.08); gg.stroke();
        gg.fillRect(s * 0.32, s * 0.28, s * 0.36, s * 0.15);
        gg.fillRect(s * 0.32, s * 0.62, s * 0.11, s * 0.09); gg.fillRect(s * 0.57, s * 0.62, s * 0.11, s * 0.09);
    };
    const tram = (gg, s) => {
        gg.lineWidth = s * 0.06;
        gg.beginPath(); gg.roundRect(s * 0.23, s * 0.24, s * 0.54, s * 0.5, s * 0.14); gg.stroke();
        gg.fillRect(s * 0.3, s * 0.33, s * 0.4, s * 0.13);
        gg.fillRect(s * 0.29, s * 0.76, s * 0.42, s * 0.05);
        gg.beginPath(); gg.moveTo(s * 0.5, s * 0.24); gg.lineTo(s * 0.5, s * 0.11); gg.moveTo(s * 0.36, s * 0.11); gg.lineTo(s * 0.64, s * 0.11); gg.stroke();
    };
    const ped = (gg, s) => {
        gg.beginPath(); gg.arc(s * 0.5, s * 0.25, s * 0.08, 0, 6.3); gg.fill();
        gg.lineWidth = s * 0.08;
        gg.beginPath();
        gg.moveTo(s * 0.5, s * 0.36); gg.lineTo(s * 0.49, s * 0.6); gg.lineTo(s * 0.36, s * 0.83);
        gg.moveTo(s * 0.49, s * 0.6); gg.lineTo(s * 0.63, s * 0.82);
        gg.moveTo(s * 0.5, s * 0.43); gg.lineTo(s * 0.66, s * 0.52); gg.moveTo(s * 0.5, s * 0.43); gg.lineTo(s * 0.34, s * 0.49);
        gg.stroke();
    };
    const disabled = (gg, s) => {
        gg.lineWidth = s * 0.07;
        gg.beginPath(); gg.arc(s * 0.46, s * 0.6, s * 0.24, 0.4, 6.0); gg.stroke();
        gg.beginPath(); gg.arc(s * 0.5, s * 0.24, s * 0.075, 0, 6.3); gg.fill();
        gg.beginPath(); gg.moveTo(s * 0.52, s * 0.34); gg.lineTo(s * 0.57, s * 0.5); gg.lineTo(s * 0.74, s * 0.5); gg.stroke();
    };
    const chev = (gg, s) => {
        gg.lineWidth = s * 0.11;
        for (const o of [0.14, 0.42, 0.7]) { gg.beginPath(); gg.moveTo(s * 0.16, s * (o + 0.22)); gg.lineTo(s * 0.5, s * o); gg.lineTo(s * 0.84, s * (o + 0.22)); gg.stroke(); }
    };
    const rxr = (gg, s) => {
        gg.save(); gg.translate(s * 0.5, s * 0.5);
        gg.lineWidth = s * 0.075;
        gg.beginPath(); gg.moveTo(-s * 0.4, -s * 0.26); gg.lineTo(s * 0.4, s * 0.26); gg.moveTo(-s * 0.4, s * 0.26); gg.lineTo(s * 0.4, -s * 0.26); gg.stroke();
        gg.font = `800 ${Math.floor(s * 0.2)}px "Inter",system-ui,sans-serif`; gg.textAlign = 'center'; gg.textBaseline = 'middle';
        gg.fillText('R', -s * 0.28, -s * 0.34); gg.fillText('X', 0, 0); gg.fillText('R', s * 0.28, s * 0.34);
        gg.restore();
    };
    const SYMID = { ARROW_THRU: 1, ARROW_LEFT: 2, ARROW_RIGHT: 3, ARROW_THRU_LEFT: 4, ARROW_THRU_RIGHT: 5, ARROW_UTURN: 6, BIKE: 7, BUS: 8, TAXI: 9, TRAM: 10, PED: 11, DISABLED: 12, CHEV: 13, SHARE: 14, ARROW_BOTH: 15, RXR: 16, SLOW: 17, STOPWORD: 18, YIELDWORD: 19 };
    put(SYMID.ARROW_THRU, arrow({ thru: true }));
    put(SYMID.ARROW_LEFT, arrow({ left: true, thru: false }));
    put(SYMID.ARROW_RIGHT, arrow({ right: true, thru: false }));
    put(SYMID.ARROW_THRU_LEFT, arrow({ thru: true, left: true }));
    put(SYMID.ARROW_THRU_RIGHT, arrow({ thru: true, right: true }));
    put(SYMID.ARROW_UTURN, arrow({ uturn: true }));
    put(SYMID.BIKE, bike);
    put(SYMID.BUS, bus);
    put(SYMID.TAXI, (gg, s) => { bus(gg, s); });
    put(SYMID.TRAM, tram);
    put(SYMID.PED, ped);
    put(SYMID.DISABLED, disabled);
    put(SYMID.CHEV, chev);
    put(SYMID.SHARE, (gg, s) => { bike(gg, s); chev(gg, s); });
    put(SYMID.ARROW_BOTH, arrow({ left: true, right: true, thru: false }));
    put(SYMID.RXR, rxr);
    put(SYMID.SLOW, word('SLOW'));
    put(SYMID.STOPWORD, word('STOP'));
    put(SYMID.YIELDWORD, word('GIVE'));
    return target;
}

/* ── sign plates ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const WHITE = '#f7f6f2', RED = '#c8102e', BLUE = '#1b3f7a', YELLOW = '#f2c200', INK = '#14161a';

/** @param {HTMLCanvasElement} [target] @returns {HTMLCanvasElement} plates, cell index = SIGN id */
export function signAtlas(target = document.createElement('canvas')) {
    const S = ATLAS_CELL;
    target.width = target.height = S * ATLAS_GRID;
    const g = target.getContext('2d');
    g.clearRect(0, 0, target.width, target.height);
    const at = (id) => { const c = cellOf(id); g.save(); g.translate(c.x, c.y); return g; };
    const done = () => g.restore();
    const fill = (col) => { g.fillStyle = col; g.fillRect(0, 0, S, S); };
    const text = (t, y, frac, col = INK, weight = '800') => {
        g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `${weight} ${Math.floor(S * frac)}px "Inter","Segoe UI",system-ui,sans-serif`;
        g.fillText(t, S * 0.5, S * y);
    };
    const ring = (col, w, r) => { g.lineWidth = S * w; g.strokeStyle = col; g.beginPath(); g.arc(S / 2, S / 2, S * r, 0, 6.3); g.stroke(); };
    const polygon = (n, rot, r, close = true) => {
        g.beginPath();
        for (let k = 0; k < n; ++k) { const a = rot + (k / n) * Math.PI * 2, x = S / 2 + Math.cos(a) * S * r, y = S / 2 + Math.sin(a) * S * r; k ? g.lineTo(x, y) : g.moveTo(x, y); }
        if (close) g.closePath();
    };
    const speedLimit = (v) => { fill(WHITE); ring(RED, 0.1, 0.42); text(String(v), 0.5, 0.32, INK); };

    at(SIGN.STOP); fill(RED); g.fillStyle = WHITE; polygon(8, Math.PI / 8, 0.45); g.fill(); g.fillStyle = RED; text('STOP', 0.5, 0.18, WHITE); done();
    at(SIGN.YIELD); fill(WHITE); g.lineWidth = S * 0.11; g.strokeStyle = RED; g.beginPath(); g.moveTo(S * 0.5, S * 0.9); g.lineTo(S * 0.08, S * 0.14); g.lineTo(S * 0.92, S * 0.14); g.closePath(); g.stroke(); done();
    at(SIGN.SPEED20); speedLimit(20); done();
    at(SIGN.SPEED30); speedLimit(30); done();
    at(SIGN.SPEED40); speedLimit(40); done();
    at(SIGN.SPEED50); speedLimit(50); done();
    at(SIGN.SPEED60); speedLimit(60); done();
    at(SIGN.SPEED80); speedLimit(80); done();
    at(SIGN.SPEED100); speedLimit(100); done();
    const oneWay = (dir) => { fill(INK); g.fillStyle = WHITE; g.save(); g.translate(S * 0.5, S * 0.5); g.scale(dir, 1);
        g.beginPath(); g.rect(-S * 0.3, -S * 0.06, S * 0.42, S * 0.12); g.fill();
        g.beginPath(); g.moveTo(S * 0.12, -S * 0.17); g.lineTo(S * 0.34, 0); g.lineTo(S * 0.12, S * 0.17); g.closePath(); g.fill(); g.restore(); };
    at(SIGN.ONEWAY); oneWay(1); done();
    at(SIGN.ONEWAY_R); oneWay(-1); done();
    at(SIGN.NOPARKING); fill(BLUE); text('P', 0.5, 0.36, WHITE); ring(WHITE, 0.055, 0.3);
        g.strokeStyle = WHITE; g.lineWidth = S * 0.06; g.beginPath(); g.moveTo(S * 0.28, S * 0.72); g.lineTo(S * 0.72, S * 0.28); g.stroke(); done();
    at(SIGN.BUSLANE); fill(BLUE); text('BUS', 0.4, 0.2, WHITE); text('LANE', 0.68, 0.13, WHITE); done();
    at(SIGN.BIKE); fill(BLUE); g.strokeStyle = WHITE; g.lineWidth = S * 0.06;
        for (const dx of [-S * 0.17, S * 0.17]) { g.beginPath(); g.arc(S * 0.5 + dx, S * 0.62, S * 0.14, 0, 6.3); g.stroke(); }
        g.beginPath(); g.moveTo(S * 0.36, S * 0.44); g.lineTo(S * 0.5, S * 0.62); g.lineTo(S * 0.64, S * 0.44); g.moveTo(S * 0.3, S * 0.42); g.lineTo(S * 0.45, S * 0.42); g.stroke(); done();
    at(SIGN.PEDESTRIAN); fill(BLUE); pedPlate(g); done();
    at(SIGN.CROSSWALK); fill(BLUE); g.strokeStyle = WHITE; g.lineWidth = S * 0.07;
        for (let k = 0; k < 4; ++k) { const x = S * (0.24 + k * 0.14); g.beginPath(); g.moveTo(x, S * 0.3); g.lineTo(x + S * 0.08, S * 0.3); g.lineTo(x + S * 0.02, S * 0.7); g.lineTo(x - S * 0.04, S * 0.7); g.closePath(); g.stroke(); } done();
    at(SIGN.TRAM); fill(YELLOW); text('TRAM', 0.5, 0.17, INK); done();
    at(SIGN.ROUNDABOUT); fill(BLUE); g.strokeStyle = WHITE; g.lineWidth = S * 0.07;
        for (let k = 0; k < 3; ++k) { g.save(); g.translate(S * 0.5, S * 0.5); g.rotate(k * 2.094); g.beginPath(); g.arc(0, 0, S * 0.24, 0.35, 2.3); g.stroke(); g.restore(); } done();
    at(SIGN.RAILCROSS); fill(WHITE); g.strokeStyle = INK; g.lineWidth = S * 0.1; g.lineCap = 'butt';
        g.beginPath(); g.moveTo(S * 0.1, S * 0.35); g.lineTo(S * 0.9, S * 0.65); g.moveTo(S * 0.1, S * 0.65); g.lineTo(S * 0.9, S * 0.35); g.stroke();
        text('RA', 0.42, 0.13, INK); text('SS', 0.6, 0.13, INK); done();
    at(SIGN.SCHOOL); fill(YELLOW); g.fillStyle = INK; g.fillRect(S * 0.18, S * 0.16, S * 0.64, S * 0.68); pedPlate(g, YELLOW, 0.62); text('SCHOOL', 0.5, 0.12, INK); done();
    at(SIGN.DEADEND); fill(BLUE); text('DEAD', 0.38, 0.15, WHITE); text('END', 0.63, 0.15, WHITE); done();
    at(SIGN.KEEPLEFT); fill(WHITE); g.fillStyle = INK; g.beginPath(); g.arc(S * 0.5, S * 0.5, S * 0.42, 0, 6.3); g.fill();
        g.fillStyle = WHITE; g.save(); g.translate(S * 0.42, S * 0.5); g.rotate(0.6); g.fillRect(-S * 0.04, -S * 0.22, S * 0.08, S * 0.34); g.restore(); done();
    at(SIGN.TAXI); fill(YELLOW); text('TAXI', 0.5, 0.17, INK); done();
    at(SIGN.SLOW); fill(YELLOW); text('SLOW', 0.5, 0.17, INK); done();
    at(SIGN.ZONE20); fill(BLUE); text('ZONE', 0.36, 0.13, WHITE); text('20', 0.62, 0.26, WHITE); done();
    at(SIGN.HEIGHT); fill(WHITE); text('4.5 m', 0.44, 0.17, INK); g.fillStyle = INK; g.fillRect(S * 0.2, S * 0.6, S * 0.6, S * 0.09); done();
    at(SIGN.NOENTRY); fill(RED); g.fillStyle = WHITE; g.fillRect(S * 0.24, S * 0.44, S * 0.52, S * 0.12); ring(WHITE, 0.06, 0.44); done();
    at(SIGN.GIVEWAY); fill(WHITE); g.lineWidth = S * 0.1; g.strokeStyle = RED; g.beginPath(); g.moveTo(S * 0.5, S * 0.12); g.lineTo(S * 0.9, S * 0.84); g.lineTo(S * 0.1, S * 0.84); g.closePath(); g.stroke(); done();
    at(SIGN.MERGE); fill(YELLOW); g.strokeStyle = INK; g.lineWidth = S * 0.08;
        g.beginPath(); g.moveTo(S * 0.5, S * 0.86); g.lineTo(S * 0.5, S * 0.16); g.moveTo(S * 0.5, S * 0.6); g.quadraticCurveTo(S * 0.72, S * 0.52, S * 0.78, S * 0.2); g.stroke(); done();
    at(SIGN.WORKS); fill(YELLOW); text('ROAD', 0.38, 0.15, INK); text('WORKS', 0.62, 0.14, INK); done();
    at(SIGN.HUMP); fill(WHITE); g.fillStyle = INK; g.beginPath(); g.moveTo(S * 0.16, S * 0.74); g.quadraticCurveTo(S * 0.5, S * 0.16, S * 0.84, S * 0.74);
        g.lineTo(S * 0.84, S * 0.82); g.lineTo(S * 0.16, S * 0.82); g.closePath(); g.fill(); done();
    at(SIGN.BUSSTOP); fill(RED); text('BUS', 0.4, 0.17, WHITE); text('STOP', 0.64, 0.13, WHITE); done();
    return target;
}
function pedPlate(g, col = WHITE, k = 1) {
    const S = ATLAS_CELL;
    g.save(); g.translate(S * 0.5, S * 0.54); g.scale(k, k);
    g.fillStyle = col; g.strokeStyle = col; g.lineWidth = S * 0.07; g.lineCap = 'round';
    g.beginPath(); g.arc(0, -S * 0.19, S * 0.07, 0, 6.3); g.fill();
    g.beginPath();
    g.moveTo(0, -S * 0.09); g.lineTo(-S * 0.01, S * 0.08); g.lineTo(-S * 0.12, S * 0.24);
    g.moveTo(-S * 0.01, S * 0.08); g.lineTo(S * 0.1, S * 0.23);
    g.moveTo(0, -S * 0.05); g.lineTo(S * 0.12, S * 0.02); g.moveTo(0, -S * 0.05); g.lineTo(-S * 0.12, -S * 0.01);
    g.stroke(); g.restore();
}
