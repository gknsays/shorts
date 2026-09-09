// scripts/slotGuard.mjs
// "Şimdi video atılmalı mı?" sorusunu cevaplayan bekçi.
//
// NEDEN SABİT SLOT DEĞİL DE PENCERE?
// GitHub Actions'ın zamanlanmış işleri ne garanti ne de dakikinde çalışır.
// Bu depoda ölçülen gerçek davranış (8 Eylül 2026, cron 09:12/10:12/14:12/
// 15:12/19:12/20:12 UTC iken): tetiklemeler 13:37, 17:54, 21:50 ve 00:06'da
// geldi - yani 1.5 ile 4.5 saat arası GECİKMELİ, üstelik altı tetiklemenin
// ikisi hiç gelmedi.
//
// Eski tasarım sabit slot + 2 saatlik telafi penceresi kullanıyordu. Gecikme
// telafi penceresinden uzun olduğu için HER tetikleme pencere kapandıktan
// sonra geliyor, bekçi "bekleyen slot yok" deyip işi 8 saniyede bitiriyordu.
// İş "success" görünüyordu ama gün boyu tek video çıkmıyordu.
//
// YENİ TASARIM: dakikaya değil, sıraya ve aralığa bakıyoruz. Tetikleme ne
// zaman gelirse gelsin şu üç şart sağlanıyorsa video üretilir:
//   1) Günün video kotası dolmamış  (EN_ERKEN.length adet)
//   2) Sıradaki videonun en erken saati geçmiş ve yayın penceresi kapanmamış
//   3) Bir önceki videonun üstünden en az MIN_ARALIK_DK geçmiş
// Böylece tetikleme 30 dakika da gecikse 4 saat de gecikse video çıkar;
// sadece izleyicinin olmadığı saatlere kaymaz.
//
// Kullanım:
//   node scripts/slotGuard.mjs check   -> GITHUB_OUTPUT'a should_run / slot yazar
//   node scripts/slotGuard.mjs done    -> yayınlanan saati güne işler

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "slots.json");

// Günün n'inci videosu bu saatten ÖNCE atılmaz (UTC). TRT = UTC+3.
//   08:00 UTC = 11:00 TRT   (öğleye doğru)
//   14:00 UTC = 17:00 TRT   (okul/iş çıkışı)
// Bunlar "tam bu saatte at" değil, "bu saatten sonra ilk fırsatta at"
// demek. Gecikme eklenince pratikte TRT 12:00-15:00 ve 18:00-21:00
// aralıklarına düşüyor.
//
// Kanalda İKİ AYRI NİŞ dönüşümlü yayınlanıyor ve saatler birbirine
// girmeyecek şekilde bölündü:
//   TRT 07:00  quiz        (gknsays/quizshorts deposu)
//   TRT 11:00  pratik bilgi <- bu depo
//   TRT 14:00  quiz        (gknsays/quizshorts deposu)
//   TRT 17:00  pratik bilgi <- bu depo
//   TRT 19:30  quiz        (gknsays/quizshorts deposu)
// Yani bu depo günde 2 video atıyor; kalan 3'ü quiz deposunun işi.
const EN_ERKEN = ["08:00", "14:00"];

// Yayın penceresinin kapanışı (UTC). 20:00 UTC = 23:00 TRT.
// Bundan sonra gelen tetikleme video üretmez: gece 02:00'de video atmak
// videoyu ölü bir saatte yakmak demek, slotu düşürmek daha doğru.
const PENCERE_BITIS = "20:00";

// Bu deponun iki videosu arasında en az bu kadar süre olsun. Aynı kanaldan
// kısa aralıkla çıkan videolar YouTube'un ayırdığı başlangıç gösterim
// havuzunu bölüşüyor ve birbirinin izleyicisini yiyor. Nominal aralık 6 saat
// (TRT 11:00 -> 17:00); 3 saat, ilk video gecikmeli çıktığında ikincisinin
// hemen ardına yapışmasını engelliyor.
const MIN_ARALIK_DK = 180;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  // Geçmiş günleri sonsuza kadar tutmaya gerek yok; son 7 gün yeter.
  const days = Object.keys(state).sort();
  const trimmed = {};
  for (const d of days.slice(-7)) trimmed[d] = state[d];

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(trimmed, null, 2) + "\n");
}

const pad = (n) => String(n).padStart(2, "0");
const todayKey = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Bugün yayınlananların en geç olanı (dakika cinsinden), yoksa null.
function sonYayinDakikasi(yayinlananlar) {
  const dakikalar = yayinlananlar
    .map(toMinutes)
    .filter((n) => Number.isFinite(n));
  return dakikalar.length ? Math.max(...dakikalar) : null;
}

function writeOutput(lines) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  fs.appendFileSync(out, lines.join("\n") + "\n");
}

function karar(nowMin, yayinlananlar) {
  const sira = yayinlananlar.length;

  if (sira >= EN_ERKEN.length) {
    return { calis: false, sebep: `Günün ${EN_ERKEN.length} videosu da atılmış.` };
  }
  if (nowMin > toMinutes(PENCERE_BITIS)) {
    return {
      calis: false,
      sebep: `Yayın penceresi kapandı (${PENCERE_BITIS} UTC). Kalan videolar bugün atlanıyor.`,
    };
  }
  if (nowMin < toMinutes(EN_ERKEN[sira])) {
    return {
      calis: false,
      sebep: `${sira + 1}. video en erken ${EN_ERKEN[sira]} UTC'de atılabilir.`,
    };
  }
  const son = sonYayinDakikasi(yayinlananlar);
  if (son !== null && nowMin - son < MIN_ARALIK_DK) {
    return {
      calis: false,
      sebep: `Son videonun üstünden ${nowMin - son} dk geçti, en az ${MIN_ARALIK_DK} dk gerekiyor.`,
    };
  }
  return { calis: true, sira: sira + 1 };
}

function main() {
  const command = process.argv[2] || "check";
  const now = new Date();
  const state = loadState();
  const key = todayKey(now);
  const saatUtc = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

  if (command === "done") {
    const slot = process.env.SLOT;
    if (!slot) {
      console.error("SLOT ortam değişkeni yok, işaretlenemedi.");
      process.exit(1);
    }
    // Elle tetiklenen çalıştırmalar kotaya sayılmaz; işaretlenirse o günün
    // zamanlanmış videolarından biri atlanmış olur.
    if (slot === "manual") {
      console.log("Manuel çalıştırma, kotaya işlenmiyor.");
      return;
    }
    state[key] = [...new Set([...(state[key] || []), slot])].sort();
    saveState(state);
    console.log(`✅ ${key} ${slot} yayınlandı olarak işlendi.`);
    return;
  }

  const yayinlananlar = state[key] || [];
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const sonuc = karar(nowMin, yayinlananlar);

  console.log(`Şu an (UTC): ${key} ${saatUtc}`);
  console.log(`Bugün atılanlar: ${yayinlananlar.join(", ") || "yok"}`);

  if (!sonuc.calis) {
    console.log(`→ Video üretilmeyecek. ${sonuc.sebep}`);
    writeOutput(["should_run=false"]);
    return;
  }

  console.log(`→ Günün ${sonuc.sira}. videosu üretilecek (${saatUtc} UTC).`);
  // Slot etiketi olarak tetiklemenin geldiği saati kullanıyoruz; sabit slot
  // saatleri artık yok, gerçekte ne zaman yayınlandığı bilgisi daha değerli.
  writeOutput(["should_run=true", `slot=${saatUtc}`]);
}

main();
