/**
 * ==========================================
 * Magical Mirai 2026 Programming Contest
 * Lyric App Entry
 * ==========================================
 *
 * 使用 TextAlive App API 实现歌词与音乐的同步动画。
 * Uses TextAlive App API for lyrics-music synchronized animation.
 *
 * TextAlive App API: https://developer.textalive.jp/
 */

import { Player } from "textalive-app-api";

// ==========================================
// DOM Elements
// ==========================================
const overlay = document.getElementById("overlay");
const playBtn = document.getElementById("play-btn");
const pauseBtn = document.getElementById("pause-btn");
const lyricText = document.getElementById("lyric-text");
const timeDisplay = document.getElementById("time-display");

// ==========================================
// TextAlive Player Setup
// ==========================================

/**
 * 初始化 TextAlive Player
 *
 * app.token: 在 TextAlive 开发者页面注册获得
 *   https://developer.textalive.jp/
 *
 * 指定歌曲列表 (2026 Magical Mirai Song Contest):
 *   - Answer Me (imie):               https://piapro.jp/t/6W2N
 *   - After The Curtain (Rulmry):      https://piapro.jp/t/zoqO
 *   - Shutter Chance (Yamiagari):      https://piapro.jp/t/PNpQ
 *   - The Last March on Earth:         https://piapro.jp/t/B3yJ
 *   - Toritsukulogy (Tsuruzou):        https://piapro.jp/t/QBdL
 *   - TAKEOVER (Twinfield):            https://piapro.jp/t/E2i3
 */
const player = new Player({
  app: {
    // TODO: 替换为你自己的 TextAlive App token
    token: "YOUR_TOKEN_HERE",
  },
  mediaElement: document.createElement("audio"),
});

// ==========================================
// Player Event Listeners
// ==========================================

/**
 * onAppReady: Player 初始化完成
 * 在这里加载歌曲
 */
player.addListener({
  onAppReady: (app) => {
    console.log("[TextAlive] App is ready:", app);

    if (!app.managed) {
      // こたえて (Answer Me) / imie — 大奖歌曲
      // URL 必须包含版本号，并指定音乐地图参数
      player.createFromSongUrl("https://piapro.jp/t/6W2N/20251215164617", {
        video: {
          // 音楽地図訂正履歴 (音乐地图版本固定)
          beatId: 4827293,
          chordId: 2963754,
          repetitiveSegmentId: 3086261,
          // 歌詞タイミング訂正履歴
          lyricId: 126519,
          lyricDiffId: 28645,
        },
      });
    }
  },

  /**
   * onVideoReady: 歌曲加载完成，歌词数据可用
   */
  onVideoReady: (video) => {
    console.log("[TextAlive] Video ready:", video);

    // 获取歌词数据 - 这是 TextAlive 最核心的功能
    // Phrase (句) > Word (词) > Char (字) 三层结构
    let phrase = player.video.firstPhrase;
    while (phrase) {
      console.log("[Phrase]", phrase.text);
      phrase = phrase.next;
    }

    // 启用播放按钮
    playBtn.disabled = false;
    playBtn.textContent = "▶ Play";
  },

  /**
   * onTimerReady: 播放器准备就绪，可以开始播放
   */
  onTimerReady: () => {
    console.log("[TextAlive] Timer ready");
  },

  /**
   * onTimeUpdate: 每帧更新 (核心渲染循环)
   * position: 当前播放位置 (ms)
   */
  onTimeUpdate: (position) => {
    // 更新时间显示
    updateTimeDisplay(position);

    // 获取当前播放位置对应的歌词
    const phrase = player.video.findPhrase(position);
    const word = player.video.findWord(position);
    const char = player.video.findChar(position);

    // 更新歌词显示
    if (phrase) {
      lyricText.textContent = phrase.text;
    } else {
      lyricText.textContent = "";
    }

    // TODO: 在这里实现你的创意视觉效果
    // - 可以用 phrase / word / char 获取不同粒度的歌词
    // - 每个对象都有 .startTime / .endTime / .duration
    // - char 还有 .progress(position) 获取当前字的播放进度 (0-1)
  },

  /**
   * onPlay / onPause: 播放状态变化
   */
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
  if (!player.video) {
    console.log("[Info] Video not ready yet");
    return;
  }
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

// ==========================================
// Utility Functions
// ==========================================

/**
 * 格式化并更新播放时间显示
 */
function updateTimeDisplay(position) {
  const current = formatTime(position);
  const total = formatTime(player.video?.duration || 0);
  timeDisplay.textContent = `${current} / ${total}`;
}

/**
 * 毫秒转 m:ss 格式
 */
function formatTime(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}