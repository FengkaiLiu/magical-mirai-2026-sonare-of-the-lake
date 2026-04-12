/**
 * SongSelectScene — 6 floating wooden song cards arranged in a circle.
 */

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Water } from "./water.js";
import { Environment } from "./environment.js";
import { Boat } from "./boat.js";
import { CameraController } from "./camera.js";
import { Controls } from "./controls.js";
import { SONGS } from "./songs.js";

class SongCard {
  constructor(song, index, engine, x, z) {
    this.engine = engine;
    this.songIndex = index;
    this.x = x;
    this.z = z;
    this.baseY = 0.65;
    this.bobOffset = index * ((Math.PI * 2) / SONGS.length);
    this.scattered = false;
    this.scatterVel = new THREE.Vector3();

    // --- Texture Generation ---
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#c09060"; ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = "rgba(70,40,10,0.18)"; ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const gy = 256 * (0.1 + Math.random() * 0.8);
      ctx.beginPath(); ctx.moveTo(0, gy);
      ctx.lineTo(512, gy + (Math.random() - 0.5) * 20); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(50,25,8,0.55)"; ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 240);
    if (index === 0) { ctx.font = "38px serif"; ctx.fillText("🏆", 18, 50); }

    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let fontSize = 46;
    const fontFace = (s) => `bold ${s}px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif`;
    ctx.font = fontFace(fontSize);
    while (ctx.measureText(song.title).width > 450 && fontSize > 20) {
      fontSize -= 2; ctx.font = fontFace(fontSize);
    }
    ctx.fillStyle = "#18080a"; ctx.strokeStyle = "rgba(255,230,180,0.5)";
    ctx.lineWidth = 2; ctx.strokeText(song.title, 256, 115); ctx.fillText(song.title, 256, 115);
    ctx.font = '28px "M PLUS Rounded 1c","Yu Gothic","Hiragino Sans",sans-serif';
    ctx.fillStyle = "#5a3010"; ctx.fillText(song.artist, 256, 182);
    this.texture = new THREE.CanvasTexture(canvas);

    // --- 3D Mesh ---
    const geo = new THREE.BoxGeometry(4.2, 0.15, 2.1);
    const woodSide = new THREE.MeshLambertMaterial({ color: 0x8b6030 });
    const topMat = new THREE.MeshLambertMaterial({ map: this.texture });
    this.mesh = new THREE.Mesh(geo, [woodSide, woodSide, topMat, woodSide, woodSide, woodSide]);
    this.mesh.castShadow = true;
    engine.scene.add(this.mesh);

    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 8);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x6b4020 });
    this.post = new THREE.Mesh(postGeo, postMat);
    engine.scene.add(this.post);

    // --- SWE Refactor: Physics Body ---
    this.body = new CANNON.Body({
      mass: 5, // 给予一定质量，让它可以被推开
      position: new CANNON.Vec3(x, this.baseY, z),
      linearDamping: 0.9,  // 强阻尼，推开后会很快停下
      angularDamping: 0.9,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(2.1, 0.1, 1.05)));
    
    // 关键修复：锁死 Y 轴（不掉落），锁死 X、Z 轴旋转（不翻车）
    this.body.linearFactor.set(1, 0, 1); 
    this.body.angularFactor.set(0, 1, 0); 
    engine.world.addBody(this.body);
  }

  update(dt, elapsed, isHovered) {
    if (this.scattered) {
      this.mesh.position.x += this.scatterVel.x * dt;
      this.mesh.position.z += this.scatterVel.z * dt;
      this.mesh.position.y += this.scatterVel.y * dt;
      this.scatterVel.y -= 9 * dt; 
      this.post.position.copy(this.mesh.position);
      this.post.position.y -= 0.72;
      return;
    }

    // 将物理引擎的位置应用到视觉 Mesh，并加上上下浮动的视觉特效
    this.mesh.position.set(
      this.body.position.x, 
      this.baseY + Math.sin(elapsed * 1.2 + this.bobOffset) * 0.09, 
      this.body.position.z
    );

    // 将物理引擎的转向应用到视觉 Mesh，并保持 60 度的倾斜角
    const euler = new THREE.Euler().setFromQuaternion(this.body.quaternion);
    this.mesh.rotation.set(Math.PI / 3, euler.y, 0, 'YXZ');

    this.post.position.set(this.mesh.position.x, this.mesh.position.y - 0.72, this.mesh.position.z);
  }

  scatter() {
    this.scattered = true;
    this.engine.world.removeBody(this.body);
    const angle = Math.atan2(this.z, this.x); 
    const speed = 9 + Math.random() * 5;
    this.scatterVel.set(Math.cos(angle) * speed, 4 + Math.random() * 4, Math.sin(angle) * speed);
  }

  dispose() {
    const scene = this.engine.scene;
    scene.remove(this.mesh); scene.remove(this.post);
    this.engine.world.removeBody(this.body);
    this.texture.dispose(); this.mesh.geometry.dispose(); this.post.geometry.dispose();
    for (const m of this.mesh.material) if (m && m.dispose) m.dispose();
    this.post.material.dispose();
  }
}

export class SongSelectScene {
  constructor(engine, onSelect) {
    this.engine = engine;
    this.onSelect = onSelect;
    this.cards = [];
    this.selected = false;

    this._updatable = { update: (dt, el) => this._update(dt, el) };

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this._onMouseMove = (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", this._onMouseMove);

    this.water = new Water(engine);
    this.env = new Environment(engine);
    this.engine.env = this.env;
    this.controls = new Controls();
    this.boat = new Boat(engine, this.controls);
    this.cam = new CameraController(engine);

    this._camUpdatable = { update: () => this.cam.setTarget(this.boat.getPosition()) };
    engine.addUpdatable(this._camUpdatable);

    SONGS.forEach((song, i) => {
      const spacing = 5.5;
      const totalWidth = (SONGS.length - 1) * spacing; 
      const x = i * spacing - totalWidth / 2;           
      const z = -14;
      this.cards.push(new SongCard(song, i, engine, x, z));
    });

    document.getElementById("overlay")?.classList.add("hidden");
    const hint = document.getElementById("select-hint");
    if (hint) hint.style.display = "block";

    engine.addUpdatable(this._updatable);
  }

  _update(dt, elapsed) {
    if (this.selected) return;

    this.raycaster.setFromCamera(this.mouse, this.engine.camera);
    const meshes = this.cards.map((c) => c.mesh);
    const hits = this.raycaster.intersectObjects(meshes);
    const hoveredMesh = hits.length > 0 ? hits[0].object : null;

    for (const card of this.cards) {
      card.update(dt, elapsed, card.mesh === hoveredMesh);
    }

    const bp = this.boat.getPosition();
    for (const card of this.cards) {
      const dx = bp.x - card.mesh.position.x;
      const dz = bp.z - card.mesh.position.z;
      // 距离小于 2 时判定选中
      if (Math.sqrt(dx * dx + dz * dz) < 2.0) {
        this._select(card.songIndex);
        return;
      }
    }
  }

  _select(index) {
    this.selected = true;
    for (const card of this.cards) card.scatter();
    setTimeout(() => this.onSelect(index), 200);
  }

  dispose() {
    this.engine.removeUpdatable(this._updatable);
    this.engine.removeUpdatable(this._camUpdatable);
    window.removeEventListener("mousemove", this._onMouseMove);
    this.water.dispose(); this.env.dispose(); this.boat.dispose();
    this.cam.dispose(); this.controls.dispose();
    for (const card of this.cards) card.dispose();

    const hint = document.getElementById("select-hint");
    if (hint) hint.style.display = "none";
  }
}