// scripts/slotGuard.mjs
// "Simdi video hazirlanmali mi, hazirlanirsa kacta yayinlanmali?" sorusunu
// cevaplayan bekci.
//
// SORUN NEYDI?
// GitHub Actions'in zamanlanmis isleri ne garanti ne de dakikinde calisir.
// Bu depoda olculen gercek davranis (8 Eylul 2026): tetiklemeler 13:37,
// 17:54, 21:50 ve 00:06'da geldi - yani 1.5 ile 4.5 saat arasi GECIKMELI,
// ustelik alti tetiklemenin ikisi hic gelmedi. Yayin saatini tetikleme
// saatine bagladigin surece bu gecikmeyi yenmenin yolu yok.
//
// COZUM: yayin saatini tetiklemeden AYIRMAK.
// Video hedef saatten saatler once uretiliyor ve YouTube'a "private +
// publishAt" ile yukleniyor. Yayina alma isini YouTube yapiyor ve YouTube
// dakikasi dakikasina yayinliyor. GitHub isi 06:00'da da calistirsa
// 10:00'da da calistirsa, video TRT 11:00'de yayina giriyor.
//
// Boylece iki bagimsiz pencere olusuyor:
//   HAZIRLIK penceresi -> videonun uretilip yuklenmesi gereken aralik
//   YAYIN saati        -> videonun izleyiciye gorunecegi tam an (sabit)
//
// Kullanim:
//   node scripts/slotGuard.mjs check   -> GITHUB_OUTPUT'a should_run / slot / publish_at yazar
//   node scripts/slotGuard.mjs done    -> yayinlanan hedefi gune isler

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "slots.json");

// Turkiye 2016'dan beri yaz saati uygulamiyor; TRT butun yil UTC+3.
const TRT_OFFSET = 3;

// YAYIN SAATLERI (TRT). Video tam bu saatlerde izleyiciye acilir.
//
// Kanalda IKI AYRI NIS donusumlu yayinlaniyor, saatler boyle bolundu:
//   TRT 07:00  quiz         (gknsays/quizshorts deposu)
//   TRT 11:00  pratik bilgi <- BU DEPO
//   TRT 14:00  quiz         (gknsays/quizshorts deposu)
//   TRT 17:00  pratik bilgi <- BU DEPO
//   TRT 19:30  quiz         (gknsays/quizshorts deposu)
const YAYIN_SAATLERI = ["11:00", "17:00"];

// Video, yayin saatinden en fazla bu kadar once uretilmeye baslanir.
// Genis tutuluyor: GitHub tetiklemeleri saatlerce gecikebildigi icin
// hedeften once ise yarayan bir tetikleme yakalama sansini bu belirliyor.
// 5 saat = TRT 11:00 videosu icin 06:00'dan itibaren uretilebilir.
const HAZIRLIK_SAATI = 5;

// Yayin saati gectigi halde video hala uretilmemisse (GitHub o pencerede
// hic tetikleme gondermediyse) bu sure boyunca hala uretilir - ama artik
// zamanlanmadan, DOGRUDAN yayinlanir. Bunun otesinde o yayin dusurulur.
const GECIKME_TOLERANSI_SAAT = 3;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  // Gecmis gunleri sonsuza kadar tutmaya gerek yok; son 7 gun yeter.
  const days = Object.keys(state).sort();
  const trimmed = {};
  for (const d of days.slice(-7)) trimmed[d] = state[d];

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(trimmed, null, 2) + "\n");
}

const pad = (n) => String(n).padStart(2, "0");
const gunKey = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// TRT "HH:MM" -> bugunku o ana denk gelen UTC Date nesnesi.
function trtSaatiUtcTarihe(now, hhmm) {
  const [saat, dakika] = hhmm.split(":").map(Number);
  const d = new Date(now);
  d.setUTCHours(saat - TRT_OFFSET, dakika, 0, 0);
  return d;
}

const trtGoster = (d) => {
  const t = new Date(d.getTime() + TRT_OFFSET * 3600 * 1000);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
};

// Su an uretilmesi gereken yayin hangisi?
function siradakiYayin(now, yapilanlar) {
  for (const saat of YAYIN_SAATLERI) {
    if (yapilanlar.includes(saat)) continue;

    const yayinAni = trtSaatiUtcTarihe(now, saat);
    const hazirlikBaslangici = new Date(
      yayinAni.getTime() - HAZIRLIK_SAATI * 3600 * 1000
    );
    const sonSans = new Date(
      yayinAni.getTime() + GECIKME_TOLERANSI_SAAT * 3600 * 1000
    );

    if (now < hazirlikBaslangici) {
      return { durum: "erken", saat, hazirlikBaslangici };
    }
    if (now > sonSans) {
      // Bu yayin tamamen kacti; sonrakine bak.
      continue;
    }
    return { durum: "uret", saat, yayinAni, gecikti: now >= yayinAni };
  }
  return { durum: "yok" };
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
  const key = gunKey(now);

  if (command === "done") {
    const slot = process.env.SLOT;
    if (!slot) {
      console.error("SLOT ortam degiskeni yok, islenemedi.");
      process.exit(1);
    }
    // Elle tetiklenen calistirmalar gunluk kotaya sayilmaz; islenirse o gunun
    // zamanlanmis yayinlarindan biri atlanmis olur.
    if (slot === "manual") {
      console.log("Manuel calistirma, kotaya islenmiyor.");
      return;
    }
    state[key] = [...new Set([...(state[key] || []), slot])].sort();
    saveState(state);
    console.log(`OK: ${key} TRT ${slot} yayini hazirlandi olarak islendi.`);
    return;
  }

  const yapilanlar = state[key] || [];
  const sonuc = siradakiYayin(now, yapilanlar);

  console.log(`Su an: ${key} ${trtGoster(now)} TRT`);
  console.log(`Bugun hazirlananlar: ${yapilanlar.join(", ") || "yok"}`);

  if (sonuc.durum === "yok") {
    console.log("-> Bugun hazirlanacak yayin kalmadi.");
    writeOutput(["should_run=false"]);
    return;
  }

  if (sonuc.durum === "erken") {
    console.log(
      `-> Henuz erken. TRT ${sonuc.saat} yayini icin uretim ${trtGoster(sonuc.hazirlikBaslangici)} TRT'de basliyor.`
    );
    writeOutput(["should_run=false"]);
    return;
  }

  const cikti = ["should_run=true", `slot=${sonuc.saat}`];

  if (sonuc.gecikti) {
    // Yayin saati gecmis ve video hala yok: zamanlamanin anlami kalmadi,
    // dogrudan yayinla. publish_at bos birakiliyor.
    console.log(
      `-> TRT ${sonuc.saat} yayini gecikti, video uretilip DOGRUDAN yayinlanacak.`
    );
    cikti.push("publish_at=");
  } else {
    // Normal yol: videoyu simdi uret, YouTube'a "TRT ${saat}'te yayinla" de.
    const publishAt = sonuc.yayinAni.toISOString().replace(/\.\d{3}Z$/, "Z");
    console.log(
      `-> Video simdi uretilecek, YouTube'a TRT ${sonuc.saat} (${publishAt}) icin zamanlanacak.`
    );
    cikti.push(`publish_at=${publishAt}`);
  }

  writeOutput(cikti);
}

main();
