// scripts/slotGuard.mjs
// "Bu yayın slotu için video atıldı mı?" sorusunu cevaplayan bekçi.
//
// NEDEN GEREKLİ?
// GitHub Actions'ın zamanlanmış işleri garanti değil: kendi belgelerinde
// "yoğunluk dönemlerinde gecikebilir veya çalışmayabilir" yazıyor. Nitekim
// TRT 13:00 tetiklemesi hiç çalışmadı. Tek bir cron'a güvenmek, o tetikleme
// düştüğünde o günkü videonun hiç çıkmaması demek.
//
// ÇÖZÜM: cron'u sık çalıştırıp (20 dakikada bir) asıl kararı buraya bırakmak.
// Bu script, geçmiş slotlardan henüz yayınlanmamış olan var mı diye bakar:
//   - varsa  -> should_run=true, pipeline çalışır, slot başarıyla bitince işaretlenir
//   - yoksa  -> should_run=false, iş saniyeler içinde çıkar (pahalı adımlara girmez)
//
// Böylece GitHub tetiklemelerin çoğunu düşürse bile, slottan sonraki İLK
// başarılı yoklamada video çıkar; ve aynı slot için ikinci kez çıkmaz.
//
// Kullanım:
//   node scripts/slotGuard.mjs check   -> GITHUB_OUTPUT'a should_run / slot yazar
//   node scripts/slotGuard.mjs done    -> içinde bulunulan slotu yayınlandı işaretler

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "slots.json");

// Yayın slotları, UTC olarak. TRT = UTC+3.
//   10:17 UTC = 13:17 TRT   (öğle zirvesi)
//   13:23 UTC = 16:23 TRT   (öğleden sonra altın saat)
//   16:17 UTC = 19:17 TRT   (akşam zirvesi)
//   18:37 UTC = 21:37 TRT   (gece öncesi son dilim)
const SLOTS = ["10:17", "13:23", "16:17", "18:37"];

// Bir slot kaçırıldıysa en fazla bu kadar süre sonra hâlâ telafi edilir.
// Bunun ötesinde slot düşer - gece yarısı öğle videosunu atmanın anlamı yok.
const CATCHUP_HOURS = 3;

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

function slotMinutes(slot) {
  const [h, m] = slot.split(":").map(Number);
  return h * 60 + m;
}

// Şu ana göre: telafi penceresi içinde olan ve henüz yayınlanmamış en yeni slot.
// En yeniden başlıyoruz; iki slot birden kaçtıysa eskisini atlayıp güncel olanı
// yayınlamak daha doğru (bayat içerik yerine zamanında içerik).
function findPendingSlot(now, state) {
  const key = todayKey(now);
  const done = new Set(state[key] || []);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  for (const slot of [...SLOTS].reverse()) {
    const start = slotMinutes(slot);
    const gecikme = nowMin - start;
    if (gecikme >= 0 && gecikme <= CATCHUP_HOURS * 60 && !done.has(slot)) {
      return { slot, gecikmeDakika: gecikme };
    }
  }
  return null;
}

function writeOutput(lines) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  fs.appendFileSync(out, lines.join("\n") + "\n");
}

function main() {
  const command = process.argv[2] || "check";
  const now = new Date();
  const state = loadState();
  const key = todayKey(now);

  if (command === "done") {
    const slot = process.env.SLOT;
    if (!slot) {
      console.error("SLOT ortam değişkeni yok, işaretlenemedi.");
      process.exit(1);
    }
    // Elle tetiklenen çalıştırmalar bir slota ait değil; işaretlenirse o günün
    // zamanlanmış videosu atlanmış olur.
    if (slot === "manual") {
      console.log("Manuel çalıştırma, slot işaretlenmiyor.");
      return;
    }
    state[key] = [...new Set([...(state[key] || []), slot])];
    saveState(state);
    console.log(`✅ ${key} ${slot} slotu yayınlandı olarak işaretlendi.`);
    return;
  }

  const pending = findPendingSlot(now, state);
  const saatUtc = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

  console.log(`Şu an (UTC): ${key} ${saatUtc}`);
  console.log(`Bugün yayınlanan slotlar: ${(state[key] || []).join(", ") || "yok"}`);

  if (!pending) {
    console.log("→ Bekleyen slot yok, bu tetikleme boşa çalışmayacak.");
    writeOutput(["should_run=false"]);
    return;
  }

  console.log(
    `→ ${pending.slot} slotu bekliyor (${pending.gecikmeDakika} dakika gecikmeli). Pipeline çalışacak.`
  );
  writeOutput(["should_run=true", `slot=${pending.slot}`]);
}

main();
