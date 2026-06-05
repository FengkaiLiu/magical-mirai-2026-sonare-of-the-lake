/**
 * ==========================================
 * Controls — Input management (keyboard / touch)
 * ==========================================
 * Bruno-Simon-style: Controls only owns boolean flags.
 * Boat and other systems read `actions` — they never touch the DOM.
 */

import { IS_TOUCH } from "./device.js";

export class Controls {
  constructor() {
    // === Action flags — read-only for other systems ===
    this.actions = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      joystickX: 0,   // analog -1…1 (touch only); boat uses this for direct-direction steering
      joystickY: 0,   // analog -1…1; screen +Y (down) = world +Z
    };

    // === Keyboard ===
    this._keyMap = {
      KeyW: "forward",    ArrowUp: "forward",
      KeyS: "backward",   ArrowDown: "backward",
      KeyA: "left",       ArrowLeft: "left",
      KeyD: "right",      ArrowRight: "right",
    };

    this._locked = false;
    this._joystickEl = null;

    this._onKeyDown = (e) => {
      if (this._locked) return;
      const action = this._keyMap[e.code];
      if (action) {
        this.actions[action] = true;
        e.preventDefault();
      }
    };

    this._onKeyUp = (e) => {
      const action = this._keyMap[e.code];
      if (action) {
        this.actions[action] = false;
      }
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    // === Virtual joystick (touch devices) ===
    if (IS_TOUCH) this._initJoystick();
  }

  // locked getter/setter — hides/shows joystick in sync with input lock
  get locked() { return this._locked; }
  set locked(v) {
    this._locked = v;
    if (this._joystickEl) {
      this._joystickEl.style.display = v ? "none" : "block";
      if (v) {
        this.actions.forward = this.actions.backward =
        this.actions.left    = this.actions.right    = false;
      }
    }
  }

  _initJoystick() {
    const wrap = document.createElement("div");
    wrap.className = "vjoystick-wrap";
    wrap.style.display = "none"; // shown only when controls are unlocked

    const base = document.createElement("div");
    base.className = "vjoystick-base";

    const thumb = document.createElement("div");
    thumb.className = "vjoystick-thumb";

    base.appendChild(thumb);
    wrap.appendChild(base);
    document.body.appendChild(wrap);
    this._joystickEl = wrap;

    let activeId = null;
    let cx = 0, cy = 0;
    const MAX_R = 36; // max thumb travel in px
    const DEAD  = 8;  // deadzone in px

    const getCenter = () => {
      const r = base.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const updateThumb = (tx, ty) => {
      let dx = tx - cx, dy = ty - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MAX_R) { dx = dx / dist * MAX_R; dy = dy / dist * MAX_R; }
      thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // Analog values used by boat for world-space directional movement
      this.actions.joystickX = dx / MAX_R;
      this.actions.joystickY = dy / MAX_R;
      // Boolean fallbacks kept for non-boat systems that read them
      this.actions.forward  = dy < -DEAD;
      this.actions.backward = dy >  DEAD;
      this.actions.left     = dx < -DEAD;
      this.actions.right    = dx >  DEAD;
    };

    const onStart = (e) => {
      if (this._locked || activeId !== null) return;
      const t = e.changedTouches[0];
      if (!t) return;
      e.preventDefault();
      activeId = t.identifier;
      thumb.style.transition = "none";
      const c = getCenter();
      cx = c.x; cy = c.y;
      updateThumb(t.clientX, t.clientY);
    };

    const onMove = (e) => {
      if (this._locked || activeId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== activeId) continue;
        updateThumb(t.clientX, t.clientY);
        e.preventDefault();
        break;
      }
    };

    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== activeId) continue;
        activeId = null;
        thumb.style.transition = "";
        thumb.style.transform  = "translate(-50%, -50%)";
        this.actions.joystickX = 0;
        this.actions.joystickY = 0;
        this.actions.forward = this.actions.backward =
        this.actions.left    = this.actions.right    = false;
        break;
      }
    };

    wrap.addEventListener("touchstart", onStart, { passive: false });
    window.addEventListener("touchmove",  onMove, { passive: false });
    window.addEventListener("touchend",   onEnd,  { passive: true  });
    window.addEventListener("touchcancel",onEnd,  { passive: true  });

    this._disposeJoystick = () => {
      wrap.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove",   onMove);
      window.removeEventListener("touchend",    onEnd);
      window.removeEventListener("touchcancel", onEnd);
      wrap.remove();
    };
  }

  /**
   * Cleanup (call when the controls instance is no longer needed).
   */
  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup",   this._onKeyUp);
    this._disposeJoystick?.();
  }
}
