//============================================================================================================================================
//                                                                SIM.JS
//============================================================================================================================================
// 📦 Drive input, chase camera + free camera. Keys match Project-Drive's contract:
//      W/S throttle·brake · A/D steer · Space handbrake · R respawn · F8 possess/eject (chase↔free flight)
//    Extra here: C cycles chase/orbit/top camera, mouse drag orbits the chase cam; in free-cam the mouse
//    looks and WASD+QE flies. Autopilot drives a tour loop until any driving key is pressed.

import { mat4LookAt, mat4Perspective, mat4Multiply, V3, damp, clamp } from "./math.js";
import { bodyOrigin, stepVehicle, respawn, makeVehicleState, makeAutopilot, autopilotInput } from "./vehicle.js";

export function makeSim(canvas) {
  const sim = {
    keysList: new Set(),
    veh: makeVehicleState(),
    ap: makeAutopilot(),
    mode: "chase",                                    // chase | orbit | top | free
    camYaw: 0.35, camPitch: -0.24, camDist: 7.5,
    freePos: [8, -8, 3.2], freeYaw: Math.PI * 0.78, freePitch: -0.3,
    eye: [-2, -8, 3.0],
    viewCenter: [0, 0, 0.5], up: [0, 0, 1],
    t: 0,
  };

  window.addEventListener("keydown", (e) => {
    sim.keysList.add(e.code);
    if (e.code === "KeyR" && sim.mode !== "free") respawn(sim.veh);
    if (e.code === "F8" && !e.repeat) {
      if (sim.mode === "free") sim.mode = "chase";
      else { sim.mode = "free"; sim.freePos = [...sim.eye]; }
      e.preventDefault();
    }
    if (e.code === "KeyC" && !e.repeat)
      sim.mode = sim.mode === "chase" ? "orbit" : sim.mode === "orbit" ? "top" : "chase";
    if (["Space", "F8"].includes(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => sim.keysList.delete(e.code));

  let dragging = false, px = 0, py = 0;
  canvas.addEventListener("mousedown", (e) => { dragging = true; px = e.clientX; py = e.clientY; });
  window.addEventListener("mouseup", () => dragging = false);
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    if (sim.mode === "free") { sim.freeYaw -= dx * 0.004; sim.freePitch = clamp(sim.freePitch - dy * 0.004, -1.45, 1.45); }
    else { sim.camYaw -= dx * 0.005; sim.camPitch = clamp(sim.camPitch - dy * 0.005, -1.2, -0.02); }
  });
  canvas.addEventListener("wheel", (e) => { sim.camDist = clamp(sim.camDist + e.deltaY * 0.01, 3.5, 22); e.preventDefault(); }, { passive: false });

  return sim;
}

export function stepSim(sim, dt) {
  sim.t += dt;
  const k = sim.keysList;
  const mi = {
    steer: (k.has("KeyA") ? 1 : 0) + (k.has("KeyD") ? -1 : 0),
    throttle: (k.has("KeyW") ? 1 : 0) + (k.has("KeyS") ? -1 : 0),
    handbrake: k.has("Space"),
  };
  const manual = sim.mode !== "free" && (mi.steer !== 0 || mi.throttle !== 0 || mi.handbrake);
  const ap = autopilotInput(sim.ap, sim.veh, dt, manual);
  const input = ap ?? mi;
  stepVehicle(sim.veh, input, dt);

  const v = sim.veh;
  const body = bodyOrigin(v);
  let eye, center, up = [0, 0, 1];
  if (sim.mode === "orbit") {
    const r = sim.camDist * 1.6;
    eye = [body[0] + Math.cos(sim.t * 0.25) * r, body[1] + Math.sin(sim.t * 0.25) * r, body[2] + r * 0.45];
    center = body;
  } else if (sim.mode === "top") {
    eye = [body[0] + 0.01, body[1] + 0.01, body[2] + 17];
    center = body;
    up = [1, 0, 0];
  } else if (sim.mode === "free") {
    const spd = (k.has("ShiftLeft") ? 18 : 7) * dt;
    const fx = Math.cos(sim.freeYaw) * Math.cos(sim.freePitch), fy = Math.sin(sim.freeYaw) * Math.cos(sim.freePitch), fz = Math.sin(sim.freePitch);
    const rx = Math.cos(sim.freeYaw + Math.PI / 2), ry = Math.sin(sim.freeYaw + Math.PI / 2);
    if (k.has("KeyW")) sim.freePos = V3.add(sim.freePos, V3.scale([fx, fy, fz], spd));
    if (k.has("KeyS")) sim.freePos = V3.sub(sim.freePos, V3.scale([fx, fy, fz], spd));
    if (k.has("KeyA")) sim.freePos = V3.sub(sim.freePos, V3.scale([rx, ry, 0], spd));
    if (k.has("KeyD")) sim.freePos = V3.add(sim.freePos, V3.scale([rx, ry, 0], spd));
    if (k.has("KeyQ")) sim.freePos[2] -= spd;
    if (k.has("KeyE")) sim.freePos[2] += spd;
    eye = sim.freePos;
    center = V3.add(sim.freePos, [fx, fy, fz]);
  } else {  // chase
    const yaw = v.yaw + sim.camYaw;
    const r = sim.camDist;
    const target = [body[0] - Math.cos(yaw) * r, body[1] - Math.sin(yaw) * r, body[2] + 1.9 + (-sim.camPitch) * r * 0.55];
    sim.eye[0] = damp(sim.eye[0], target[0], 9, dt);
    sim.eye[1] = damp(sim.eye[1], target[1], 9, dt);
    sim.eye[2] = damp(sim.eye[2], target[2], 7, dt);
    eye = sim.eye;
    center = [body[0] + Math.cos(v.yaw) * 2.3, body[1] + Math.sin(v.yaw) * 2.3, body[2] + 0.55];
  }
  if (sim.mode !== "chase") sim.eye = [...eye];
  sim.viewCenter = center;
  sim.up = up;
  return { input, manual };
}

export function viewSim(sim, aspect) {
  const view = mat4LookAt(sim.eye, sim.viewCenter, sim.up);
  const proj = mat4Perspective(62 * Math.PI / 180, aspect, 0.08, 500);
  return { view, proj, viewProj: mat4Multiply(proj, view) };
}
