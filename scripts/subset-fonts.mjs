/**
 * subset-fonts.mjs — Aggressively shrink KiwiMaru by keeping only:
 *   - ASCII + Latin-1 punctuation + general punctuation + UI symbols
 *   - CJK punctuation, hiragana, katakana, halfwidth/fullwidth
 *   - Jōyō kanji (2136 chars, elementary + secondary school grades 1-6 + 8)
 *   - Jinmeiyō kanji (~862 chars, used in personal names; grades 9 + 10)
 *   - Top ~2500 most-frequent kanji from KANJIDIC corpus (extra safety margin
 *     for lyrics that may use non-Jōyō characters)
 *
 * The union covers >99.5% of modern Japanese lyric content. Glyphs not in this
 * set fall back to the OS's default Japanese font in the user's browser.
 *
 * Re-run after replacing fonts/KiwiMaru-*.full.ttf or to refresh:
 *     npm run subset-fonts
 */

import subsetFont from "subset-font";
import { readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FONT_DIR = path.resolve(process.cwd(), "fonts");
const KANJI_DATA_DIR = path.resolve(process.cwd(), "node_modules/kanji/lib/data");

function loadKanjiList(file) {
  return require(path.join(KANJI_DATA_DIR, file));
}

function buildCharset() {
  const chars = new Set();

  // === Unicode ranges (added wholesale) =====================================
  const ranges = [
    [0x0020, 0x007E], // ASCII printable
    [0x00A0, 0x00FF], // Latin-1 punctuation
    [0x2000, 0x206F], // General punctuation
    [0x25A0, 0x25FF], // Geometric shapes
    [0x2600, 0x27BF], // Misc symbols (⏸ ▶ ↺ ⛶ ⛵ etc.)
    [0x3000, 0x303F], // CJK symbols & punctuation
    [0x3040, 0x309F], // Hiragana
    [0x30A0, 0x30FF], // Katakana
    [0x31F0, 0x31FF], // Katakana phonetic extensions
    [0xFF00, 0xFFEF], // Halfwidth/fullwidth
  ];
  for (const [start, end] of ranges) {
    for (let i = start; i <= end; i++) chars.add(String.fromCodePoint(i));
  }

  // === Kanji (Jōyō + Jinmeiyō + top-frequency) ==============================
  // Grades 1-6 + 8 = full Jōyō (2136 chars). Grade 7 doesn't exist in this dataset.
  const joyoFiles = ["grade.g01.json", "grade.g02.json", "grade.g03.json",
                     "grade.g04.json", "grade.g05.json", "grade.g06.json",
                     "grade.g08.json"];
  // Grades 9-10 = Jinmeiyō (~862 chars, names).
  const jinmeiyoFiles = ["grade.g09.json", "grade.g10.json"];

  for (const f of [...joyoFiles, ...jinmeiyoFiles]) {
    for (const k of loadKanjiList(f)) chars.add(k);
  }

  // KANJIDIC frequency list — top ~2500 most-used kanji. Many appear in both
  // Jōyō and freq, so Set dedupes. Adding ~200-400 net new chars: lyric-friendly
  // additions like 嘘 凛 翔 etc.
  const FREQ_TOP = 2500;
  const freq = loadKanjiList("freq.json");
  for (let i = 0; i < Math.min(freq.length, FREQ_TOP); i++) chars.add(freq[i]);

  return [...chars].join("");
}

async function subsetOne(srcName, dstName, charset) {
  const srcPath = path.join(FONT_DIR, srcName);
  const dstPath = path.join(FONT_DIR, dstName);

  try {
    await access(srcPath, constants.R_OK);
  } catch {
    console.error(`✗ Missing source: ${srcPath}`);
    console.error(`  Copy the full KiwiMaru file there (download from Google Fonts if lost).`);
    process.exitCode = 1;
    return;
  }

  const input = await readFile(srcPath);
  const before = input.length;
  const output = await subsetFont(input, charset, { targetFormat: "truetype" });
  await writeFile(dstPath, output);
  const after = output.length;
  const pct = ((1 - after / before) * 100).toFixed(1);
  console.log(`✓ ${srcName} → ${dstName}`);
  console.log(`  ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB  (-${pct}%)`);
}

const charset = buildCharset();
console.log(`Subsetting to ${charset.length} unique codepoints (Jōyō + Jinmeiyō + top-freq kanji + kana + punctuation + UI symbols).\n`);

await subsetOne("KiwiMaru-Regular.full.ttf", "KiwiMaru-Regular.ttf", charset);
await subsetOne("KiwiMaru-Light.full.ttf",   "KiwiMaru-Light.ttf",   charset);
