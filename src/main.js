// src/main.js — TEMPORARY
import { Engine } from './engine.js';
import { Water } from './water.js';
import { Environment } from './environment.js';
import { Boat } from './boat.js';
import { CameraController } from './camera.js';
import { Controls } from './controls.js';
import { LyricManager } from './lyric-manager.js';

const engine = new Engine(document.getElementById('app'));
const water = new Water(engine);
const env = new Environment(engine);
const controls = new Controls();
const boat = new Boat(engine, controls);
const cam = new CameraController(engine);
engine.addUpdatable({ update: () => cam.setTarget(boat.getPosition()) });

// Use first song's particle color
const lyrics = new LyricManager(engine, boat, 0xfff8d0);

// Fire test phrases on interval
let phrases = ['こたえて', '風が吹いた', '星が見える', '湖に映る', '答えを探して'];
let idx = 0;
setInterval(() => {
  lyrics.addPhrase(phrases[idx % phrases.length]);
  idx++;
}, 2000);

engine.start();
