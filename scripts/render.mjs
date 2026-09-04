// scripts/render.mjs
// data/metadata.json + data/captions.json + data/background.json verilerini
// birleştirip Remotion ile final MP4'ü render eder.
// Çıktı: out/short.mp4

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const DATA_DIR = path.resolve("data");
const OUT_DIR = path.resolve("out");
const MUSIC_DIR = path.resolve("public/music");

// public/music/ klasörüne telifsiz bir-iki mp3 atarsan her videoda rastgele
// biri kısık sesle (%7) altta çalar. Klasör yoksa/boşsa müzik eklenmez, yani
// bu tamamen opsiyoneldir. Sessiz bir fon, Shorts'ta videoyu "boş" hissettirip
// bırakma oranını yükselten en sinsi sebeplerden biri.
function pickMusic() {
  if (!fs.existsSync(MUSIC_DIR)) return null;
  const files = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|m4a|wav)$/i.test(f));
  if (files.length === 0) return null;
  const chosen = files[Math.floor(Math.random() * files.length)];
  console.log(`Arka plan müziği: ${chosen}`);
  return `music/${chosen}`;
}

async function main() {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "metadata.json"), "utf-8")
  );
  const captions = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "captions.json"), "utf-8")
  );
  const background = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "background.json"), "utf-8")
  );

  const inputProps = {
    title: metadata.title.replace(/\s*[-–]\s*/g, "\n"),
    hookText: metadata.hook_ekran_metni || metadata.hook_metni || "",
    hookEndSeconds: captions.hookEndSeconds ?? 0,
    musicSrc: pickMusic(),
    audioSegments: captions.audioSegments,
    backgroundClips: background.clips,
    words: captions.words,
    phases: captions.phases,
  };

  console.log("Remotion bundle hazırlanıyor...");
  const bundleLocation = await bundle({
    entryPoint: path.resolve("src/index.ts"),
  });

  console.log("Kompozisyon seçiliyor...");
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "ShortVideo",
    inputProps,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outputLocation = path.join(OUT_DIR, "short.mp4");

  console.log("Video render ediliyor (birkaç dakika sürebilir)...");
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation,
    inputProps,
    onProgress: ({ progress }) =>
      process.stdout.write(`\rİlerleme: %${Math.round(progress * 100)}   `),
  });

  console.log(`\n✅ Video hazır: ${outputLocation}`);
}

main().catch((err) => {
  console.error("❌ render hata:", err.message);
  process.exit(1);
});
