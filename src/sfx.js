const _beach = new Audio('/sfx/stereogenicstudio-beach-02-404144.mp3');
_beach.loop   = true;
_beach.volume = 0.25;

export function sfxStart()  { _beach.play().catch(() => {}); }
export function sfxStop()   { _beach.pause(); }
export function sfxResume() { _beach.play().catch(() => {}); }
