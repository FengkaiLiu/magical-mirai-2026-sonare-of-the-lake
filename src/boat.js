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

class ParticleTrail {
  constructor(scene) {
    this.scene = scene;
    this.maxParticles = 150;
    this.particles = [];
    this.poolIndex = 0;

    const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
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
    if (speed < 1.0) return;

    // Spawn 2-3 particles at a time
    const amount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < amount; i++) {
      const p = this.particles[this.poolIndex];
      this.poolIndex = (this.poolIndex + 1) % this.maxParticles;

      p.life = 1.0;
      
      // Start slightly behind boat, at water level
      p.mesh.position.copy(pos);
      p.mesh.position.y = 0.05;
      p.mesh.position.x -= forward.x * 0.4 + (Math.random() - 0.5) * 0.3;
      p.mesh.position.z -= forward.z * 0.4 + (Math.random() - 0.5) * 0.3;
      
      // Burst upwards and slightly outward
      p.vx = -forward.x * 0.3 + (Math.random() - 0.5) * 1.5;
      p.vy = 0.6 + Math.random() * 0.8;
      p.vz = -forward.z * 0.3 + (Math.random() - 0.5) * 1.5;
      
      // Randomize initial scale
      const s = 0.4 + Math.random() * 1.0;
      p.mesh.scale.set(s, s, s);
      p.mesh.material.opacity = 0.8;
    }
  }

  update(dt) {
    for (const p of this.particles) {
      if (p.life > 0) {
        // Physics
        p.vy -= 4.0 * dt; // Gravity
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        
        // Splash down and stop on water
        if (p.mesh.position.y < 0.0) {
          p.mesh.position.y = 0.0;
          p.vy = 0;
          p.vx *= 0.8; // Friction on water
          p.vz *= 0.8;
        }

        // Fade out
        p.life -= dt * 1.2;
        if (p.life < 0) p.life = 0;
        
        p.mesh.material.opacity = p.life * 0.8;
        
        // Shrink slightly as it fades
        const s = p.mesh.scale.x * 0.95;
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

export class Boat {
  constructor(engine, controls) {
    this.engine = engine;
    this.controls = controls;

    // === Cannon-es physics body ===
    const shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.12, 0.6));
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

    const hullMat = new THREE.MeshLambertMaterial({ color: 0xc08040 });

    // Custom V-hull: 5 cross-sections [z, halfWidth, depth]
    const secs = [
      { z: -0.70, hw: 0.000, d: 0.000 }, // 0: bow tip
      { z: -0.35, hw: 0.200, d: 0.200 }, // 1: front
      { z:  0.00, hw: 0.300, d: 0.260 }, // 2: mid (beam)
      { z:  0.35, hw: 0.275, d: 0.220 }, // 3: aft
      { z:  0.65, hw: 0.225, d: 0.160 }, // 4: stern
    ];

    // Build vertex array
    // Vertex layout: bow(0), then per section 1-4: portTop(3i-2), starbTop(3i-1), keel(3i)
    const verts = [];
    verts.push(0, 0, secs[0].z); // index 0: bow tip
    for (let i = 1; i <= 4; i++) {
      const s = secs[i];
      verts.push(-s.hw,   0, s.z); // portTop
      verts.push( s.hw,   0, s.z); // starbTop
      verts.push( 0,   -s.d, s.z); // keel
    }
    // Index map: bow=0, front:[1,2,3], mid:[4,5,6], aft:[7,8,9], stern:[10,11,12]

    // Build index array (CCW winding for outward normals)
    const idx = [];

    // Bow cap (tip → front section)
    idx.push(0, 1, 2);  // deck triangle
    idx.push(0, 3, 1);  // port bow face
    idx.push(0, 2, 3);  // starboard bow face

    // Section pairs: front→mid, mid→aft, aft→stern
    const bases = [1, 4, 7, 10];
    for (let i = 0; i < 3; i++) {
      const pP = bases[i], pS = pP + 1, pK = pP + 2;
      const cP = bases[i + 1], cS = cP + 1, cK = cP + 2;
      idx.push(pP, pK, cP,  cP, pK, cK); // port quad
      idx.push(pS, cS, pK,  cS, cK, pK); // starboard quad
      idx.push(pP, cP, pS,  cP, cS, pS); // deck quad
    }

    // Stern cap
    idx.push(10, 12, 11);

    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(verts), 3)
    );
    hullGeo.setIndex(idx);
    hullGeo.computeVertexNormals();

    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    this.mesh.add(hull);

    // Mast
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x6b5030 })
    );
    mast.position.set(0, 0.55, -0.05);
    this.mesh.add(mast);

    // Sail
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0.55, 0, 0.35, 0.1, 0]), 3)
    );
    sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo, new THREE.MeshLambertMaterial({
      color: 0xeeeedd, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    }));
    sail.position.set(0.02, 0.15, -0.05);
    this.mesh.add(sail);

    // Lantern
    const lantern = new THREE.PointLight(0xffcc55, 0.8, 8);
    lantern.position.set(0, 0.5, -0.4);
    lantern.castShadow = true;
    this.mesh.add(lantern);

    engine.scene.add(this.mesh);

    // === Movement params ===
    this.forwardForce = 25;
    this.turnTorque = 5;

    // === Wake Trail Particles ===
    this.trail = new ParticleTrail(engine.scene);
    this.trailTimer = 0;

    engine.addUpdatable(this);
  }

  /**
   * preStep — 物理演算前: 入力を読んで速度を設定
   */
  preStep(dt, elapsed) {
    const actions = this.controls.actions;

    // 浮力: 弹簧式，把船推向水面 (waterLevel = 0)
    const waterLevel = 0.50;
    const buoyancy = (waterLevel - this.body.position.y) * 30; // 弹簧力
    this.body.velocity.y += buoyancy * dt;
    this.body.velocity.y *= 0.9; // 水的阻尼

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
   */
  update(dt, elapsed) {
    const p = this.body.position;
    const quat = this.body.quaternion;

    // 範囲制限
    p.x = Math.max(-40, Math.min(40, p.x));
    p.z = Math.max(-40, Math.min(40, p.z));

    // Three.js mesh を物理ボディに同期
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);

    // 微かなボブ
    this.mesh.position.y += Math.sin(elapsed * 1.5) * 0.015;

    // Trail update
    this.trail.update(dt);
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
    const p = this.body.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  getSpeed() {
    const v = this.body.velocity;
    return Math.sqrt(v.x * v.x + v.z * v.z);
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
