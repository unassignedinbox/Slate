import { Vector3, Euler } from "three";
export function flyDisplacement(camera, keys, seconds, speed) {
  const forward = camera.getWorldDirection(new Vector3()),
    right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
    direction = new Vector3();
  direction.addScaledVector(
    forward,
    (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
  );
  direction.addScaledVector(
    right,
    (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
  );
  direction.y += (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
  return direction
    .normalize()
    .multiplyScalar(
      Math.max(0, seconds) *
        speed *
        (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4 : 1),
    );
}
export function createFreeCamera(camera, orbit, canvas, onChange = () => {}) {
  const keys = new Set(),
    rotation = new Euler(0, 0, 0, "YXZ");
  let active = false,
    speed = 12,
    lastX = 0,
    lastY = 0,
    pointer = null,
    lookDistance = 10;
  canvas.tabIndex = 0;
  const editable = () =>
    document.activeElement?.matches(
      'input,select,textarea,[contenteditable="true"]',
    ) || document.querySelector("dialog[open]");
  function syncTarget() {
    const direction = camera.getWorldDirection(new Vector3());
    orbit.target.copy(camera.position).addScaledVector(direction, lookDistance);
    camera.updateMatrixWorld(true);
  }
  function stop() {
    if (!active) return;
    active = false;
    keys.clear();
    syncTarget();
    orbit.enabled = true;
    if (pointer !== null && canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer);
    pointer = null;
    canvas.style.cursor = "";
    onChange({ active, speed });
  }
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 2) {
        if (active) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      canvas.focus({ preventScroll: true });
      // Flush damping before handing orientation to the fly controller.
      const damping = orbit.enableDamping;
      orbit.enableDamping = false;
      orbit.update();
      orbit.enableDamping = damping;
      active = true;
      keys.clear();
      orbit.enabled = false;
      lookDistance = Math.min(
        30,
        Math.max(3, camera.position.distanceTo(orbit.target)),
      );
      rotation.setFromQuaternion(camera.quaternion, "YXZ");
      lastX = event.clientX;
      lastY = event.clientY;
      pointer = event.pointerId;
      canvas.setPointerCapture(pointer);
      canvas.style.cursor = "move";
      onChange({ active, speed });
    },
    true,
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      rotation.y -= (event.clientX - lastX) * 0.003;
      rotation.x = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(
          Math.PI / 2 - 0.01,
          rotation.x - (event.clientY - lastY) * 0.003,
        ),
      );
      rotation.z = 0;
      camera.quaternion.setFromEuler(rotation);
      lastX = event.clientX;
      lastY = event.clientY;
      syncTarget();
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button === 2) stop();
    },
    true,
  );
  canvas.addEventListener("pointercancel", stop, true);
  canvas.addEventListener("lostpointercapture", stop);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      speed = Math.max(
        0.25,
        Math.min(200, speed * (event.deltaY < 0 ? 1.25 : 0.8)),
      );
      onChange({ active, speed });
    },
    { capture: true, passive: false },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!active || editable()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        stop();
        return;
      }
      keys.add(event.code);
    },
    true,
  );
  document.addEventListener(
    "keyup",
    (event) => {
      keys.delete(event.code);
      if (active) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  return {
    get active() {
      return active;
    },
    get speed() {
      return speed;
    },
    stop,
    update(dt) {
      if (!active) return;
      if (editable()) {
        stop();
        return;
      }
      camera.position.add(
        flyDisplacement(camera, keys, Math.min(0.1, dt), speed),
      );
      syncTarget();
    },
  };
}
