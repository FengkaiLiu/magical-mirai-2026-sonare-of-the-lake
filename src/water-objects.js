/**
 * WaterObjects — Floating planks and glowing notes for the play phase.
 *
 * Planks: physics bodies that drift on the water surface.
 *         Boat collision → shatter into fragment pieces.
 * Notes:  kinematic glowing orbs at water surface.
 *         Boat collision → fish color shift + spark burst.
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { waveHeight } from "./boat.js";
import { preloadGLTF } from "./asset-cache.js";

// ─── Config ─────────────────────────────────────────────

const PLANK_INTERVAL   = 9.0;
const PLANK_SPAWN_DIST = 18;
const PLANK_SCATTER    = 6;
const MAX_PLANKS       = 6;
const MAX_NOTES        = 3;
const NOTE_INTERVAL    = 12.0;
const NOTE_SPAWN_RANGE = 28;

const NOTE_COLORS = [
  0xff6688, 0xff99cc, 0xffcc44, 0x44ffcc,
  0x88aaff, 0xff8844, 0xaaffee, 0xff44aa,
];

// Scale applied to the musicnote.glb scene root — tweak if the model appears too large/small.
const NOTE_MODEL_SCALE = 0.4;
// Radius of the additive halo icosahedron (see getNoteHaloGeo). Lift must clear this too,
// otherwise the halo sphere dips below the wave even when the model itself is above it.
const NOTE_HALO_RADIUS = 0.7;

function randRange(a, b) { return a + Math.random() * (b - a); }

// Shared geometries for note halo and icosahedron fallback — avoids per-note allocation.
let _NOTE_HALO_GEO     = null;
let _NOTE_FALLBACK_GEO = null;
function getNoteHaloGeo()     { return _NOTE_HALO_GEO     ??= new THREE.IcosahedronGeometry(NOTE_HALO_RADIUS, 1); }
function getNoteFallbackGeo() { return _NOTE_FALLBACK_GEO ??= new THREE.IcosahedronGeometry(0.45, 1); }

// Shared geometry + material for all planks — no per-plank GPU allocation or disposal stall.
const _PLANK_GEO = new THREE.BoxGeometry(2.2, 0.18, 0.55);
const _PLANK_MAT = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9, metalness: 0 });

// Shared unit-cube geometry for plank fragments — avoids per-shatter allocation.
const _FRAG_GEO = new THREE.BoxGeometry(1, 1, 1);
// MeshBasicMaterial for fragments: reuses the already-compiled basic shader (no GL compile stall on hit).
const _FRAG_MAT = new THREE.MeshBasicMaterial({ color: 0x7a4a22, transparent: true });

// ─── WaterObjects ────────────────────────────────────────

export class WaterObjects {
  constructor(engine, boat, fishLyricSystem, lyricManager = null) {
    this.engine  = engine;
    this.boat    = boat;
    this.fish    = fishLyricSystem;
    this.lyrics  = lyricManager;

    this._planks    = [];
    this._notes     = [];
    this._fragments = [];
    this._sparks    = [];
    this._elapsed   = 0;
    // Cached each frame so spawn helpers (which run inside update) match the wave
    // height that the water shader uses.  Without this, waveHeight() defaults to
    // energy=0 while the GPU water sees the boosted amplitude during loud
    // passages — objects spawn or track ~0.5 world units below the visible surface.
    this._energy    = 0;
    this._plankTimer = PLANK_INTERVAL * 0.5;
    this._noteTimer  = NOTE_INTERVAL  * 0.3;
    this._pendingBodyRemoval = [];

    this._score   = 0;
    this._scoreEl = this._initScoreEl();
    this._boatBody = boat.body;
    this._buoyForce = new CANNON.Vec3(); // reused per-plank per-frame to avoid heap churn

    // Pre-load music note GLB; assigned when resolved so _createNote can use it immediately.
    // _noteLiftY: how far to raise the mesh so its visual bottom clears the wave surface.
    // Default 0.5 covers the fallback icosahedron (radius 0.45); overwritten after the
    // GLB bounding box is measured at NOTE_MODEL_SCALE.
    this._noteModel = null;
    this._noteLiftY = 0.5;
    preloadGLTF("models/musicnote.glb").then(gltf => {
      this._noteModel = gltf;
      // Lift must clear BOTH (a) the model's own bottom and (b) the additive halo sphere
      // attached as a child (radius NOTE_HALO_RADIUS, inheriting the root's scale).
      // Many GLB exports put the origin at the model's visual bottom, so box.min.y ≈ 0
      // and the model term collapses to the 0.2 floor — without the halo term, the halo
      // sphere then sits ~0.08 below the wave and the note reads as half-submerged.
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const modelLift = -box.min.y * NOTE_MODEL_SCALE + 0.2;
      const haloLift  = NOTE_HALO_RADIUS  * NOTE_MODEL_SCALE + 0.2;
      this._noteLiftY = Math.max(0.2, modelLift, haloLift);

      // Prewarm: force geometry upload + shader compilation for the note materials
      // so the first natural spawn doesn't cause a one-frame GPU stall.
      // Position far off-world with frustumCulled=false so it's drawn (triggering
      // the upload) but invisible to the player.
      if (!this._disposed) {
        const dummy = gltf.scene.clone(true);
        dummy.position.set(9999, 0, 9999);
        dummy.traverse(c => {
          if (!c.isMesh) return;
          c.frustumCulled = false;
          c.material = c.material.clone();
          c.material.transparent = true;
          c.material.depthWrite  = false;
        });
        // Add halo sphere so its shader variant also warms up
        dummy.add(new THREE.Mesh(getNoteHaloGeo(),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide })));
        this.engine.scene.add(dummy);
        requestAnimationFrame(() => {
          // Do NOT call material.dispose() here — cloned materials share texture
          // references with gltf.scene originals, so dispose() would release the
          // shared textures and cause all subsequent notes to render white.
          this.engine.scene.remove(dummy);
        });
      }
    }).catch(e => console.warn("[WaterObjects] Failed to load musicnote.glb:", e));

    // Prewarm plank geometry + material (module-level, never drawn until first _createPlank).
    {
      const dummyMat = _PLANK_MAT.clone();
      dummyMat.transparent = true;
      dummyMat.opacity = 0.001;
      const dummyPlank = new THREE.Mesh(_PLANK_GEO, dummyMat);
      dummyPlank.frustumCulled = false;
      dummyPlank.position.set(9999, 0, 9999);
      engine.scene.add(dummyPlank);
      requestAnimationFrame(() => { engine.scene.remove(dummyPlank); dummyMat.dispose(); });
    }

    engine.addUpdatable(this);
  }

  _initScoreEl() {
    let el = document.getElementById("water-score");
    if (!el) {
      el = document.createElement("div");
      el.id = "water-score";
      el.style.cssText = [
        "position:fixed", "top:70px", "right:24px",
        "color:#aff", "font-size:1.1rem", "font-family:monospace",
        "text-shadow:0 0 8px #0ff", "opacity:0",
        "transition:opacity 0.4s", "pointer-events:none",
      ].join(";");
      document.body.appendChild(el);
    }
    return el;
  }

  _showScore() {
    this._scoreEl.textContent = `🪵 ×${this._score}`;
    this._scoreEl.style.opacity = "1";
    clearTimeout(this._scoreHideTimer);
    this._scoreHideTimer = setTimeout(() => { this._scoreEl.style.opacity = "0"; }, 2500);
  }

  // ─── Spawn helpers ─────────────────────────────────────

  _spawnPlankAheadOfBoat() {
    if (this._planks.length >= MAX_PLANKS) return;
    const bp = this.boat.getPosition();
    const angle = Math.random() * Math.PI * 2;
    const dist  = PLANK_SPAWN_DIST + randRange(-3, 3);
    const px = bp.x + Math.sin(angle) * dist + randRange(-PLANK_SCATTER, PLANK_SCATTER);
    const pz = bp.z + Math.cos(angle) * dist + randRange(-PLANK_SCATTER, PLANK_SCATTER);
    this._planks.push(this._createPlank(px, pz));
  }

  _spawnNoteRandom() {
    if (this._notes.length >= MAX_NOTES) return;
    const bp = this.boat.getPosition();
    const angle = Math.random() * Math.PI * 2;
    const dist  = 8 + Math.random() * NOTE_SPAWN_RANGE;
    const px = Math.max(-38, Math.min(38, bp.x + Math.cos(angle) * dist));
    const pz = Math.max(-38, Math.min(38, bp.z + Math.sin(angle) * dist));
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    this._notes.push(this._createNote(new THREE.Vector3(px, 0, pz), color));
  }

  _createPlank(px, pz) {
    const wy  = waveHeight(px, pz, this._elapsed, this._energy) + 0.05;
    const spawnY = wy - 0.72;
    // Clone material per plank so we can fade opacity independently.
    const mat = _PLANK_MAT.clone();
    mat.transparent = true;
    mat.opacity = 0;
    const mesh = new THREE.Mesh(_PLANK_GEO, mat);
    mesh.position.set(px, spawnY, pz);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.castShadow = true;
    this.engine.scene.add(mesh);

    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(1.1, 0.09, 0.275)),
      material: this.engine.materials.lyric,
    });
    body.position.set(px, spawnY, pz);
    body.collisionResponse = false;
    this.engine.world.addBody(body);

    const plank = { mesh, body, mat, alive: true, age: 0, opacity: 0, _prevY: spawnY };
    body.addEventListener("collide", (event) => {
      if (!plank.alive) return;
      if (event.body === this._boatBody) { plank.alive = false; plank._pendingShatter = true; }
    });
    return plank;
  }

  _createNote(pos, color) {
    const colorObj = new THREE.Color(color);
    let mesh;

    if (this._noteModel) {
      // Clone the cached GLB scene so each note is independent
      const root = this._noteModel.scene.clone(true);
      root.scale.setScalar(NOTE_MODEL_SCALE);
      root.traverse(child => {
        if (!child.isMesh) return;
        child.material              = child.material.clone();
        child.material.transparent  = true;
        child.material.opacity      = 0.9;
        child.material.emissive     = colorObj.clone();
        child.material.emissiveIntensity = 1.5;
        child.material.depthWrite   = false;
      });
      mesh = root;
    } else {
      // Fallback until GLB resolves (rare — model loads fast from cache)
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
      mesh = new THREE.Mesh(getNoteFallbackGeo(), mat);
    }

    // Additive glow halo — shared geometry, per-note material
    const haloMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    });
    mesh.add(new THREE.Mesh(getNoteHaloGeo(), haloMat));

    // Force every sub-mesh into the renderOrder=1 bucket so the note paints AFTER
    // the water (which is renderOrder=0, transparent, depthWrite=false). Without this
    // the per-distance transparent sort puts the note — usually 8–28 units from the
    // boat — "farther" than the water plane center, so the water blends on top of the
    // note and it looks half-submerged from level views and fully submerged from above.
    // Same convention boat.js / fish-school.js / song-circles.js follow.
    mesh.traverse(child => { if (child.isMesh) child.renderOrder = 1; });

    const wy = waveHeight(pos.x, pos.z, this._elapsed, this._energy) + this._noteLiftY;
    mesh.position.set(pos.x, wy, pos.z);
    this.engine.scene.add(mesh);

    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Sphere(1.2),
      material: this.engine.materials.lyric,
    });
    body.type = CANNON.Body.KINEMATIC;
    body.collisionResponse = false;
    body.position.set(pos.x, wy, pos.z);
    this.engine.world.addBody(body);

    const note = { mesh, body, color, alive: true, age: 0, fadeOut: false, opacity: 0 };
    body.addEventListener("collide", (event) => {
      if (!note.alive || note.fadeOut) return;
      if (event.body === this._boatBody) { note.fadeOut = true; note._pendingHit = true; }
    });
    return note;
  }

  // ─── Effect handlers ───────────────────────────────────

  _shatterPlank(plank) {
    const pos = plank.mesh.position.clone();
    this._pendingBodyRemoval.push(plank.body);
    this.engine.scene.remove(plank.mesh);
    // _PLANK_GEO and _PLANK_MAT are module-level shared — do NOT dispose them.

    for (let i = 0; i < 5; i++) {
      const size = randRange(0.12, 0.35);
      const fMesh = new THREE.Mesh(_FRAG_GEO, _FRAG_MAT.clone()); // clone for per-fragment opacity
      fMesh.scale.set(size, size * 0.3, size * 0.5);
      fMesh.position.copy(pos).add(new THREE.Vector3(
        randRange(-0.5, 0.5), randRange(0, 0.3), randRange(-0.5, 0.5)));
      fMesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.engine.scene.add(fMesh);
      this._fragments.push({
        mesh: fMesh,
        vel:  new THREE.Vector3(randRange(-3, 3), randRange(2, 6), randRange(-3, 3)),
        rot:  new THREE.Vector3(randRange(-4, 4), randRange(-4, 4), randRange(-4, 4)),
        life: 1.0,
      });
    }

    this._score++;
    this._showScore();
  }

  _hitNote(note) {
    note.fadeOut = true;
    if (this.fish)   this.fish.triggerColorShift(note.color, 10.0);
    if (this.lyrics) this.lyrics.setActiveColor(note.color);

    const pos = note.mesh.position;
    const sparkCount = 24;
    const sparkPos = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      sparkPos[i * 3] = pos.x; sparkPos[i * 3 + 1] = pos.y; sparkPos[i * 3 + 2] = pos.z;
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: note.color, size: 0.25, transparent: true, opacity: 1.0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    this.engine.scene.add(sparks);
    const sparkVels = Array.from({ length: sparkCount }, (_, i) => {
      const a = (i / sparkCount) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * randRange(2, 5), randRange(0.5, 2), Math.sin(a) * randRange(2, 5));
    });
    this._sparks.push({ mesh: sparks, vels: sparkVels, life: 1.0 });

    this._pendingBodyRemoval.push(note.body);
  }

  // ─── Update ────────────────────────────────────────────

  update(dt, elapsed) {
    this._elapsed = elapsed;
    this._energy  = this.engine.env?.smoothedEnergy ?? 0;

    // cannon-es removeBody is a no-op for unregistered bodies, so duplicate calls are safe.
    for (const body of this._pendingBodyRemoval) this.engine.world.removeBody(body);
    this._pendingBodyRemoval.length = 0;

    for (const p of this._planks) {
      if (p._pendingShatter) { p._pendingShatter = false; this._shatterPlank(p); }
    }
    for (const n of this._notes) {
      if (n._pendingHit) { n._pendingHit = false; this._hitNote(n); }
    }

    if (!this._fadingOut) {
      this._plankTimer -= dt;
      if (this._plankTimer <= 0) { this._plankTimer = PLANK_INTERVAL; this._spawnPlankAheadOfBoat(); }
      this._noteTimer -= dt;
      if (this._noteTimer <= 0) { this._noteTimer = NOTE_INTERVAL; this._spawnNoteRandom(); }
    }

    for (let i = this._planks.length - 1; i >= 0; i--) {
      const p = this._planks[i];
      if (!p.alive) { this._planks.splice(i, 1); continue; }
      p.age += dt;
      if (p.opacity < 1) { p.opacity = Math.min(1, p.opacity + dt * 2.5); p.mat.opacity = p.opacity; }
      const bx = p.body.position.x, bz = p.body.position.z;
      const surfaceY = waveHeight(bx, bz, elapsed, this._energy) + 0.05;
      const riseT = Math.min(1, p.age / 1.2);
      const targetY = surfaceY - (1 - riseT) * 0.72;
      const smoothedY = p.body.position.y + (targetY - p.body.position.y) * Math.min(1, dt * 7.5);
      p.body.velocity.y = dt > 0 ? (smoothedY - p._prevY) / dt : 0;
      p._prevY = smoothedY;
      p.body.position.y = smoothedY;
      p.mesh.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
      p.mesh.quaternion.set(
        p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
      const bp = this.boat.getPosition();
      const dx = p.mesh.position.x - bp.x, dz = p.mesh.position.z - bp.z;
      if (dx * dx + dz * dz > 80 * 80) { this._destroyPlank(p); this._planks.splice(i, 1); }
    }

    for (let i = this._notes.length - 1; i >= 0; i--) {
      const n = this._notes[i];
      n.age += dt;
      const bx = n.mesh.position.x, bz = n.mesh.position.z;
      const wy  = waveHeight(bx, bz, elapsed, this._energy) + this._noteLiftY;
      n.mesh.position.y = wy;
      if (!n.fadeOut) n.body.position.set(bx, wy, bz);
      n.mesh.rotation.y += dt * 1.2;
      if (!n.fadeOut && n.opacity < 0.9) {
        n.opacity = Math.min(0.9, n.opacity + dt * 2.5);
        n.mesh.traverse(child => { if (child.isMesh && child.material) child.material.opacity = n.opacity; });
      }
      if (n.fadeOut) {
        n.opacity = Math.max(0, n.opacity - dt * 3);
        n.mesh.traverse(child => {
          if (child.isMesh && child.material) child.material.opacity = n.opacity;
        });
        if (n.opacity <= 0) { this._destroyNote(n); this._notes.splice(i, 1); }
      }
      if (n.age > 30 && !n.fadeOut) n.fadeOut = true;
    }

    for (let i = this._fragments.length - 1; i >= 0; i--) {
      const f = this._fragments[i];
      f.life -= dt * 0.65;
      if (f.life <= 0) {
        this.engine.scene.remove(f.mesh);
        f.mesh.material.dispose(); // shared _FRAG_GEO — do NOT dispose geometry
        this._fragments.splice(i, 1); continue;
      }
      f.vel.y -= 9.8 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.rot.x * dt;
      f.mesh.rotation.y += f.rot.y * dt;
      f.mesh.rotation.z += f.rot.z * dt;
      f.mesh.material.opacity = f.life;
      f.mesh.material.transparent = true;
    }

    for (let i = this._sparks.length - 1; i >= 0; i--) {
      const s = this._sparks[i];
      s.life -= dt * 1.1;
      if (s.life <= 0) {
        this.engine.scene.remove(s.mesh);
        s.mesh.geometry.dispose(); s.mesh.material.dispose();
        this._sparks.splice(i, 1); continue;
      }
      const positions = s.mesh.geometry.attributes.position.array;
      for (let j = 0; j < s.vels.length; j++) {
        s.vels[j].y -= 4.0 * dt;
        positions[j * 3]     += s.vels[j].x * dt;
        positions[j * 3 + 1] += s.vels[j].y * dt;
        positions[j * 3 + 2] += s.vels[j].z * dt;
      }
      s.mesh.geometry.attributes.position.needsUpdate = true;
      s.mesh.material.opacity = s.life;
    }
  }

  // ─── Cleanup ───────────────────────────────────────────

  _destroyPlank(p) {
    this._pendingBodyRemoval.push(p.body);
    this.engine.scene.remove(p.mesh);
    p.mat?.dispose(); // per-plank cloned material; geometry is shared — do NOT dispose it
  }

  _destroyNote(n) {
    this._pendingBodyRemoval.push(n.body);
    this.engine.scene.remove(n.mesh);
    // Dispose only per-note cloned materials. Geometries are shared (GLB cache /
    // module-level getNoteHaloGeo / getNoteFallbackGeo) — do NOT dispose them.
    n.mesh.traverse(child => {
      if (child.isMesh) child.material?.dispose();
    });
  }

  // Gracefully wind down: stop spawning, fade notes, remove planks immediately.
  // Fragments and sparks self-clean via their existing life decay.
  beginFadeOut() {
    this._fadingOut = true;
    for (const n of this._notes) n.fadeOut = true;
    for (const p of [...this._planks]) this._destroyPlank(p);
    this._planks = [];
  }

  dispose() {
    this.engine.removeUpdatable(this);
    for (const p of this._planks) this._destroyPlank(p);
    for (const n of this._notes)  this._destroyNote(n);
    for (const body of this._pendingBodyRemoval) this.engine.world.removeBody(body);
    this._pendingBodyRemoval.length = 0;
    for (const f of this._fragments) {
      this.engine.scene.remove(f.mesh);
      f.mesh.material.dispose(); // shared _FRAG_GEO — do NOT dispose geometry
    }
    for (const s of this._sparks) {
      this.engine.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    if (this._scoreEl) this._scoreEl.remove();
    this._planks = [];
    this._notes  = [];
  }
}
