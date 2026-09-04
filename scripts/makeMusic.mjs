// scripts/makeMusic.mjs
// Arka plan müziği üretir - hiçbir yerden indirmeden, saf Node ile sentezleyerek.
//
// NEDEN BÖYLE? "Telifsiz" diye indirilen müziklerin büyük kısmı aslında
// atıf (attribution) şartlı ya da ticari kullanımda kısıtlı çıkıyor ve YouTube
// Content ID bunları yıllar sonra bile yakalayıp videonun gelirini/erişimini
// kesebiliyor. Burada dalga formlarını kendimiz üretiyoruz: ortada bir eser
// yok, dolayısıyla hak sahibi de yok. Content ID eşleşmesi imkansız.
//
// Çıktı: public/music/bed-1.wav ... bed-3.wav (varsa yeniden üretmez)
// Kullanım: node scripts/makeMusic.mjs [--force]

import fs from "node:fs";
import path from "node:path";

const MUSIC_DIR = path.resolve("public/music");
const SAMPLE_RATE = 44100;
const LOOP_SECONDS = 24;
const CROSSFADE_SECONDS = 0.5;

const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Her biri farklı bir duygu tonu taşısın diye üç ayrı döngü.
// Akorlar MIDI nota numarası olarak (60 = orta Do).
const BEDS = [
  {
    name: "bed-1", // sakin / nötr - çoğu konuya uyar
    bpm: 80,
    chords: [
      [57, 60, 64], // Am
      [53, 57, 60], // F
      [48, 52, 55], // C
      [55, 59, 62], // G
    ],
    arpGain: 0.28,
  },
  {
    name: "bed-2", // biraz daha aydınlık / "çözüm" hissi
    bpm: 92,
    chords: [
      [48, 52, 55], // C
      [55, 59, 62], // G
      [57, 60, 64], // Am
      [53, 57, 60], // F
    ],
    arpGain: 0.32,
  },
  {
    name: "bed-3", // yumuşak lo-fi, yedili akorlar
    bpm: 76,
    chords: [
      [50, 53, 57, 60], // Dm7
      [55, 59, 62, 65], // G7
      [48, 52, 55, 59], // Cmaj7
      [57, 60, 64, 67], // Am7
    ],
    arpGain: 0.24,
  },
];

// Tek kutuplu alçak geçiren filtre: sinüslerin tizdeki sertliğini alıp
// konuşmanın önüne geçmeyen, yumuşak bir doku bırakır.
function lowpass(samples, cutoffHz) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / SAMPLE_RATE);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev += a * (samples[i] - prev);
    samples[i] = prev;
  }
  return samples;
}

function renderBed(bed) {
  const beatSeconds = 60 / bed.bpm;
  const barSeconds = beatSeconds * 4;
  const crossfadeSamples = Math.floor(CROSSFADE_SECONDS * SAMPLE_RATE);
  const loopSamples = Math.floor(LOOP_SECONDS * SAMPLE_RATE);
  // Kusursuz döngü için sonuna crossfade kadar fazladan üretip başa katlıyoruz.
  const total = loopSamples + crossfadeSamples;
  const buf = new Float64Array(total);

  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const chord = bed.chords[Math.floor(t / barSeconds) % bed.chords.length];
    const posInBar = (t % barSeconds) / barSeconds;

    let sample = 0;

    // --- Ped (pad): akor notaları, yavaş nefes alan bir zemin ---
    // Bar içinde yumuşak bir giriş/çıkış: akor değişimleri duyulmasın.
    const padEnv =
      Math.sin(Math.PI * Math.min(1, posInBar * 1.6)) * 0.6 + 0.4;
    for (let v = 0; v < chord.length; v++) {
      const f = midiToFreq(chord[v] - 12); // bir oktav aşağı: zemin
      // Hafif detune - iki osilatör arasındaki yavaş vuruş sıcaklık verir.
      sample += 0.16 * padEnv * Math.sin(2 * Math.PI * f * t);
      sample += 0.12 * padEnv * Math.sin(2 * Math.PI * f * 1.003 * t);
    }

    // --- Arpej: akor notaları tek tek, kısa sönümlü vuruşlar ---
    const arpStep = beatSeconds / 2; // sekizlik
    const stepIndex = Math.floor(t / arpStep);
    const timeInStep = t - stepIndex * arpStep;
    const note = chord[stepIndex % chord.length] + 12; // bir oktav yukarı: parlaklık
    const f = midiToFreq(note);
    const decay = Math.exp(-timeInStep * 7);
    sample +=
      bed.arpGain *
      decay *
      (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t));

    buf[i] = sample;
  }

  lowpass(buf, 2400);

  // Kuyruğu başa crossfade ederek dikişsiz döngü elde ediyoruz.
  const out = new Float64Array(loopSamples);
  for (let i = 0; i < loopSamples; i++) {
    if (i < crossfadeSamples) {
      const k = i / crossfadeSamples;
      out[i] = buf[i] * k + buf[loopSamples + i] * (1 - k);
    } else {
      out[i] = buf[i];
    }
  }

  // Tepe değeri 0.9'a normalize et. Videoda zaten %7 seviyesinde
  // çalacağı için burada baskın olması sorun değil.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= gain;

  return out;
}

function toWav(samples) {
  const dataBytes = samples.length * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk uzunluğu
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // kanal sayısı
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte/saniye
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bit derinliği
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  return buffer;
}

function main() {
  const force = process.argv.includes("--force");
  fs.mkdirSync(MUSIC_DIR, { recursive: true });

  for (const bed of BEDS) {
    const outPath = path.join(MUSIC_DIR, `${bed.name}.wav`);
    if (fs.existsSync(outPath) && !force) {
      console.log(`  ${bed.name}.wav zaten var, atlanıyor.`);
      continue;
    }
    process.stdout.write(`  ${bed.name}.wav üretiliyor (${bed.bpm} BPM)... `);
    fs.writeFileSync(outPath, toWav(renderBed(bed)));
    console.log("bitti");
  }

  console.log(`✅ Arka plan müzikleri hazır: ${MUSIC_DIR}`);
}

main();
