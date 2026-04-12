/**
 * ==========================================
 * Controls — 入力管理 (キーボード / タッチ)
 * ==========================================
 * Bruno Simon 風: Controls は boolean flags だけ管理。
 * Boat や他のシステムは actions を読むだけ。
 *
 * 今後の拡張:
 *   - タッチ仮想ジョイスティック
 *   - ゲームパッド対応
 */

export class Controls {
  constructor() {
    // === Action flags — 他のシステムはこれを読むだけ ===
    this.actions = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };

    // === キーボード ===
    this._keyMap = {
      KeyW: "forward",    ArrowUp: "forward",
      KeyS: "backward",   ArrowDown: "backward",
      KeyA: "left",       ArrowLeft: "left",
      KeyD: "right",      ArrowRight: "right",
    };

    this._onKeyDown = (e) => {
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

    // TODO: タッチ仮想ジョイスティック
    // TODO: Gamepad API
  }

  /**
   * クリーンアップ (必要な場合)
   */
  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
  }
}