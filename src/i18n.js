/**
 * i18n.js — Language state, boat catalogue, and UI string lookup.
 *
 * Preferences are persisted to localStorage under "sotl_lang" and "sotl_boat".
 * Consumers call t(key) for translated strings and onLangChange(fn) to react
 * to language switches.
 *
 * NOTE: The `enterStart` and `enterReturn` values embed raw <kbd> HTML and
 * must be set via `element.innerHTML = t(...)`. Using `textContent` would
 * render the markup literally. Every other key is plain text and safe for
 * `textContent`.
 */

export const BOATS = [
  { id: "miku",  ja: "初音ミク",  en: "Miku",  glb: "models/miku-boat.glb"  },
  { id: "rin",   ja: "鏡音リン",  en: "Rin",   glb: "models/littleshipRin.glb",   fallback: "models/miku-boat.glb" },
  { id: "len",   ja: "鏡音レン",  en: "Len",   glb: "models/littleshipLen.glb",   fallback: "models/miku-boat.glb" },
  { id: "luka",  ja: "巡音ルカ",  en: "Luka",  glb: "models/littleshipluka.glb",  fallback: "models/miku-boat.glb" },
  { id: "kaito", ja: "KAITO",     en: "KAITO", glb: "models/littleshipKAITO.glb", fallback: "models/miku-boat.glb" },
  { id: "meiko", ja: "MEIKO",     en: "MEIKO", glb: "models/littleshipMEIKO.glb", fallback: "models/miku-boat.glb" },
];

export const BOAT_COLORS = {
  miku:  "#39c5bb",
  rin:   "#ff9900",
  len:   "#ffd700",
  luka:  "#f4a0b5",
  kaito: "#3d65e0",
  meiko: "#e0341b",
};

const STRINGS = {
  ja: {
    logoTitle:      "旋律への航海",
    subTitle:       "湖のソナーレ",
    startBtn:       "スタート",
    boatBtn:        "ボート",
    settingBtn:     "設定",
    boatModalTitle: "ボート選択",
    settingTitle:   "設定",
    langLabel:      "言語",
    closeBtn:       "閉じる",
    selectHint:     "曲のサークルに入って出航！",
    controlsHint:   "W A S D で航行",
    overlayText:    "読み込み中...",
    overlayStuck:   "読み込みに時間がかかっています。ページを更新してください（F5）。",
    enterStart:     `<kbd>&#9166; Enter</kbd> でスタート`,
    enterReturn:    `<kbd>&#9166; Enter</kbd> で戻る`,
    returnToSelect: "曲選択へ戻る",
    menuReturn:     "← タイトル",
  },
  en: {
    logoTitle:      "Voyage to Melody",
    subTitle:       "Sonare of the Lake",
    startBtn:       "Start",
    boatBtn:        "Boat",
    settingBtn:     "Settings",
    boatModalTitle: "Select Boat",
    settingTitle:   "Settings",
    langLabel:      "Language",
    closeBtn:       "Close",
    selectHint:     "Sail into a song to begin",
    controlsHint:   "W A S D to sail",
    overlayText:    "Loading...",
    overlayStuck:   "Taking too long? Please refresh the page (F5).",
    enterStart:     `Press <kbd>&#9166; Enter</kbd> to start`,
    enterReturn:    `Press <kbd>&#9166; Enter</kbd> to return`,
    returnToSelect: "Back to Songs",
    menuReturn:     "← Menu",
  },
};

let _lang   = localStorage.getItem("sotl_lang")  || "en";
let _boatId = localStorage.getItem("sotl_boat") || "miku";

// Sync HTML lang attribute immediately so CSS [lang="ja"] selectors work on reload
document.documentElement.lang = _lang === "ja" ? "ja" : "en";
const _listeners = new Set();

export function getLang()   { return _lang; }
export function getBoatId() { return _boatId; }
export function getBoat()   { return BOATS.find(b => b.id === _boatId) ?? BOATS[0]; }

export function setLang(l) {
  _lang = l;
  localStorage.setItem("sotl_lang", l);
  document.documentElement.lang = l === "ja" ? "ja" : "en";
  for (const fn of _listeners) fn(l);
}

export function setBoatId(id) {
  _boatId = id;
  localStorage.setItem("sotl_boat", id);
}

export function onLangChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function t(key) {
  return STRINGS[_lang]?.[key] ?? STRINGS.en[key] ?? key;
}
