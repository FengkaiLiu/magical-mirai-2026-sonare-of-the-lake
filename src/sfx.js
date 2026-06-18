const _beach = new Audio('/sfx/stereogenicstudio-beach-02-404144.mp3');
_beach.loop   = true;
_beach.volume = 0.05;

let _active = false;

export function sfxStart() {
  _active = true;
  _beach.play().catch(() => {});
}

export function sfxStop() {
  _active = false;
  _beach.pause();
}

export function sfxResume() {
  _active = true;
  _beach.play().catch(() => {});
}
