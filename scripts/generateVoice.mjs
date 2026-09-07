// scripts/generateVoice.mjs
// Microsoft Edge TTS servisini (ücretsiz, API anahtarı GEREKMEZ) kullanarak
// seslendirmeyi TEK PARÇA değil, HOOK / YANLIŞ / DOĞRU / ABONE OL bölümlerini
// AYRI AYRI üretir. Her bölüme kademeli olarak biraz daha hızlı/canlı bir ton
// veriyoruz - gerçek bir insanın konuşurken cümleden cümleye enerjisini
// artırması gibi. Bölümler arasında (ses dosyaları ayrı olduğu için) doğal bir
// mikro-boşluk oluşuyor; bu da faz geçiş flaşı/sesiyle güzel örtüşüyor.
//
// Çıktı: public/audio/narration-1.mp3 ... narration-4.mp3,
//        data/captions.json (words, phases, audioSegments, hookEndSeconds dahil)

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { EdgeTTS } from "@andresaya/edge-tts";

const DATA_DIR = path.resolve("data");
const AUDIO_DIR = path.resolve("public/audio");

// tr-TR-EmelNeural (kadın) veya tr-TR-AhmetNeural (erkek) - ikisi de ücretsiz.
// .env dosyasında EDGE_TTS_VOICE belirtilirse hep o ses kullanılır; belirtilmezse
// her videoda rastgele ikisinden biri seçilir (bazen Emel, bazen Ahmet).
const VOICE_POOL = ["tr-TR-EmelNeural", "tr-TR-AhmetNeural"];
const VOICE =
  process.env.EDGE_TTS_VOICE ||
  VOICE_POOL[Math.floor(Math.random() * VOICE_POOL.length)];
const BASE_RATE = process.env.EDGE_TTS_RATE || "+6%"; // önceki varsayılan "0%" idi; biraz daha canlı bir taban hız
const BASE_PITCH = process.env.EDGE_TTS_PITCH || "+0Hz";

// Videonun sonuna doğru sesin enerjisi hafifçe artsın diye her bölüm için
// tabana eklenen küçük farklar. + rastgele ufak bir sapma (her video biraz
// farklı hissettirsin, robotik/aynı tekrar olmasın diye).
//
// "badge": bu bölümde sağ üstteki faz rozeti gösterilsin mi? Hook bölümünde
// ekranın ortasını dev hook yazısı kapladığı için rozet kapalı.
// "cue": videoya bu bölümde eklenecek özel görsel (şimdilik abone animasyonu).
const SEGMENTS = [
  {
    key: "hook_metni",
    label: "HOOK",
    color: "#F59E0B",
    badge: false,
    rateDelta: 4,
    pitchDelta: 2,
  },
  {
    key: "yanlis_metni",
    label: "YANLIŞ",
    color: "#E23B3B",
    badge: true,
    rateDelta: 0,
    pitchDelta: 0,
  },
  {
    key: "dogru_metni",
    label: "DOĞRU",
    color: "#2FB65A",
    badge: true,
    rateDelta: 3,
    pitchDelta: 1,
  },
  {
    key: "cta_metni",
    label: "ABONE OL 🔔",
    color: "#7C3AED",
    // Sağ üstteki rozet bu bölümde kapalı: aynı anda ortada geçiş flaşı ve
    // altta abone butonu da "ABONE OL" yazıyor; üçü birden ekranı bağırtıyor.
    badge: false,
    cue: "subscribe",
    rateDelta: 8,
    pitchDelta: 3,
  },
];

function shiftPercent(base, delta) {
  const num = parseFloat(String(base).replace("%", "")) || 0;
  const total = Math.round(num + delta + (Math.random() * 4 - 2)); // ±2 rastgele oynama
  return `${total >= 0 ? "+" : ""}${total}%`;
}

function shiftHz(base, delta) {
  const num = parseFloat(String(base).replace("Hz", "")) || 0;
  const total = Math.round(num + delta);
  return `${total >= 0 ? "+" : ""}${total}Hz`;
}

// Edge TTS "WordBoundary" olaylarındaki offset/duration değerleri
// 100 nanosaniyelik birimlerdedir (Microsoft Speech servis standardı).
const TICKS_PER_SECOND = 10_000_000;

function boundariesToWords(boundaries) {
  return boundaries
    .filter((b) => b.type === "WordBoundary")
    .map((b) => ({
      word: b.text,
      start: b.offset / TICKS_PER_SECOND,
      end: (b.offset + b.duration) / TICKS_PER_SECOND,
    }));
}

async function synthesizeSegment(text, rate, pitch) {
  const tts = new EdgeTTS();
  await tts.synthesize(text, VOICE, { rate, pitch });
  return tts;
}

async function main() {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "metadata.json"), "utf-8")
  );

  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  console.log(`Bu video için seçilen ses: ${VOICE}`);

  const allWords = [];
  const phases = [];
  const audioSegments = [];
  let cursorSeconds = 0;
  let hookEndSeconds = 0;

  for (let i = 0; i < SEGMENTS.length; i++) {
    const seg = SEGMENTS[i];
    const text = metadata[seg.key];
    if (!text) continue; // ör. hook_metni yoksa bu bölüm atlanır

    const rate = shiftPercent(BASE_RATE, seg.rateDelta);
    const pitch = shiftHz(BASE_PITCH, seg.pitchDelta);

    console.log(
      `  [${i + 1}/${SEGMENTS.length}] "${seg.label}" seslendiriliyor (rate: ${rate}, pitch: ${pitch})...`
    );
    const tts = await synthesizeSegment(text, rate, pitch);

    const fileName = `narration-${i + 1}.mp3`;
    fs.writeFileSync(path.join(AUDIO_DIR, fileName), tts.toBuffer());

    const localWords = boundariesToWords(tts.getWordBoundaries());
    if (localWords.length === 0) {
      throw new Error(
        `"${seg.label}" bölümü için kelime zaman damgası alınamadı. Edge TTS servisine erişim engellenmiş olabilir.`
      );
    }

    // Bu bölümün faz rozeti, ilk kelimenin (küresel zaman çizelgesindeki) index'i
    phases.push({
      label: seg.label,
      color: seg.color,
      badge: seg.badge !== false,
      cue: seg.cue ?? null,
      startWordIndex: allWords.length,
    });

    // Kelime zamanlarını küresel zaman çizelgesine kaydır
    for (const w of localWords) {
      allWords.push({
        word: w.word,
        start: w.start + cursorSeconds,
        end: w.end + cursorSeconds,
      });
    }

    const segmentDuration = localWords[localWords.length - 1].end + 0.15;

    audioSegments.push({
      src: `audio/${fileName}`,
      offsetSeconds: cursorSeconds,
    });

    console.log(
      `      bu bölüm ~${segmentDuration.toFixed(1)}s sürüyor (zaman çizelgesinde ${cursorSeconds.toFixed(1)}s'de başlıyor)`
    );

    cursorSeconds += segmentDuration;

    if (seg.key === "hook_metni") hookEndSeconds = cursorSeconds;
  }

  if (allWords.length === 0) {
    throw new Error("Hiçbir seslendirme bölümü üretilemedi.");
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "captions.json"),
    JSON.stringify(
      { words: allWords, phases, audioSegments, hookEndSeconds },
      null,
      2
    )
  );

  console.log(
    `✅ Seslendirme hazır (${audioSegments.length} bölüm, ${allWords.length} kelime, toplam ~${cursorSeconds.toFixed(1)}s)`
  );
}

main().catch((err) => {
  console.error("❌ generateVoice hata:", err.message);
  process.exit(1);
});
