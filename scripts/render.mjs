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

// Klipleri anlatım bölümlerine hizalar.
//
// Eskiden BackgroundReel toplam süreyi klip sayısına eşit bölüyordu; hangi klibin
// hangi bölümde görüneceği tesadüfe kalıyordu. Sonuç: "doğru yöntem" için indirilen
// klip YANLIŞ bölümünde, jenerik bir klip de tam DOĞRU bölümünün ortasında
// çıkabiliyordu - izleyici anlatılan işlemi hiç görmüyordu.
//
// Artık her bölüm kendi kliplerini alıyor:
//   KANCA  -> 1 klip   (terim 0)
//   YANLIŞ -> 1 klip   (terim 1)
//   DOĞRU  -> 2 klip   (terim 2 ve 3 - işlemin gösterildiği asıl kısım)
//   KAPANIŞ-> 1 klip   (terim 4)
const CLIPS_PER_PHASE = [1, 1, 2, 1];

function buildScenes(captions, clips) {
  const words = captions.words || [];
  const phases = captions.phases || [];
  const lastEnd = words.length ? words[words.length - 1].end : 30;

  // Faz yoksa eski davranışa dön: klipleri süreye eşit dağıt.
  if (phases.length === 0 || clips.length === 0) {
    const per = lastEnd / Math.max(1, clips.length);
    return clips.map((c, i) => ({
      ...c,
      fromSeconds: i * per,
      toSeconds: (i + 1) * per,
    }));
  }

  const scenes = [];
  let clipCursor = 0;

  phases.forEach((phase, i) => {
    const start = words[phase.startWordIndex]?.start ?? 0;
    const end =
      i + 1 < phases.length
        ? words[phases[i + 1].startWordIndex]?.start ?? lastEnd
        : lastEnd + 0.5;

    // Bu bölüme kaç klip düşecek? Klip sayısı azsa bölüm başına düşen de azalır,
    // ama her bölüm en az bir klip alır (boş ekran kalmasın).
    const wanted = CLIPS_PER_PHASE[i] ?? 1;
    const count = Math.max(1, Math.min(wanted, clips.length));
    const span = (end - start) / count;

    for (let k = 0; k < count; k++) {
      const clip = clips[clipCursor % clips.length];
      clipCursor++;
      scenes.push({
        ...clip,
        fromSeconds: start + k * span,
        toSeconds: start + (k + 1) * span,
      });
    }
  });

  return scenes;
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
    backgroundScenes: buildScenes(captions, background.clips),
    words: captions.words,
    phases: captions.phases,
  };

  console.log("Sahne dağılımı (klip -> bölüm):");
  for (const s of inputProps.backgroundScenes) {
    console.log(
      `  ${s.src.padEnd(26)} ${s.fromSeconds.toFixed(1)}s - ${s.toSeconds.toFixed(1)}s`
    );
  }

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
