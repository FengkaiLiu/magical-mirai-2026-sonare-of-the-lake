// src/main.js — TEMPORARY
import { Engine } from './engine.js';
import { Water } from './water.js';
import { Environment } from './environment.js';
import { Boat } from './boat.js';
import { CameraController } from './camera.js';
import { Controls } from './controls.js';

const engine = new Engine(document.getElementById('app'));
const water = new Water(engine);
const env = new Environment(engine);
const controls = new Controls();
const boat = new Boat(engine, controls);
const cam = new CameraController(engine);
engine.addUpdatable({ update: () => cam.setTarget(boat.getPosition()) });
engine.start();
