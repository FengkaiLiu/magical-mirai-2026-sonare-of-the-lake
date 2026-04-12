/**
 * ==========================================
 * Boat — Cannon-es 物理ボート
 * ==========================================
 * Controls の actions を読んで動く。
 * キーボード入力は Controls が管理。
 * Three.js の Mesh は物理ボディに同期。
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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

    // Spawn in pairs (Left and Right)
    for (const side of [-1, 1]) {
      const p = this.particles[this.poolIndex];
      this.poolIndex = (this.poolIndex + 1) % this.maxParticles;

      p.life = 1.0;
      
      const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;
      const wh = waveHeight(pos.x, pos.z, 0, energy);

      // Distinct spawn points at the rear quarters of the hull
      const sideOffset = side * 0.6; // Wider spawn to prevent lines crossing
      const backOffset = 0.6;
      
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
        // Drift
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.z += p.vz * dt;
        
        // Stick to the waves!
        const wh = waveHeight(p.mesh.position.x, p.mesh.position.z, elapsed, energy);
        p.mesh.position.y = wh + 0.02;

        // Fade out
        p.life -= dt * 1.0;
        if (p.life < 0) p.life = 0;
        
        p.mesh.material.opacity = p.life * 0.7;
        
        // Shrink slightly as it fades
        const s = p.mesh.scale.x * 0.98;
        p.mesh.scale.set(s, s, s);
      }
    }
  }

  dispose() {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
      p.mesh.geometry.dispose();
    }
  }
}

function waveHeight(x, z, t, energy = 0) {
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
    const shape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
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

    /* --- Original Boat Geometry (Commented out) ---
    const hullMat = new THREE.MeshLambertMaterial({ color: 0xc08040 });

    const secs = [
      { z: -0.70, hw: 0.000, d: 0.000 },
      { z: -0.35, hw: 0.200, d: 0.200 },
      { z: 0.00, hw: 0.300, d: 0.260 },
      { z: 0.35, hw: 0.275, d: 0.220 },
      { z: 0.65, hw: 0.225, d: 0.160 },
    ];
    const verts = [];
    verts.push(0, 0, secs[0].z);
    for (let i = 1; i <= 4; i++) {
      const s = secs[i];
      verts.push(-s.hw, 0, s.z);
      verts.push(s.hw, 0, s.z);
      verts.push(0, -s.d, s.z);
    }
    const idx = [];
    idx.push(0, 1, 2);
    idx.push(0, 3, 1);
    idx.push(0, 2, 3);
    const bases = [1, 4, 7, 10];
    for (let i = 0; i < 3; i++) {
      const pP = bases[i], pS = pP + 1, pK = pP + 2;
      const cP = bases[i + 1], cS = cP + 1, cK = cP + 2;
      idx.push(pP, pK, cP, cP, pK, cK);
      idx.push(pS, cS, pK, cS, cK, pK);
      idx.push(pP, cP, pS, cP, cS, pS);
    }
    idx.push(10, 12, 11);
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
    hullGeo.setIndex(idx);
    hullGeo.computeVertexNormals();
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    this.mesh.add(hull);

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x6b5030 })
    );
    mast.position.set(0, 0.55, -0.05);
    this.mesh.add(mast);

    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0.55, 0, 0.35, 0.1, 0]), 3));
    sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo, new THREE.MeshLambertMaterial({
      color: 0xeeeedd, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    }));
    sail.position.set(0.02, 0.15, -0.05);
    this.mesh.add(sail);
    --- End Original Geometry --- */

    // Load Miku Boat (GLTF Model)
    const loader = new GLTFLoader();
    // Path relative to public root
    loader.load("models/miku-boat.glb", (gltf) => {
      this.setModel(gltf.scene, { offsetZ: 0.3 });
    }, undefined, (err) => {
      console.error("Failed to load miku-boat.glb", err);
    });

    // Lantern remains (for glow + pulse)
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
   * preStep — 物理演算前: 入力を読んで速度を設定
   */
  preStep(dt, elapsed) {
    const actions = this.controls.actions;
    const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;

    // 浮力: 弹簧式，把船推向水面 (waterLevel is now dynamic based on waves)
    const wh = waveHeight(this.body.position.x, this.body.position.z, elapsed, energy);
    const waterLevel = wh + 0.15; // Offset to keep hull above
    const buoyancy = (waterLevel - this.body.position.y) * 40; 
    this.body.velocity.y += buoyancy * dt;
    this.body.velocity.y *= 0.9; // 水の阻尼

    // 船の向き
    const quat = this.body.quaternion;
    const forward = new CANNON.Vec3(0, 0, -1);
    quat.vmult(forward, forward);
    forward.y = 0;
    forward.normalize();

    const vel = this.body.velocity;

    if (actions.forward) {
      vel.x += forward.x * this.forwardForce * dt;
      vel.z += forward.z * this.forwardForce * dt;
    }
    if (actions.backward) {
      vel.x -= forward.x * this.forwardForce * 0.3 * dt;
      vel.z -= forward.z * this.forwardForce * 0.3 * dt;
    }

    if (actions.left) {
      this.body.angularVelocity.y += this.turnTorque * dt;
    }
    if (actions.right) {
      this.body.angularVelocity.y -= this.turnTorque * dt;
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

    // 転覆防止 (X/Z回転を抑制するが完全にはロックしない)
    this.body.angularVelocity.x *= 0.85;
    this.body.angularVelocity.z *= 0.85;
  }

  /**
   * update — 物理演算後: メッシュ同期 + 範囲制限
   * alpha: interpolation factor [0,1) between previous and current physics state
   */
  update(dt, elapsed, alpha = 1) {
    const p = this.body.position;
    const quat = this.body.quaternion;

    // 範囲制限 (applied to physics body)
    p.x = Math.max(-40, Math.min(40, p.x));
    p.z = Math.max(-40, Math.min(40, p.z));

    // Interpolate position between previous and current physics state
    const ix = this._prevPos.x + (p.x - this._prevPos.x) * alpha;
    const iy = this._prevPos.y + (p.y - this._prevPos.y) * alpha;
    const iz = this._prevPos.z + (p.z - this._prevPos.z) * alpha;

    const energy = (this.engine.env && this.engine.env.smoothedEnergy) || 0;
    const wh = waveHeight(ix, iz, elapsed, energy);
    const finalY = Math.max(iy, wh + 0.05);

    this.mesh.position.set(ix, finalY, iz);

    // Slerp quaternion between previous and current
    const iq = new CANNON.Quaternion();
    this._prevQuat.slerp(quat, alpha, iq);
    this.mesh.quaternion.set(iq.x, iq.y, iq.z, iq.w);

    // 微かなボブ
    this.mesh.position.y += Math.sin(elapsed * 1.5) * 0.015;

    // Trail update
    this.trail.update(dt, elapsed);
    this.trailTimer += dt;
    if (this.trailTimer > 0.02) {
      this.trailTimer = 0;

      const v = this.body.velocity;
      const speed = Math.sqrt(v.x * v.x + v.z * v.z);

      const forward = new CANNON.Vec3(0, 0, -1);
      quat.vmult(forward, forward);
      forward.y = 0;
      forward.normalize();

      this.trail.spawn(this.mesh.position, forward, speed);
    }
  }

  getPosition() {
    // Return interpolated mesh position so the camera follows smoothly
    return this.mesh.position.clone();
  }

  getSpeed() {
    const v = this.body.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z);
  }

  /**
   * Replaces current placeholder geometry with a GLTF model.
   * Handles scale, orientation, and visibility toggling.
   */
  setModel(gltfScene, { scale = 0.3, rotationY = Math.PI} = {}) {
    this._model = gltfScene;
    gltfScene.scale.setScalar(scale);
    gltfScene.rotation.y = rotationY;
    gltfScene.position.set(0, 0, 2.2);
    this.mesh.add(gltfScene);

    // If there were primitive children (original boat), hide them
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
