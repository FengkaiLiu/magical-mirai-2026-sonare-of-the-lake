/**
 * ==========================================
 * Magical Mirai 2026 Programming Contest
 * Lyric App Entry
 * ==========================================
 *
 * 使用 TextAlive App API 实现歌词与音乐的同步动画
 * Uses TextAlive App API for lyrics-music synchronized animation.
 *
 * TextAlive App API: https://developer.textalive.jp/
 */

import { Player } from "textalive-app-api";

// ==========================================
// 全6曲の定義 (All 6 designated songs)
// ==========================================
const SONGS = [
  {
    title: "こたえて (Answer Me)",
    artist: "imie",
    url: "https://piapro.jp/t/6W2N/20251215164617",
    options: {
      video: {
        beatId: 4827293,
        chordId: 2963754,
        repetitiveSegmentId: 3086261,
        lyricId: 126519,
        lyricDiffId: 28645,
      },
    },
  },
  {
    title: "アフター・ザ・カーテン (After The Curtain)",
    artist: "Rulmry",
    url: "https://piapro.jp/t/zoqO/20251214200738",
    options: {
      video: {
        beatId: 4827294,
        chordId: 2963755,
        repetitiveSegmentId: 3086262,
        lyricId: 126591,
        lyricDiffId: 28627,
      },
    },
  },
  {
    title: "シャッターチャンス (Shutter Chance)",
    artist: "夜未アガリ (Yamiagari)",
    url: "https://piapro.jp/t/PNpQ/20251209170719",
    options: {
      video: {
        beatId: 4827295,
        chordId: 2963756,
        repetitiveSegmentId: 3086263,
        lyricId: 126542,
        lyricDiffId: 28628,
      },
    },
  },
  {
    title: "世界最後の音楽隊 (The Last March on Earth)",
    artist: "夏山よつぎ × ど～ぱみん",
    url: "https://piapro.jp/t/B3yJ/20251215061727",
    options: {
      video: {
        beatId: 4827296,
        chordId: 2963757,
        repetitiveSegmentId: 3086264,
        lyricId: 126594,
        lyricDiffId: 28629,
      },
    },
  },
  {
    title: "トリツクロジー (Toritsukulogy)",
    artist: "鶴三 (Tsuruzou)",
    url: "https://piapro.jp/t/QBdL/20251215094303",
    options: {
      video: {
        beatId: 4827297,
        chordId: 2963758,
        repetitiveSegmentId: 3086265,
        lyricId: 126593,
        lyricDiffId: 28630,
      },
    },
  },
  {
    title: "TAKEOVER",
    artist: "Twinfield",
    url: "https://piapro.jp/t/E2i3/20251215092113",
    options: {
      video: {
        beatId: 4827298,
        chordId: 2963759,
        repetitiveSegmentId: 3086266,
        lyricId: 126533,
        lyricDiffId: 28631,
      },
    },
  },
];

// ==========================================
// DOM Elements
// ==========================================
const overlay = document.getElementById("overlay");
const playBtn = document.getElementById("play-btn");
const pauseBtn = document.getElementById("pause-btn");
const lyricText = document.getElementById("lyric-text");
const timeDisplay = document.getElementById("time-display");
const songSelect = document.getElementById("song-select");
const songTitle = document.getElementById("song-title");

// ==========================================
// 从 URL 参数读取歌曲索引
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const songIndex = Number(urlParams.get("song") || 0);

// 同步下拉菜单选中状态
if (songSelect) {
  songSelect.value = songIndex;
}

// ==========================================
// TextAlive Player Setup
// ==========================================
const player = new Player({
  app: {
    token: "xTTinPuYYoHYLhnk",
  },
  mediaElement: document.createElement("audio"),
});

// ==========================================
// Player Event Listeners
// ==========================================
player.addListener({
  onAppReady: (app) => {
    console.log("[TextAlive] App is ready");

    if (!app.managed) {
      const song = SONGS[songIndex];
      console.log(`[Song] Loading: ${song.title} / ${song.artist}`);

      if (songTitle) {
        songTitle.textContent = `${song.title} / ${song.artist}`;
      }

      player.createFromSongUrl(song.url, song.options);
    }
  },

  onVideoReady: (video) => {
    console.log("[TextAlive] Video ready");

    let phrase = player.video.firstPhrase;
    while (phrase) {
      console.log("[Phrase]", phrase.text);
      phrase = phrase.next;
    }

    playBtn.disabled = false;
    playBtn.textContent = "▶ Play";
  },

  onTimerReady: () => {
    console.log("[TextAlive] Timer ready");
  },

  onTimeUpdate: (position) => {
    updateTimeDisplay(position);

    const phrase = player.video.findPhrase(position);

    if (phrase) {
      lyricText.textContent = phrase.text;
    } else {
      lyricText.textContent = "";
    }
  },

  onPlay: () => {
    overlay.classList.add("hidden");
    pauseBtn.textContent = "⏸";
  },

  onPause: () => {
    pauseBtn.textContent = "▶";
  },
});

// ==========================================
// UI Controls
// ==========================================

playBtn.addEventListener("click", () => {
  if (!player.video) return;
  if (player.isPlaying) {
    player.requestPause();
  } else {
    player.requestPlay();
  }
});

pauseBtn.addEventListener("click", () => {
  if (player.isPlaying) {
    player.requestPause();
  } else {
    player.requestPlay();
  }
});

// 歌曲切换 (通过 URL 参数切换，重新加载页面)
if (songSelect) {
  songSelect.addEventListener("change", (e) => {
    window.location.search = `?song=${e.target.value}`;
  });
}

// ==========================================
// Utility Functions
// ==========================================

function updateTimeDisplay(position) {
  const current = formatTime(position);
  const total = formatTime(player.video?.duration || 0);
  timeDisplay.textContent = `${current} / ${total}`;
}

function formatTime(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}