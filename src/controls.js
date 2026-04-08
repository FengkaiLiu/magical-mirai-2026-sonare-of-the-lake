/**
 * ==========================================
 * Controls — 入力管理 v2
 * ==========================================
 * Keyboard + Touch virtual joystick + Gamepad
 *
 * Touch joystick:
 *   - Left half of screen: virtual stick (drag to move/turn)
 *   - CSS-drawn, no images needed
 *   - Dead zone to prevent accidental drift
 *   - Auto-hides on desktop (only shows if touch detected)
 *
 * Gamepad:
 *   - Left stick for movement
 *   - Polled each frame via update()
 */

export class Controls {
  constructor() {
    // === Action flags ===
    this.actions = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
    };

    // === Keyboard ===
    this._keyMap = {
      KeyW: "forward",    ArrowUp: "forward",
      KeyS: "backward",   ArrowDown: "backward",
      KeyA: "left",       ArrowLeft: "left",
      KeyD: "right",      ArrowRight: "right",
      ShiftLeft: "sprint", ShiftRight: "sprint",
    };

    this._keysHeld = new Set();

    this._onKeyDown = (e) => {
      const action = this._keyMap[e.code];
      if (action) {
        this._keysHeld.add(e.code);
        this.actions[action] = true;
        e.preventDefault();
      }
    };

    this._onKeyUp = (e) => {
      const action = this._keyMap[e.code];
      if (action) {
        this._keysHeld.delete(e.code);
        this.actions[action] = false;
      }
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    // === Touch joystick ===
    this._touchId = null;
    this._stickOrigin = { x: 0, y: 0 };
    this._stickCurrent = { x: 0, y: 0 };
    this._stickRadius = 50;     // max drag distance in px
    this._deadZone = 0.2;       // 20% dead zone

    this._createJoystickUI();
    this._bindTouch();

    // === Gamepad ===
    this._gamepadIndex = null;
    window.addEventListener("gamepadconnected", (e) => {
      this._gamepadIndex = e.gamepad.index;
    });
    window.addEventListener("gamepaddisconnected", () => {
      this._gamepadIndex = null;
    });
  }

  // ─── Touch Joystick UI ─────────────────────────────────

  _createJoystickUI() {
    // Only show on touch devices
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    // Container (left side of screen)
    this._joyContainer = document.createElement("div");
    Object.assign(this._joyContainer.style, {
      position: "fixed",
      left: "0",
      bottom: "0",
      width: "45vw",
      height: "45vh",
      zIndex: "60",
      pointerEvents: "auto",
      display: isTouchDevice ? "block" : "none",
    });

    // Base circle (appears on touch)
    this._joyBase = document.createElement("div");
    Object.assign(this._joyBase.style, {
      position: "absolute",
      width: "100px",
      height: "100px",
      borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.25)",
      background: "rgba(255,255,255,0.08)",
      transform: "translate(-50%, -50%)",
      display: "none",
      pointerEvents: "none",
    });

    // Thumb knob
    this._joyThumb = document.createElement("div");
    Object.assign(this._joyThumb.style, {
      position: "absolute",
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      background: "rgba(255,255,255,0.35)",
      border: "1.5px solid rgba(255,255,255,0.5)",
      transform: "translate(-50%, -50%)",
      left: "50%",
      top: "50%",
      pointerEvents: "none",
    });

    this._joyBase.appendChild(this._joyThumb);
    this._joyContainer.appendChild(this._joyBase);
    document.body.appendChild(this._joyContainer);
  }

  _bindTouch() {
    const container = this._joyContainer;

    container.addEventListener("touchstart", (e) => {
      if (this._touchId !== null) return;
      const t = e.changedTouches[0];
      this._touchId = t.identifier;
      this._stickOrigin.x = t.clientX;
      this._stickOrigin.y = t.clientY;
      this._stickCurrent.x = t.clientX;
      this._stickCurrent.y = t.clientY;

      // Show base at touch point
      this._joyBase.style.display = "block";
      this._joyBase.style.left = t.clientX + "px";
      this._joyBase.style.top = t.clientY + "px";
      this._joyThumb.style.left = "50%";
      this._joyThumb.style.top = "50%";

      e.preventDefault();
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touchId) continue;
        this._stickCurrent.x = t.clientX;
        this._stickCurrent.y = t.clientY;
        this._updateJoystick();
        e.preventDefault();
      }
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touchId) continue;
        this._touchId = null;
        this._joyBase.style.display = "none";
        // Clear touch-driven actions (don't clear keyboard actions)
        this._applyStickActions(0, 0);
      }
    };
    window.addEventListener("touchend", endTouch);
    window.addEventListener("touchcancel", endTouch);
  }

  _updateJoystick() {
    const dx = this._stickCurrent.x - this._stickOrigin.x;
    const dy = this._stickCurrent.y - this._stickOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = this._stickRadius;

    // Clamp to radius
    const clampDist = Math.min(dist, maxR);
    const angle = Math.atan2(dy, dx);
    const cx = Math.cos(angle) * clampDist;
    const cy = Math.sin(angle) * clampDist;

    // Move thumb visually
    const pct = (v) => `calc(50% + ${v}px)`;
    this._joyThumb.style.left = pct(cx);
    this._joyThumb.style.top = pct(cy);

    // Normalize to -1..1
    const nx = cx / maxR;
    const ny = cy / maxR;

    this._applyStickActions(nx, ny);
  }

  _applyStickActions(nx, ny) {
    const dz = this._deadZone;

    // Only override if no keyboard keys are held for that action
    if (!this._keysHeld.has("KeyW") && !this._keysHeld.has("ArrowUp"))
      this.actions.forward = ny < -dz;
    if (!this._keysHeld.has("KeyS") && !this._keysHeld.has("ArrowDown"))
      this.actions.backward = ny > dz;
    if (!this._keysHeld.has("KeyA") && !this._keysHeld.has("ArrowLeft"))
      this.actions.left = nx < -dz;
    if (!this._keysHeld.has("KeyD") && !this._keysHeld.has("ArrowRight"))
      this.actions.right = nx > dz;
  }

  // ─── Gamepad (call each frame) ─────────────────────────

  /**
   * Optional: call from engine loop to poll gamepad.
   * Safe to skip if no gamepad connected.
   */
  pollGamepad() {
    if (this._gamepadIndex === null) return;
    const gp = navigator.getGamepads()[this._gamepadIndex];
    if (!gp) return;

    const dz = 0.15;
    const lx = gp.axes[0] || 0; // left stick X
    const ly = gp.axes[1] || 0; // left stick Y

    // Only override if no keyboard/touch is active
    if (this._touchId === null && this._keysHeld.size === 0) {
      this.actions.forward  = ly < -dz;
      this.actions.backward = ly > dz;
      this.actions.left     = lx < -dz;
      this.actions.right    = lx > dz;
    }
  }

  // ─── Cleanup ───────────────────────────────────────────

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    if (this._joyContainer && this._joyContainer.parentNode) {
      this._joyContainer.parentNode.removeChild(this._joyContainer);
    }
  }
}