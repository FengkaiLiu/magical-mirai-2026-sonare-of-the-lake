/**
 * SongSelectScene — 6 floating wooden song cards arranged in a circle.
 * Boat spawns at center; sailing into a card calls onSelect(songIndex).
 * Hover glow via raycasting. Cards scatter on selection.
 */

import * as THREE from "three";
import { Water } from "./water.js";
import { Environment } from "./environment.js";
import { Boat } from "./boat.js";
import { CameraController } from "./camera.js";
import { Controls } from "./controls.js";
import { SONGS } from "./songs.js";
import { LyricFormation } from "./fish-school.js";

// ── Song Card ────────────────────────────────────────────────────────────────

class SongCard {
  constructor(song, index, engine, x, z) {
    this.engine = engine;
    this.songIndex = index;
    this.x = x;
    this.z = z;
    this.baseY = 0.65;
    this.bobOffset = index * ((Math.PI * 2) / SONGS.length);
    // Cards start underwater; _emerging drives the rise animation
    this._currentY  = -5;
    this._emerging  = false;
    this.scattered = false;
    this.scatterVel = new THREE.Vector3();

    // --- Canvas texture ---
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");

    // Wood background
    ctx.fillStyle = "#c09060";
    ctx.fillRect(0, 0, 512, 256);

    // Wood grain lines
    ctx.strokeStyle = "rgba(70,40,10,0.18)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const gy = 256 * (0.1 + Math.random() * 0.8);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(512, gy + (Math.random() - 0.5) * 20);
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "rgba(50,25,8,0.55)";
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 240);

    // Trophy badge for first song
    if (index === 0) {
      ctx.font = "38px serif";
      ctx.fillText("🏆", 18, 50);
    }

    // Title — auto-size to fit
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let fontSize = 46;
    const fontFace = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
    ctx.font = fontFace(fontSize);
    while (ctx.measureText(song.title).width > 450 && fontSize > 20) {
      fontSize -= 2;
      ctx.font = fontFace(fontSize);
    }
    ctx.fillStyle = "#18080a";
    ctx.strokeStyle = "rgba(255,230,180,0.5)";
    ctx.lineWidth = 2;
    ctx.strokeText(song.title, 256, 115);
    ctx.fillText(song.title, 256, 115);

    // Artist
    ctx.font = '28px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif';
    ctx.fillStyle = "#5a3010";
    ctx.fillText(song.artist, 256, 182);

    this.texture = new THREE.CanvasTexture(canvas);

    // --- Card mesh: BoxGeometry with textured top face ---
    const geo = new THREE.BoxGeometry(4.2, 0.15, 2.1);
    const woodSide = new THREE.MeshLambertMaterial({ color: 0x8b6030 });
    const topMat = new THREE.MeshLambertMaterial({ map: this.texture });
    // BoxGeometry face order: [+x, -x, +y (top), -y, +z, -z]
    this.mesh = new THREE.Mesh(geo, [woodSide, woodSide, topMat, woodSide, woodSide, woodSide]);
    this.mesh.position.set(x, this._currentY, z);
    this.mesh.lookAt(0, this._currentY, 0); // point the front edge at the lake center

    // Tilt the board up by 45 degrees so the top face (with the text) faces you!
    this.mesh.rotateX(Math.PI / 3);

    this.mesh.castShadow = true;
    // Hidden underwater until emerge() is called after the dive lands
    this.mesh.visible = false;
    engine.scene.add(this.mesh);

    // Support post
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 8);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x6b4020 });
    this.post = new THREE.Mesh(postGeo, postMat);
    this.post.position.set(x, this._currentY - 0.72, z);
    this.post.visible = false; // hidden until emerge()
    engine.scene.add(this.post);
  }

  /** Begin the rising-from-water animation for this card. */
  emerge() {
    this._emerging    = true;
    this.mesh.visible = true;
    this.post.visible = true;
  }

  update(dt, elapsed, _isHovered) {
    if (this.scattered) {
      this.mesh.position.x += this.scatterVel.x * dt;
      this.mesh.position.z += this.scatterVel.z * dt;
      this.mesh.position.y += this.scatterVel.y * dt;
      this.scatterVel.y -= 9 * dt; // gravity pull
      this.post.position.copy(this.mesh.position);
      this.post.position.y -= 0.72;
      return;
    }

    if (this._emerging && this._currentY < this.baseY) {
      // Exponential ease-out rise: covers ~95 % of distance in ~1.5 s
      const alpha = 1 - Math.pow(1 - 0.05, dt * 60);
      this._currentY += (this.baseY - this._currentY) * alpha;
      if (this._currentY >= this.baseY - 0.01) {
        this._currentY = this.baseY;
        this._emerging = false;
      }
    }

    const bobY = this._emerging
      ? this._currentY  // no bob while still rising
      : this.baseY + Math.sin(elapsed * 1.2 + this.bobOffset) * 0.09;

    this.mesh.position.y = bobY;
    this.post.position.y = bobY - 0.72;
  }

  scatter() {
    this.scattered = true;
    const angle = Math.atan2(this.z, this.x); // radially outward
    const speed = 9 + Math.random() * 5;
    this.scatterVel.set(
      Math.cos(angle) * speed,
      4 + Math.random() * 4,
      Math.sin(angle) * speed
    );
  }

  dispose() {
    const scene = this.engine.scene;
    scene.remove(this.mesh);
    scene.remove(this.post);
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.post.geometry.dispose();
    for (const m of this.mesh.material) if (m && m.dispose) m.dispose();
    this.post.material.dispose();
  }
}

// ── SongSelectScene ──────────────────────────────────────────────────────────

export class SongSelectScene {
  constructor(engine, onSelect) {
    this.engine = engine;
    this.onSelect = onSelect;
    this.cards = [];
    this.selected = false;

    this._disposed = false;
    this._updatable = { update: (dt, el) => this._update(dt, el) };

    // Raycaster for hover glow
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this._onMouseMove = (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", this._onMouseMove);

    // Scene objects
    this.water = new Water(engine);
    this.env = new Environment(engine);
    this.engine.env = this.env;
    this.controls = new Controls();
    // Disable input until after the dive lands
    this.controls.locked = true;
    this.boat = new Boat(engine, this.controls);
    this.boat.mesh.visible = false; // hidden until particles scatter after dive
    this.cam = new CameraController(engine);
    this.cam.attachBoat(this.boat);

    // 6 cards in a horizontal row, all starting underwater
    SONGS.forEach((song, i) => {
      const spacing = 5.5;
      const totalWidth = (SONGS.length - 1) * spacing; // 27.5 for 6 songs
      const x = i * spacing - totalWidth / 2;           // −13.75 … +13.75
      const z = -14;
      this.cards.push(new SongCard(song, i, engine, x, z));
    });

    // Hide the overlay but keep intro-screen visible
    document.getElementById("overlay")?.classList.add("hidden");

    // ── Intro timeline ────────────────────────────────────────────
    this._introFormations = [];
    this._introActive = true;
    // beginIntroSequence() is called externally by the Start button in main.js

    engine.addUpdatable(this._updatable);
  }

  // ─── Intro helpers ─────────────────────────────────────────────

  /**
   * Called by the Start button click in main.js.
   * Fades the 2-D intro screen, reveals the overhead lake view, spawns
   * the fish-particle title text, then dives to the boat after a hold.
   */
  beginIntroSequence() {
    if (this._disposed) return;

    // Fade the 2D screen away — 3D overhead lake is now visible
    const introEl = document.getElementById("intro-screen");
    if (introEl) {
      introEl.classList.add("hidden");
      setTimeout(() => introEl.classList.add("gone"), 950);
    }

    // Small pause so the fade-out plays before fish appear
    setTimeout(() => this._spawnTitleFormations(), 500);
  }

  _spawnTitleFormations() {
    if (this._disposed) return;
    const TITLE_COLOR = 0x40d8f0;
    const SUB_COLOR   = 0x88e8ff;

    // textScale=2.8 → formation ~67 world units wide (visible from H=90 overhead).
    // poolRadius=38 → particles start scattered over a large area before forming.
    const f1 = new LyricFormation(
      this.engine,
      new THREE.Vector3(0, 0, -8),
      "Magic Mirai",
      TITLE_COLOR,
      { textScale: 2.8, poolRadius: 38 }
    );
    // Subtitle slightly smaller so it sits clearly below the main title
    const f2 = new LyricFormation(
      this.engine,
      new THREE.Vector3(0, 0, 10),
      "Sonare of the Lake",
      SUB_COLOR,
      { textScale: 1.8, poolRadius: 30 }
    );
    this._introFormations = [f1, f2];

    // Hold the formed titles for 3.5 s, then dive
    setTimeout(() => this._beginDive(), 3500);
  }

  _beginDive() {
    if (this._disposed) return;
    // Callback fires when the camera reaches the boat-follow position (~1.2 s)
    this.cam.onDiveComplete = () => this._onDiveLanded();
    this.cam.startDive();
  }

  _onDiveLanded() {
    if (this._disposed) return;

    // Scatter fish particles — they burst outward revealing the boat
    for (const f of this._introFormations) f.triggerScatter();

    // Lock camera at its landed position; boat sails in while cam is still
    this.cam.revealLock = true;
    this.boat.mesh.visible = true;
    this.boat.startEntrance();

    // Brief sun flash for "impact" feel
    if (this.env && this.env.sunLight) {
      const sun = this.env.sunLight;
      sun.intensity = sun.intensity * 1.2; // 20 % over-exposure
      setTimeout(() => { if (sun) sun.intensity = this.env.baseSunIntensity; }, 350);
    }

    // Emerge all song cards from underwater, staggered slightly per card
    this.cards.forEach((card, i) => {
      setTimeout(() => {
        card.emerge();
        // Ripple at each card's world position as it breaks the surface
        if (this.water && this.water.triggerRipple) {
          this.water.triggerRipple(new THREE.Vector3(card.x, 0, card.z));
        }
      }, i * 80);
    });

    // Re-enable controls & show hint after cards finish rising (~1.8 s)
    setTimeout(() => {
      if (this._disposed) return;
      this.controls.locked = false;
      this._introActive = false;
      const hint = document.getElementById("select-hint");
      if (hint) hint.style.display = "block";
    }, 1800);
  }

  _update(dt, elapsed) {
    if (this.selected) return;

    // Tick intro fish formations while they're alive
    if (this._introFormations.length > 0) {
      for (let i = this._introFormations.length - 1; i >= 0; i--) {
        const f = this._introFormations[i];
        f.update(dt, elapsed, null, null);
        if (f.faded) {
          f.dispose();
          this._introFormations.splice(i, 1);
        }
      }
    }

    // Cards always need updating (emergence animation runs during intro too)
    let hoveredMesh = null;
    if (!this._introActive) {
      this.raycaster.setFromCamera(this.mouse, this.engine.camera);
      const meshes = this.cards.map((c) => c.mesh);
      const hits = this.raycaster.intersectObjects(meshes);
      hoveredMesh = hits.length > 0 ? hits[0].object : null;
    }

    for (const card of this.cards) {
      card.update(dt, elapsed, card.mesh === hoveredMesh);
    }

    // Don't check collision until intro is done
    if (this._introActive) return;

    // Release camera reveal lock once the boat's auto-drive has finished
    if (this.cam.revealLock) {
      if (!this.boat._autoTarget) {
        this.cam.revealLock = false;
      }
      return; // no collision check while boat is still entering
    }

    // Collision: boat within 2.5 units of card center
    const bp = this.boat.getPosition();
    for (const card of this.cards) {
      const dx = bp.x - card.x;
      const dz = bp.z - card.z;
      if (Math.sqrt(dx * dx + dz * dz) < 2.5) {
        this._select(card.songIndex);
        return;
      }
    }
  }

  _select(index) {
    this.selected = true;
    for (const card of this.cards) card.scatter();
    // 200ms: enough to see scatter begin before the fade-to-black overlay starts
    setTimeout(() => this.onSelect(index), 200);
  }

  dispose() {
    this._disposed = true;
    this.engine.removeUpdatable(this._updatable);

    window.removeEventListener("mousemove", this._onMouseMove);

    for (const f of this._introFormations) f.dispose();
    this._introFormations = [];

    this.water.dispose();
    this.env.dispose();
    this.boat.dispose();
    this.cam.dispose();
    this.controls.dispose();
    for (const card of this.cards) card.dispose();

    const hint = document.getElementById("select-hint");
    if (hint) hint.style.display = "none";
  }
}
