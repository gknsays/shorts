// scripts/makeSfx.mjs
// Quiz formatı için ses efektlerini üretir - hiçbir yerden indirmeden, saf
// Node ile sentezleyerek.
//
// NEDEN SENTEZ: İndirilen "ücretsiz" efektlerin çoğu atıf şartlı ya da ticari
// kullanımda kısıtlı. Burada dalga formunu kendimiz üretiyoruz; ortada eser
// yok, hak sahibi yok, Content ID eşleşmesi imkânsız.
//
// Çıktı:
//   public/sfx/tiktak.wav - 1 saniyelik kusursuz döngü (tik ... tak ...)
//   public/sfx/zil.wav    - süre bitiminde çalan çan
//
// Kullanım: node scripts/makeSfx.mjs [--force]

import fs from "node:fs";
import path from "node:path";

const SFX_DIR = path.resolve("public/sfx");
const SAMPLE_RATE = 44100;

function toWav(samples) {
  const dataBytes = samples.length * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buffer;
}

function normalize(buf, hedef = 0.92) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const g = peak > 0 ? hedef / peak : 1;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

// Mekanik saat tıkırtısı: çok kısa bir gürültü patlaması + bir rezonans.
// Gerçek bir saatte "tik" ve "tak" aynı sesin iki farklı perdesi; ikisini
// ayırmak ritmi duyulur kılıyor.
function tikSesi(buf, baslangicSaniye, perde, siddet) {
  const bas = Math.floor(baslangicSaniye * SAMPLE_RATE);
  const uzunluk = Math.floor(0.055 * SAMPLE_RATE);
  // Sabit tohumlu sözde-rastgele: her üretimde aynı ses çıksın.
  let seed = Math.floor(perde * 1000) % 9973;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648) * 2 - 1;
  };

  for (let i = 0; i < uzunluk; i++) {
    const t = i / SAMPLE_RATE;
    // Çok hızlı sönüm: tıkırtı "vuruş" gibi duyulsun, uzayıp müziğe dönmesin.
    const zarf = Math.exp(-t * 145);
    const gurultu = rnd() * 0.55;
    const govde =
      Math.sin(2 * Math.PI * perde * t) * 0.8 +
      Math.sin(2 * Math.PI * perde * 2.7 * t) * 0.25;
    const idx = bas + i;
    if (idx < buf.length) buf[idx] += siddet * zarf * (govde + gurultu);
  }
}

function tiktakUret() {
  // 1 saniyelik döngü: 0.00'da "tik", 0.50'de "tak".
  const uzunluk = SAMPLE_RATE;
  const buf = new Float64Array(uzunluk);
  tikSesi(buf, 0.0, 2050, 1.0); // tik - tiz
  tikSesi(buf, 0.5, 1520, 0.92); // tak - pes
  return normalize(buf, 0.85);
}

// Çan: gerçek bir çanın kısmi sesleri (partial) tam katlar değildir; bu
// uyumsuzluk çana o karakteristik "metal" tınısını verir. Oranlar klasik
// çan analizlerinden alınmış yaklaşık değerler.
function zilUret() {
  const sure = 1.9;
  const uzunluk = Math.floor(sure * SAMPLE_RATE);
  const buf = new Float64Array(uzunluk);

  const temel = 880; // A5 - kalabalık bir mikste duyulacak kadar tiz
  const kisimlar = [
    { oran: 1.0, kazanc: 1.0, sonum: 2.6 },
    { oran: 2.0, kazanc: 0.6, sonum: 3.4 },
    { oran: 2.42, kazanc: 0.42, sonum: 4.2 },
    { oran: 3.0, kazanc: 0.28, sonum: 5.0 },
    { oran: 4.5, kazanc: 0.16, sonum: 6.5 },
    { oran: 5.8, kazanc: 0.09, sonum: 8.0 },
  ];

  for (let i = 0; i < uzunluk; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    for (const k of kisimlar) {
      s += k.kazanc * Math.exp(-t * k.sonum) * Math.sin(2 * Math.PI * temel * k.oran * t);
    }
    // Vuruş anındaki kısa tokmak sesi
    if (t < 0.012) s += 0.5 * Math.exp(-t * 260) * Math.sin(2 * Math.PI * 3200 * t);
    buf[i] = s;
  }

  return normalize(buf, 0.9);
}

function main() {
  const force = process.argv.includes("--force");
  fs.mkdirSync(SFX_DIR, { recursive: true });

  const dosyalar = [
    { ad: "tiktak.wav", uret: tiktakUret },
    { ad: "zil.wav", uret: zilUret },
  ];

  for (const d of dosyalar) {
    const yol = path.join(SFX_DIR, d.ad);
    if (fs.existsSync(yol) && !force) {
      console.log(`  ${d.ad} zaten var, atlanıyor.`);
      continue;
    }
    process.stdout.write(`  ${d.ad} üretiliyor... `);
    fs.writeFileSync(yol, toWav(d.uret()));
    console.log("bitti");
  }

  console.log(`✅ Ses efektleri hazır: ${SFX_DIR}`);
}

main();
