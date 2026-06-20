/**
 * ==========================================
 * Boat — Cannon-es physics-driven boat
 * ==========================================
 * Reads Controls.actions to move; keyboard input is owned by Controls.
 * The Three.js mesh is synced to the physics body each frame.
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { preloadGLTF } from "./asset-cache.js";
import { getBoat } from "./i18n.js";

class ParticleTrail {
  constructor(engine) {
    this.engine = engine;
    this.scene = engine.scene;
    this.maxParticles = 150;
    this.particles = [];
    this.poolIndex = 0;

    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xccffff, // Cyan-white foam tint
      transparent: true,
      opacity: 0,
    });

    for (let i = 0; i < this.maxParticles; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.renderOrder = 1; // render after water-decal lyrics (renderOrder=0)
      mesh.position.y = -999;
      this.scene.add(mesh);
      this.particles.push({
        mesh, life: 0,
        vx: 0, vy: 0, vz: 0
      });
    }
  }

  spawn(pos, forward, speed) {
    if (speed < 0.5) return;

    for (const side of [-1, 1]) {
      const p = this.particles[this.poolIndex];
      this.poolIndex = (this.poolIndex + 1) % this.maxParticles;

      p.life = 1.0;
      
      const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;
      const wh = waveHeight(pos.x, pos.z, 0, energy);

      // Distinct spawn points at the rear quarters of the hull
      const sideOffset = side * 0.4; // Wider spawn to prevent lines crossing
      const backOffset = 1.4;
      
      // Calculate world-space spawn position for this side
      p.mesh.position.copy(pos);
      p.mesh.position.y = wh + 0.02;
      p.mesh.position.x -= forward.x * backOffset + forward.z * sideOffset;
      p.mesh.position.z -= forward.z * backOffset - forward.x * sideOffset;
      
      // Push particles more backwards and less outwards to keep lines parallel
      p.vx = -forward.x * 1.2 + forward.z * side * 0.6;
      p.vz = -forward.z * 1.2 - forward.x * side * 0.6;
      
      const s = 0.4 + Math.random() * 0.8;
      p.mesh.scale.set(s, s, s);
      p.mesh.material.opacity = 0.6;
      p.mesh.rotation.y = Math.random() * Math.PI;
    }
  }

  update(dt, elapsed) {
    const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;

    for (const p of this.particles) {
      if (p.life > 0) {
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.z += p.vz * dt;

        // Stick to the waves!
        const wh = waveHeight(p.mesh.position.x, p.mesh.position.z, elapsed, energy);
        p.mesh.position.y = wh + 0.02;

        p.life -= dt * 1.0;
        if (p.life < 0) p.life = 0;

        p.mesh.material.opacity = p.life * 0.7;

        const s = p.mesh.scale.x * 0.98;
        p.mesh.scale.set(s, s, s);
      }
    }
  }

  dispose() {
    // All particles share the same BoxGeometry — dispose it once, not per-particle.
    const sharedGeo = this.particles[0]?.mesh.geometry;
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    sharedGeo?.dispose();
  }
}

export function waveHeight(x, z, t, energy = 0) {
  const ampMod = 1.0 + energy * 2.0;
  const spdMod = 1.0 + energy * 1.5;
  const w = (px, pz, dx, dz, len, amp, spd) =>
    amp * ampMod * Math.sin(Math.PI * (px * dx + pz * dz) / len + spd * spdMod * t);
  return w(x, z,  0.8,  0.6, 5.0, 0.08, 0.7)
       + w(x, z, -0.5,  0.8, 8.0, 0.05, 0.5)
       + w(x, z,  0.3, -0.7, 3.0, 0.03, 1.0)
       + w(x, z,  0.6, -0.4, 1.5, 0.012, 1.8)
       + w(x, z, -0.3,  0.9, 2.0, 0.015, 1.4);
}

export class Boat {
  constructor(engine, controls) {
    this.engine = engine;
    this.controls = controls;

    // === Cannon-es physics body ===
    const shape = new CANNON.Box(new CANNON.Vec3(0.4, 1, 0.5));
    this.body = new CANNON.Body({
      mass: 5,
      position: new CANNON.Vec3(0, 0.5, 0),
      material: engine.materials.boat,
      linearDamping: 0.6,
      angularDamping: 0.85,
      allowSleep: false,
    });
    this.body.addShape(shape);
    // Lock rotation on X and Z axes — boat rotates only around Y (turning)
    this.body.angularFactor.set(0, 1, 0);

    engine.world.addBody(this.body);

    // === Three.js mesh ===
    this.mesh = new THREE.Group();

    // Load the player-selected boat GLB; fall back to Miku if its file is missing.
    const selectedBoat = getBoat();
    preloadGLTF(selectedBoat.glb)
      .then(gltf => this.setModel(gltf.scene.clone(true)))
      .catch(() => {
        if (selectedBoat.fallback) {
          preloadGLTF(selectedBoat.fallback)
            .then(gltf => this.setModel(gltf.scene.clone(true)))
            .catch(err => console.error("Failed to load boat model", err));
        }
      });

    const lantern = new THREE.PointLight(0xffcc55, 0.8, 8);
    lantern.position.set(0, 0.5, -0.4);
    lantern.castShadow = true;
    this.mesh.add(lantern);

    engine.scene.add(this.mesh);

    // === Movement params ===
    this.forwardForce = 25;
    this.turnTorque = 5;

    // === Interpolation state ===
    this._prevPos = new CANNON.Vec3(0, 0.5, 0);
    this._prevQuat = new CANNON.Quaternion(0, 0, 0, 1);

    // === Pre-allocated reusables (avoid per-frame heap allocation) ===
    this._fwdVec    = new CANNON.Vec3(0, 0, -1);  // reused in preStep + trail branch
    this._interpQ   = new CANNON.Quaternion();     // reused in update interpolation
    this._autoFwdVec = new CANNON.Vec3(0, 0, -1); // reused in _autoTarget heading calc

    // Auto-drive target (set by startEntrance, cleared on arrival)
    this._autoTarget = null;

    // === Wake Trail Particles ===
    this.trail = new ParticleTrail(engine);
    this.trailTimer = 0;

    engine.addUpdatable(this);
  }

  saveState() {
    this._prevPos.copy(this.body.position);
    this._prevQuat.copy(this.body.quaternion);
  }

  /**
   * preStep — Pre-physics: read input and set velocities/forces.
   */
  preStep(dt, elapsed) {
    const actions = this.controls.actions;
    const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;

    // Buoyancy: spring force pushing the hull toward the wave surface.
    const wh = waveHeight(this.body.position.x, this.body.position.z, elapsed, energy);
    const waterLevel = wh + 0.15; // offset keeps the hull above water
    const buoyancy = (waterLevel - this.body.position.y) * 40;
    this.body.velocity.y += buoyancy * dt;
    this.body.velocity.y *= 0.9; // water drag

    // Boat heading (reuse pre-allocated _fwdVec — used only within this synchronous block)
    const quat = this.body.quaternion;
    this._fwdVec.set(0, 0, -1);
    quat.vmult(this._fwdVec, this._fwdVec);
    this._fwdVec.y = 0;
    this._fwdVec.normalize();
    const forward = this._fwdVec;

    const vel = this.body.velocity;

    // ── Auto-drive toward target (entrance animation) ───────────────
    if (this._autoTarget) {
      const dx = this._autoTarget.x - this.body.position.x;
      const dz = this._autoTarget.z - this.body.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 0.8) {
        // Arrived — brake and clear target
        vel.x *= 0.85;
        vel.z *= 0.85;
        if (dist < 0.2) this._autoTarget = null;
      } else {
        // Desired heading toward target
        const desiredAngle = Math.atan2(-dx, -dz); // angle in XZ, -Z is forward
        // Current heading from quaternion (reuse pre-allocated _autoFwdVec)
        this._autoFwdVec.set(0, 0, -1);
        this.body.quaternion.vmult(this._autoFwdVec, this._autoFwdVec);
        const currentAngle = Math.atan2(-this._autoFwdVec.x, -this._autoFwdVec.z);
        // Shortest-path angular error
        let err = desiredAngle - currentAngle;
        while (err >  Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        // Proportional turn
        this.body.angularVelocity.y += Math.sign(err) * Math.min(Math.abs(err) * 4, this.turnTorque) * dt;
        // Throttle — ease off when nearly aligned
        const aligned = Math.abs(err) < 0.4;
        if (aligned) {
          vel.x += forward.x * this.forwardForce * dt;
          vel.z += forward.z * this.forwardForce * dt;
        }
      }
    } else {
      if (actions.forward) {
        vel.x += forward.x * this.forwardForce * dt;
        vel.z += forward.z * this.forwardForce * dt;
      }
      if (actions.backward) {
        vel.x -= forward.x * this.forwardForce * 0.3 * dt;
        vel.z -= forward.z * this.forwardForce * 0.3 * dt;
      }
      if (actions.left)  this.body.angularVelocity.y += this.turnTorque * dt;
      if (actions.right) this.body.angularVelocity.y -= this.turnTorque * dt;
    }

    // Soft boundary: quadratic repulsion within 6 units of the play-area edge (±40).
    // Force builds from 0 at the zone entry to 150 m/s² at the edge, strong enough
    // to push back against full throttle while still feeling like water resistance.
    {
      const EDGE = 48, ZONE = 6, STIFF = 150;
      const px = this.body.position.x;
      const pz = this.body.position.z;
      const ox = Math.abs(px) - (EDGE - ZONE);
      const oz = Math.abs(pz) - (EDGE - ZONE);
      if (ox > 0) { const t = ox / ZONE; vel.x -= Math.sign(px) * STIFF * t * t * dt; }
      if (oz > 0) { const t = oz / ZONE; vel.z -= Math.sign(pz) * STIFF * t * t * dt; }
    }

    vel.x *= 0.98;
    vel.z *= 0.98;

    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const maxSpeed = 8;
    if (speed > maxSpeed) {
      const ratio = maxSpeed / speed;
      vel.x *= ratio;
      vel.z *= ratio;
    }

    // Anti-capsize: damp X/Z angular velocity without fully locking it.
    this.body.angularVelocity.x *= 0.85;
    this.body.angularVelocity.z *= 0.85;
  }

  /**
   * update — Post-physics: sync mesh and clamp position to play area.
   * alpha: interpolation factor [0,1) between previous and current physics state.
   */
  update(dt, elapsed, alpha = 1) {
    const p = this.body.position;
    const quat = this.body.quaternion;

    // Hard clamp as a safety net — the soft boundary in preStep normally prevents reaching here.
    p.x = Math.max(-53, Math.min(53, p.x));
    p.z = Math.max(-53, Math.min(53, p.z));

    // Interpolate position between previous and current physics state
    const ix = this._prevPos.x + (p.x - this._prevPos.x) * alpha;
    const iy = this._prevPos.y + (p.y - this._prevPos.y) * alpha;
    const iz = this._prevPos.z + (p.z - this._prevPos.z) * alpha;

    const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;
    const wh = waveHeight(ix, iz, elapsed, energy);
    const finalY = Math.max(iy, wh + 0.05);

    this.mesh.position.set(ix, finalY, iz);

    // Slerp quaternion between previous and current (reuse pre-allocated _interpQ)
    this._prevQuat.slerp(quat, alpha, this._interpQ);
    this.mesh.quaternion.set(this._interpQ.x, this._interpQ.y, this._interpQ.z, this._interpQ.w);

    // Subtle bob
    this.mesh.position.y += Math.sin(elapsed * 1.5) * 0.015;

    // Trail update
    this.trail.update(dt, elapsed);
    this.trailTimer += dt;
    if (this.trailTimer > 0.02) {
      this.trailTimer = 0;

      const v = this.body.velocity;
      const speed = Math.sqrt(v.x * v.x + v.z * v.z);

      // Reuse _fwdVec — trail branch is synchronous and runs after preStep is done
      this._fwdVec.set(0, 0, -1);
      quat.vmult(this._fwdVec, this._fwdVec);
      this._fwdVec.y = 0;
      this._fwdVec.normalize();

      this.trail.spawn(this.mesh.position, this._fwdVec, speed);
    }
  }

  /**
   * Teleport the boat behind the camera then auto-drive it to (0,0,0).
   * startZ: world-space Z to spawn at (camera is at startZ - distance).
   */
  startEntrance(startZ = 12) {
    this.body.position.set(0, 0.5, startZ);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    // Reset orientation so re-entrance always begins facing forward (-Z),
    // independent of whatever heading the boat had before.
    this.body.quaternion.set(0, 0, 0, 1);
    this._prevPos.set(0, 0.5, startZ);
    this._prevQuat.set(0, 0, 0, 1);
    this.mesh.position.set(0, 0.5, startZ);
    this.mesh.quaternion.set(0, 0, 0, 1);

    // Auto-drive toward the lake center
    this._autoTarget = new THREE.Vector3(0, 0, 0);
  }

  getPosition() {
    return this.mesh.position;
  }

  getSpeed() {
    const v = this.body.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z);
  }

  /** Swap to a different boat definition at runtime (e.g. from the boat-select modal). */
  swapModel(boat) {
    if (this._model) {
      // Do NOT dispose the model's geometries/materials: GLTF clone(true)
      // shares them with the cached gltf.scene (asset-cache holds the parsed
      // GLTF indefinitely). Disposing would blank every future clone of this
      // boat — swap to another boat and back, and the model renders untextured.
      this.mesh.remove(this._model);
      this._model = null;
    }
    preloadGLTF(boat.glb)
      .then(gltf => this.setModel(gltf.scene.clone(true)))
      .catch(err => console.error("[Boat] swapModel failed", err));
  }

  /**
   * Replaces current placeholder geometry with a GLTF model.
   * Handles scale, orientation, and visibility toggling.
   */
  setModel(gltfScene, { scale = 0.3, rotationY = Math.PI} = {}) {
    this._model = gltfScene;
    gltfScene.scale.setScalar(scale);
    gltfScene.rotation.y = rotationY;
    gltfScene.position.set(0, 0, 0);
    this.mesh.add(gltfScene);

    // Elevate all boat meshes to renderOrder=1 so they always paint over water-decal
    // lyrics (renderOrder=0) in the transparent pass, regardless of distance sort.
    // THREE.js transparent sorting happens within the same renderOrder bucket only;
    // a higher bucket always renders after a lower one.
    gltfScene.traverse(child => {
      if (child.isMesh) child.renderOrder = 1;
    });

    // Hide any non-light, non-GLTF placeholder children that were attached before
    // the model arrived (defensive — current constructor only adds the lantern).
    this.mesh.children.forEach(child => {
      if (child !== gltfScene && !child.isPointLight) {
        child.visible = false;
      }
    });
  }

  dispose() {
    this.engine.removeUpdatable(this);
    this.engine.scene.remove(this.mesh);
    this.mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.engine.world.removeBody(this.body);
    this.trail.dispose();
    this.engine = null;
  }
}
