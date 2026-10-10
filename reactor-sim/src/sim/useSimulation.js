// Drives the physics model from the UI. Rebuilds the reactor when the configuration changes
// (debounced, because a base rebuild takes about 0.1-0.3 s), advances it at a chosen speed with
// a fixed 0.25 s step, and keeps a history of 1 s samples for the graphs.
import { useEffect, useRef, useState, useCallback } from 'react';
import { createReactor } from '../physics/reactor.js';

export const DT = 0.25;               // simulation step, s
const HIST_MAX = 4000;                // samples kept (1 per simulated second)

function newHistory() {
  return { t: [], P: [], Pth: [], Pe: [], flowTrue: [], flowMeas: [], Tf: [], Tb: [], Tcl: [], dose: [], dmg: [], z: [] };
}

export function useSimulation(cfg, resetKey) {
  const [, force] = useState(0);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(10);
  const reactorRef = useRef(null);
  const histRef = useRef(newHistory());
  const nextSampleRef = useRef(0);
  const accRef = useRef(0);

  const record = (x) => {
    const h = histRef.current;
    if (x.t + 1e-9 < nextSampleRef.current) return;
    nextSampleRef.current += 1;
    h.t.push(x.t);
    h.P.push(x.Pfis);
    h.Pth.push(x.Pth);
    h.Pe.push(x.Pe);
    h.flowTrue.push(x.flowTrueGps);
    h.flowMeas.push(x.flowMeasGps.reduce((a, b) => a + b, 0) / x.flowMeasGps.length);
    h.Tf.push(x.TfMaxC);
    h.Tb.push(x.TbC);
    h.Tcl.push(x.TcladMaxC);
    h.dose.push(x.dose.surface);
    h.dmg.push(x.vib.damage);
    h.z.push(x.vib.zRmsMm);
    if (h.t.length > HIST_MAX) for (const k of Object.keys(h)) h[k].splice(0, h[k].length - HIST_MAX);
  };

  // Rebuild on configuration change (debounced).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        reactorRef.current = createReactor(cfg);
        setError(null);
      } catch (e) {
        reactorRef.current = null;
        setError(e.message);
      }
      histRef.current = newHistory();
      nextSampleRef.current = 0;
      accRef.current = 0;
      force((n) => n + 1);
    }, 300);
    return () => clearTimeout(id);
  }, [cfg, resetKey]);

  // Run loop.
  useEffect(() => {
    if (!running) return undefined;
    let raf;
    let prev = performance.now();
    let lastUi = 0;
    const frame = (now) => {
      const r = reactorRef.current;
      if (r) {
        const dtReal = Math.min(0.1, (now - prev) / 1000);
        accRef.current += dtReal * speed;
        let steps = 0;
        while (accRef.current >= DT && steps < 4000) {
          const x = r.step(DT);
          record(x);
          accRef.current -= DT;
          steps += 1;
        }
        if (now - lastUi > 120) {
          lastUi = now;
          force((n) => n + 1);
        }
      }
      prev = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, speed]);

  const r = reactorRef.current;
  const snapshot = r ? r.last : null;

  const inject = useCallback((ev) => {
    const rr = reactorRef.current;
    if (!rr) return;
    rr.cfg.events.push({ ...ev, t: rr.state.t });
    force((n) => n + 1);
  }, []);

  // Advance one step while paused (for single-step inspection).
  const stepOnce = useCallback(() => {
    const rr = reactorRef.current;
    if (!rr) return;
    record(rr.step(DT));
    force((n) => n + 1);
  }, []);

  return {
    error,
    running, setRunning,
    speed, setSpeed,
    reactor: r,
    snapshot,
    history: histRef.current,
    inject,
    stepOnce,
    simTime: r ? r.state.t : 0,
  };
}
