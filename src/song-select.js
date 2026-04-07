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

// ── Song Card ────────────────────────────────────────────────────────────────

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
    this.mesh.position.set(x, this.baseY, z);
    this.mesh.lookAt(0, this.baseY, 0); // face lake center
    this.mesh.castShadow = true;
    engine.scene.add(this.mesh);

    // Glow border mesh (slightly larger, BackSide, toggled by hover)
    const glowGeo = new THREE.BoxGeometry(4.5, 0.18, 2.4);
    this.glowMesh = new THREE.Mesh(
      glowGeo,
      new THREE.MeshBasicMaterial({ color: 0xffe880, transparent: true, opacity: 0, side: THREE.BackSide })
    );
    this.glowMesh.position.copy(this.mesh.position);
    this.glowMesh.rotation.copy(this.mesh.rotation);
    engine.scene.add(this.glowMesh);

    // Support post
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 8);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x6b4020 });
    this.post = new THREE.Mesh(postGeo, postMat);
    this.post.position.set(x, 0.05, z);
    engine.scene.add(this.post);
  }

  update(dt, elapsed, isHovered) {
    if (this.scattered) {
      this.mesh.position.x += this.scatterVel.x * dt;
      this.mesh.position.z += this.scatterVel.z * dt;
      this.mesh.position.y += this.scatterVel.y * dt;
      this.scatterVel.y -= 9 * dt; // gravity pull
      this.glowMesh.position.copy(this.mesh.position);
      this.glowMesh.rotation.copy(this.mesh.rotation);
      return;
    }

    // Gentle bob
    this.mesh.position.y = this.baseY + Math.sin(elapsed * 1.2 + this.bobOffset) * 0.09;

    // Hover glow lerp
    const targetOpacity = isHovered ? 0.35 : 0;
    this.glowMesh.material.opacity += (targetOpacity - this.glowMesh.material.opacity) * 0.08;
    this.glowMesh.position.copy(this.mesh.position);
    this.glowMesh.rotation.copy(this.mesh.rotation);
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
    scene.remove(this.glowMesh);
    scene.remove(this.post);
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.glowMesh.geometry.dispose();
    this.post.geometry.dispose();
    for (const m of this.mesh.material) if (m && m.dispose) m.dispose();
    this.glowMesh.material.dispose();
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
    this.controls = new Controls();
    this.boat = new Boat(engine, this.controls);
    this.cam = new CameraController(engine);

    this._camUpdatable = { update: () => this.cam.setTarget(this.boat.getPosition()) };
    engine.addUpdatable(this._camUpdatable);

    // 6 cards in a circle, radius 18, starting at top (-Z axis)
    SONGS.forEach((song, i) => {
      const angle = (i / SONGS.length) * Math.PI * 2 - Math.PI / 2;
      const r = 18;
      this.cards.push(new SongCard(song, i, engine, Math.cos(angle) * r, Math.sin(angle) * r));
    });

    // Show hint
    const hint = document.getElementById("select-hint");
    if (hint) hint.style.display = "block";

    engine.addUpdatable(this._updatable);
  }

  _update(dt, elapsed) {
    if (this.selected) return;

    // Hover detection via raycasting
    this.raycaster.setFromCamera(this.mouse, this.engine.camera);
    const meshes = this.cards.map((c) => c.mesh);
    const hits = this.raycaster.intersectObjects(meshes);
    const hoveredMesh = hits.length > 0 ? hits[0].object : null;

    for (const card of this.cards) {
      card.update(dt, elapsed, card.mesh === hoveredMesh);
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
    setTimeout(() => this.onSelect(index), 600);
  }

  dispose() {
    this.engine.removeUpdatable(this._updatable);
    this.engine.removeUpdatable(this._camUpdatable);
    window.removeEventListener("mousemove", this._onMouseMove);

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
