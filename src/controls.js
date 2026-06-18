/**
 * Controls — keyboard input management.
 */

export class Controls {
  constructor() {
    this.actions = {
      forward:  false,
      backward: false,
      left:     false,
      right:    false,
    };

    this._keyMap = {
      KeyW: "forward",    ArrowUp:    "forward",
      KeyS: "backward",   ArrowDown:  "backward",
      KeyA: "left",       ArrowLeft:  "left",
      KeyD: "right",      ArrowRight: "right",
    };

    this._locked = false;

    this._onKeyDown = (e) => {
      if (this._locked) return;
      const action = this._keyMap[e.code];
      if (action) { this.actions[action] = true; e.preventDefault(); }
    };

    this._onKeyUp = (e) => {
      const action = this._keyMap[e.code];
      if (action) this.actions[action] = false;
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup",   this._onKeyUp);
  }

  get locked() { return this._locked; }
  set locked(v) {
    this._locked = v;
    if (v) {
      this.actions.forward = this.actions.backward =
      this.actions.left    = this.actions.right    = false;
    }
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup",   this._onKeyUp);
  }
}
