# Sonare of the Lake — Magical Mirai 2026 Programming Contest Entry

初音ミク「マジカルミライ 2026」プログラミング・コンテスト 応募作品

> A lyric visualizer where the player sails a Vocaloid boat across a stylized lake.
> Lyrics emerge from the water as schools of luminous particles during verses, then
> coalesce in the sky during choruses. Built for the Hatsune Miku "Magical Mirai
> 2026" Programming Contest.

## Authors

- **Fengkai Liu** — Lead development, 3D modeling (terrain, environment, five of the six character boats), visual design
- **Brian Liu** — Creative direction and coding

### Asset Contributor

- **Haolin Wang** — Modeled the original cube-chibi Hatsune Miku character mesh
  used in `miku-boat.glb` (contributed with explicit permission for use in this
  contest entry). The remaining five character boats (`littleshipRin/Ren/luka/KAITO/MEIKO.glb`)
  are substantially modified derivative works in which Fengkai Liu re-modeled
  the chibi character on top of Haolin's base mesh template.

## Designated Songs

The six designated songs from the Magical Mirai 2026 Song Contest are all selectable:

| Song | Title (Romaji) | Artist |
|------|----------------|--------|
| こたえて | Answer Me | imie (Grand Prize) |
| アフター・ザ・カーテン | After the Curtain | Rulmry |
| シャッターチャンス | Shutter Chance | 夜未アガリ |
| 世界最後の音楽隊 | World's Last Orchestra | 夏山よつぎ × ど〜ぱみん |
| トリツクロジー | Trickology | 鶴三 |
| TAKEOVER | TAKEOVER | Twinfield |

## How to Play

1. The intro screen shows a loading bar (real progress — five staged preloads).
2. Optionally pick a boat (Miku / Rin / Len / Luka / KAITO / MEIKO) and language (JA / EN).
3. Press **Start**. The camera dives from above onto the lake.
4. Sail (**W A S D** or arrow keys; touch joystick on mobile) into one of the six
   glowing particle circles to begin that song.
5. During verses, lyric phrases form as schools of particles on the water surface;
   during choruses the camera lifts and lyrics converge in the sky.
6. After the song ends, sail through the closing circle to return to song selection.

## Tech Stack

| Library | Purpose |
|---------|---------|
| [TextAlive App API](https://developer.textalive.jp/) | Lyric / beat / chord timing |
| [Three.js](https://threejs.org/) (r172) | WebGL 3D rendering |
| [Cannon-es](https://github.com/pmndrs/cannon-es) | Boat / water buoyancy physics |
| [Troika Three Text](https://github.com/protectwise/troika) | Crisp SDF text rendering |
| [GSAP](https://gsap.com/) | UI / camera tweens |
| [Vite](https://vitejs.dev/) | Build & dev server |

## Project Structure

```
├── src/                    # All application code
│   ├── index.html
│   ├── main.js             # Bootstrap, loading bar, intro/menu UI
│   ├── game-scene.js       # State machine: select → play → ending
│   ├── engine.js           # Three.js + Cannon-es render/physics loop
│   ├── water.js            # Stylized low-poly lake shader
│   ├── water-objects.js    # Floating planks & musical notes
│   ├── boat.js             # Player boat, controls binding, wake trail
│   ├── camera.js           # Cinematic chase + dive + sky cameras
│   ├── controls.js         # Keyboard + touch joystick input
│   ├── environment.js      # Sky, sun, clouds, corals, ambient particles
│   ├── lyric-manager.js    # Sky-mode lyric particles (chorus)
│   ├── fish-school.js      # Particle-formation primitive
│   ├── fish-lyric-system.js# Verse-mode lyric particle scheduler
│   ├── song-circles.js     # Six glowing song-selection portals
│   ├── return-circle.js    # End-of-song "return" ring
│   ├── menu-return-circle.js # Back-to-title ring
│   ├── wasd-hint.js        # First-time control hint particles
│   ├── lyric-gate.js       # Generic phrase-detection helper
│   ├── asset-cache.js      # Singleton GLTFLoader + DRACOLoader
│   ├── songs.js            # Designated-song metadata + theme palettes
│   ├── i18n.js             # JA / EN strings + boat catalogue
│   ├── device.js           # Touch-device detection
│   └── style.css
├── public/
│   ├── models/             # All .glb assets (see Assets section)
│   └── draco/              # Bundled DRACO decoder (locally hosted, no CDN)
├── fonts/                  # Source font files (subsetted at build prep time)
├── scripts/
│   └── subset-fonts.mjs    # KiwiMaru subsetter (run via npm run subset-fonts)
├── vite.config.js
└── package.json
```

## Development

```bash
npm install            # Install all dependencies
npm run dev            # Start Vite dev server (auto-opens browser)
npm run build          # Production build to ./dist
npm run preview        # Preview built bundle locally
npm run compress-terrain # Re-Draco-compress public/models/terrain.glb after re-export
npm run subset-fonts   # Re-subset KiwiMaru-*.full.ttf → KiwiMaru-*.ttf
```

## Asset Provenance

All visual assets are original works created by the authors or by the asset
contributor named below, used with explicit permission. All open-source
resources are used under their original licenses. **No generative AI was used
for any music, image, illustration, or text shown in the output of the
program.** AI assistance was limited to code authoring (per the contest's
explicit allowance).

### 3D Models — hand-modeled in Blender

| File | Subject | Modeled by | Tool |
|------|---------|------------|------|
| `public/models/terrain.glb` | Low-poly lake island, corals, trees, rocks | Fengkai Liu | Blender |
| `public/models/miku-boat.glb` | Cube-chibi Miku riding a small boat | Haolin Wang (Miku chibi mesh, contributed with permission); Fengkai Liu (boat hull, scene assembly, export) | Blender |
| `public/models/littleshipRin.glb` | Cube-chibi Rin on boat | Fengkai Liu (derivative work re-modeled from Haolin Wang's base mesh, with permission) | Blender |
| `public/models/littleshipRen.glb` | Cube-chibi Len on boat | Fengkai Liu (derivative work re-modeled from Haolin Wang's base mesh, with permission) | Blender |
| `public/models/littleshipluka.glb` | Cube-chibi Luka on boat | Fengkai Liu (derivative work re-modeled from Haolin Wang's base mesh, with permission) | Blender |
| `public/models/littleshipKAITO.glb` | Cube-chibi KAITO on boat | Fengkai Liu (derivative work re-modeled from Haolin Wang's base mesh, with permission) | Blender |
| `public/models/littleshipMEIKO.glb` | Cube-chibi MEIKO on boat | Fengkai Liu (derivative work re-modeled from Haolin Wang's base mesh, with permission) | Blender |
| `public/models/musicnote.glb` | Floating musical-note pickup | Fengkai Liu | Blender |
| `public/models/planks.glb` | Floating wooden plank lyric carriers | Fengkai Liu | Blender |

All six Piapro Characters (Miku, Rin, Len, Luka, MEIKO, KAITO) are used in
accordance with the [Piapro Character License](https://piapro.net/intl/en_for_creators.html).
No official Magical Mirai 2026 logos or key visuals are used in any asset.

### Fonts

| Font | License | Source |
|------|---------|--------|
| Caveat (Bold, Regular) | [SIL Open Font License 1.1](https://openfontlicense.org/) | [Google Fonts](https://fonts.google.com/specimen/Caveat) |
| Kiwi Maru (Regular, Light) | [SIL Open Font License 1.1](https://openfontlicense.org/) | [Google Fonts](https://fonts.google.com/specimen/Kiwi+Maru) |

Kiwi Maru is locally subsetted (`npm run subset-fonts`) down to Jōyō + Jinmeiyō
kanji + common-frequency kanji + kana to reduce download size by ~54% while
keeping coverage for all designated-song lyrics.

### Audio

Song audio is streamed at runtime from the official Piapro URLs published with
each designated song; no audio files are bundled in this repository. No custom
sound effects are added on top of the music.

## Notes for Reviewers

- **No AI-generated assets.** Per contest rules, generative AI was not used to
  produce any music, image, illustration, or text output by the program. AI was
  used only for code-writing assistance (which the rules permit).
- **No obfuscation.** All source is plain ES modules, written for readability
  with comments documenting non-obvious decisions.
- **TextAlive token.** The token `xTTinPuYYoHYLhnk` in `src/game-scene.js:135`
  is a **public client-side application token** issued for this app per the
  [TextAlive App API documentation](https://developer.textalive.jp/). It
  identifies the app to the API and carries no privileged scope, so committing
  it to source is the documented pattern. It is not a secret.
- **Tested on:** Windows 10/11 (Chrome, Edge, Firefox), iPadOS Safari (landscape
  and portrait).
- **Mobile:** A virtual joystick replaces WASD on touch devices (detected via
  `(pointer: coarse)` media query).

## References

The following resources informed the *design direction* (not the assets
themselves — all 3D content was modeled by the author from scratch):

- [Bruno Simon — 2019 Portfolio](https://2019.bruno-simon.com/) — overall scene
  composition and Engine/Updatable architecture inspiration.
- [Low Poly World in Blender — Easy and Fun (YouTube)](https://youtu.be/dlWwyolJ4OM)
  — stylistic inspiration for the low-poly aesthetic.
- [Cube Miku Chibi (Bilibili)](https://www.bilibili.com/video/BV1Yi4y1Q7FL/)
  — inspired the cube-style chibi character silhouette; all boat models were
  independently modeled in Blender, no assets were copied from the reference.

## License

The source code in this repository is provided for review under the Magical
Mirai 2026 Programming Contest. Code, original 3D models, and original artwork
in this repository © 2026 Fengkai Liu and Brian Liu, all rights reserved. The
cube-chibi Hatsune Miku base mesh is © Haolin Wang, used here with explicit
permission for the contest submission.

Third-party libraries retain their original licenses (see `package.json` and
each project's homepage linked above).
