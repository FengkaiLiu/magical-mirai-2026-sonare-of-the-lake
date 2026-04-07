// src/main.js — TEMPORARY
import { Engine } from './engine.js';
import { Water } from './water.js';
import { Environment } from './environment.js';

const engine = new Engine(document.getElementById('app'));
const water = new Water(engine);
const env = new Environment(engine);
engine.start();
