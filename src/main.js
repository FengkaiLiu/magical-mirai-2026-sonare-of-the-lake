/**
 * main.js — State machine: STATE_SELECT → STATE_PLAY
 *
 * Boots SongSelectScene. When player sails into a song card,
 * fades to black, tears down select scene, boots LakeScene.
 */

import { Engine } from "./engine.js";
import { SongSelectScene } from "./song-select.js";
import { LakeScene } from "./lake-scene.js";

const engine = new Engine(document.getElementById("app"));

let currentScene = null;
const transitionOverlay = document.getElementById("transition-overlay");

function startSelect() {
  currentScene = new SongSelectScene(engine, onSongSelected);
}

function onSongSelected(songIndex) {
  // Fade to black
  transitionOverlay.classList.add("visible");

  setTimeout(() => {
    // Tear down select scene
    currentScene.dispose();
    currentScene = null;

    // Boot lake scene
    startPlay(songIndex);

    // Fade back in
    transitionOverlay.classList.remove("visible");
  }, 500);
}

function startPlay(songIndex) {
  currentScene = new LakeScene(engine, songIndex);

  const pauseBtn = document.getElementById("pause-btn");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      if (currentScene) currentScene.togglePause();
    });
  }
}

startSelect();
engine.start();
