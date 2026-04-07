// src/main.js — TEMPORARY
import { Engine } from './engine.js';
import { SongSelectScene } from './song-select.js';

const engine = new Engine(document.getElementById('app'));

const select = new SongSelectScene(engine, (idx) => {
  console.log('Selected song:', idx);
});

engine.start();
