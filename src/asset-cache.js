/**
 * asset-cache.js — Singleton GLTF loader with parse-level cache.
 *
 * All GLTFLoader calls share one loader instance so Three.js FileLoader
 * cache (THREE.Cache) is populated once; subsequent loads of the same URL
 * skip the network round-trip entirely.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

THREE.Cache.enabled = true; // shared HTTP response cache across all FileLoader calls

// DRACO decoder is bundled locally under public/draco/ so the app stays
// fully self-contained (no runtime fetch to a third-party CDN). Required for
// terrain.glb, which is Draco-compressed via `npm run compress-terrain`.
const _draco = new DRACOLoader();
_draco.setDecoderPath("draco/");

const _loader = new GLTFLoader().setDRACOLoader(_draco);
const _promises = new Map(); // url → Promise<GLTF>

/** Load and parse a GLB/GLTF once; return the same Promise on repeat calls. */
export function preloadGLTF(url) {
  if (!_promises.has(url)) {
    _promises.set(url, new Promise((resolve, reject) => {
      _loader.load(url, resolve, undefined, reject);
    }));
  }
  return _promises.get(url);
}

/** Fire-and-forget preload for a list of URLs. */
export function preloadAll(urls) {
  return Promise.all(urls.map(preloadGLTF));
}
