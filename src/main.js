// src/main.js — TEMPORARY, will be replaced in Task 8
import { Engine } from './engine.js';
import { Water } from './water.js';

const engine = new Engine(document.getElementById('app'));
const water = new Water(engine);
engine.start();
