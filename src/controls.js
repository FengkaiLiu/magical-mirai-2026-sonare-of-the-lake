/**
 * ==========================================
 * Controls — Input management (keyboard / touch)
 * ==========================================
 * Bruno-Simon-style: Controls only owns boolean flags.
 * Boat and other systems read `actions` — they never touch the DOM.
 *
 * Future extensions:
 *   - Touch virtual joystick
 *   - Gamepad support
 */

export class Controls {
  constructor() {
    // === Action flags — read-only for other systems ===
    this.actions = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };

    // === Keyboard ===
    this._keyMap = {
      KeyW: "forward",    ArrowUp: "forward",
      KeyS: "backward",   ArrowDown: "backward",
      KeyA: "left",       ArrowLeft: "left",
      KeyD: "right",      ArrowRight: "right",
    };

    // Set locked = true to suppress all input (used during intro sequence)
    this.locked = false;

    this._onKeyDown = (e) => {
      if (this.locked) return;
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
  }

  /**
   * Cleanup (call when the controls instance is no longer needed).
   */
  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
  }
}