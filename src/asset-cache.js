/**
 * asset-cache.js — Singleton GLTF loader with parse-level cache.
 *
 * All GLTFLoader calls share one loader instance so Three.js FileLoader
 * cache (THREE.Cache) is populated once; subsequent loads of the same URL
 * skip the network round-trip entirely.
 *
 * loadIcon(url) additionally converts every mesh's material to a
 * MeshPhysicalMaterial tuned for glass (transmission + thickness).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

THREE.Cache.enabled = true; // shared HTTP response cache across all FileLoader calls

const _loader   = new GLTFLoader();
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

/**
 * loadIcon(url) — Load a GLB and convert all mesh materials to
 * MeshPhysicalMaterial with glass properties (transmission, thickness, ior).
 *
 * Returns a cloned scene root so each caller gets its own object hierarchy
 * with independent material instances.
 */
export async function loadIcon(url) {
  const gltf = await preloadGLTF(url);
  const root = gltf.scene.clone(true);

  root.traverse(child => {
    if (!child.isMesh) return;
    const old = child.material;

    child.material = new THREE.MeshPhysicalMaterial({
      // Preserve authored colour / texture
      color:           old.color?.clone()  ?? new THREE.Color(1, 1, 1),
      map:             old.map             ?? null,
      normalMap:       old.normalMap       ?? null,
      emissive:        old.emissive?.clone() ?? new THREE.Color(0, 0, 0),
      emissiveMap:     old.emissiveMap     ?? null,

      // Glass
      transmission:    0.95,   // how much light passes through
      thickness:       0.5,    // IOR-based refraction depth (world units)
      ior:             1.52,   // soda-lime glass refractive index
      roughness:       0.04,
      metalness:       0.0,
      transparent:     true,
      envMapIntensity: 1.5,
      side:            THREE.FrontSide,
    });
  });

  return root;
}
