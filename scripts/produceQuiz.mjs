// scripts/produceQuiz.mjs
// Quiz formatındaki Shorts videosunu baştan sona üretir.
//
//   node scripts/produceQuiz.mjs              -> üret + YouTube'a yükle
//   node scripts/produceQuiz.mjs --no-upload  -> sadece üret
//
// Akış:
//   1. Gemini ile 3 soruluk quiz üretilir (günlük hayat / genel kültür)
//   2. Edge TTS ile soru ve cevap anlatımları seslendirilir
//   3. Her sorunun ekran süresi KENDİ seslendirmesinden hesaplanır
//   4. Remotion QuizVideo kompozisyonu render edilir
//   5. İstenirse YouTube'a yüklenir
//
// NEDEN AYRI BİR HAT: Bu format stok video ya da yapay zekâ görseli
// kullanmıyor; bütün görüntüyü Remotion çiziyor. Dolayısıyla fetchBackground
// adımı yok ve "konuyla alakasız klip" sorunu bu hatta hiç oluşmuyor.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { EdgeTTS } from "@andresaya/edge-tts";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const ROOT = path.resolve(".");
const DATA_DIR = path.join(ROOT, "data");
const AUDIO_DIR = path.join(ROOT, "public/audio");
const MUSIC_DIR = path.join(ROOT, "public/music");
const OUT_PATH = path.join(ROOT, "out/quiz.mp4");
const QUIZ_FILE = path.join(DATA_DIR, "quiz.json");
const USED_FILE = path.join(DATA_DIR, "used-quiz.json");

const VOICE = process.env.EDGE_TTS_VOICE || "tr-TR-AhmetNeural";
const BASE_RATE = process.env.EDGE_TTS_RATE || "+8%";

// Soru okunduktan sonra izleyiciye tanınan düşünme süresi. Geri sayım halkası
// tam bu aralıkta dönüyor. Çok kısa olursa izleyici cevabı düşünemeden görüyor
// ve "tahmin etme" refleksi oluşmuyor - bu formatın tutulmasını sağlayan asıl
// mekanizma o refleks.
// Şıkları okuyup düşünmek için tanınan süre. 1.5 saniye denendi ve fazla
// aceleci bulundu: izleyici üç şıkkı okuyamadan cevap açılıyordu. Okuyamamak
// merak değil rahatsızlık üretiyor ve kaydırmaya yol açıyor.
const DUSUNME_SANIYE = 3.5;

// Doğrulamadan geçen soru sayısı hedefi. Elenen sorular olduğunda eksik kalan
// kadarı yeni turda tamamlanıyor; MIN_SORU'nun altına düşülürse video hiç
// üretilmiyor - yanlış bilgi yayınlamaktansa o gün video çıkmasın.
const HEDEF_SORU = 3;
const MIN_SORU = 3;
const MAX_TUR = 6;
const CEVAP_PAYI = 0.6;
const INTRO_SANIYE = 2.0;
const OUTRO_SANIYE = 3.2;

const TICKS_PER_SECOND = 10_000_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Gemini ---------------------------------------------------------------

const MODEL_CHAIN = [
  ...new Set(
    [
      process.env.GEMINI_MODEL || "gemini-flash-latest",
      ...(
        process.env.GEMINI_MODEL_FALLBACKS ||
        "gemini-flash-lite-latest,gemini-2.5-flash,gemini-2.5-flash-lite"
      )
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean),
    ].filter(Boolean)
  ),
];

async function callGemini(prompt, { temperature = 0.9, modelOffset = 0 } = {}) {
  let lastError = null;
  // modelOffset: doğrulama örneklerinin FARKLI modellerden gelmesi için
  // zinciri kaydırıyoruz. Aynı modele üç kez sormak bağımsız bir kontrol
  // değil; aynı hatayı üç kez tekrarlar.
  const zincir = MODEL_CHAIN.map(
    (_, i) => MODEL_CHAIN[(i + modelOffset) % MODEL_CHAIN.length]
  );
  for (const model of zincir) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature },
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text)
            .join("");
          if (text) return text;
          throw new Error("Gemini boş yanıt döndü");
        }
        const body = await res.text();
        lastError = new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
        if (res.status === 404) break;
        if (![429, 500, 503].includes(res.status)) throw lastError;
      } catch (err) {
        lastError = err;
      }
      await sleep(4000 * attempt);
    }
  }
  throw lastError ?? new Error("Gemini çağrılamadı");
}

function extractJson(raw) {
  const t = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}

function loadUsed() {
  try {
    return JSON.parse(fs.readFileSync(USED_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function buildPrompt(gecmisSorular) {
  return [
    "Türkçe bir YouTube Shorts kanalı için 3 soruluk kısa bir bilgi testi yaz.",
    "Kanalın konusu: günlük yaşam bilgisi, pratik tüyolar, genel kültür.",
    "",
    "İZLEYİCİ KİTLESİ: Kanalın izleyicilerinin çoğunluğu ERKEK. Sorular kadın",
    "erkek herkesin anlayabileceği olsun ama ağırlığı erkeklerin daha çok",
    "ilgilendiği alanlara ver: araba ve sürüş, teknoloji, alet-edevat ve tamir,",
    "spor, tarih, bilim, para ve ekonomi, doğa ve hayatta kalma.",
    "Mutfak ve temizlik konularını AZ kullan; üç sorudan en fazla birinde.",
    "",
    "DOĞRULUK (en önemli kural): Cevaplar tartışmasız doğru olmalı. Kaynağı",
    "belirsiz, bölgeye/markaya göre değişen ya da uzmanlar arasında tartışmalı",
    "hiçbir soru sorma. Emin olmadığın bir bilgiyi soru yapma. Yanlış şıklar da",
    "açıkça yanlış olmalı; 'ikisi de doğru sayılabilir' durumu OLMAMALI.",
    "",
    "SORU KURALLARI:",
    "- Soru EN FAZLA 12 KELİME. Ekranda büyük puntoyla görünecek, uzun soru sığmıyor.",
    "- Sorular günlük hayatta karşılaşılan, herkesin merak edeceği şeyler olsun.",
    "- İnsanların çoğunun YANLIŞ bildiği şeyler tercih et; şaşırtıcı cevap",
    "  yorumu tetikliyor ve videoyu tekrar izlettiriyor.",
    "- Yabancı özel ad (kişi, kurum, yer) KULLANMA. Türkçe konuşan izleyici",
    "  yabancı isim duyunca kopuyor. Konular günlük hayattan olsun.",
    "- ÜÇ SORU BİRBİRİNDEN FARKLI ALANDA OLSUN. Her soruya bir \"alan\" etiketi",
    "  yaz ve üçü FARKLI olsun. Geçerli alanlar:",
    "  araba | teknoloji | alet-tamir | spor | tarih | bilim | para | doga |",
    "  hayatta-kalma | saglik | vucut | ulasim | genel-kultur | mutfak",
    "  Üç soruyu da mutfaktan seçmek en sık yapılan hata; video tek düze",
    "  görünüyor ve izleyici ikinci soruda kaydırıyor.",
    "- Şıklar soruyu DOĞRUDAN cevaplasın. Soru \"dolapta mı tezgahta mı\" diye",
    "  soruluyorsa şıklar \"dolapta / tezgahta\" gibi olmalı; alakasız bir",
    "  ifade (\"kuru ve karanlıkta\") şık olarak konursa soru anlamsızlaşıyor.",
    "",
    "ŞIK KURALLARI:",
    "- TAM OLARAK 3 şık. Her şık EN FAZLA 4 KELİME.",
    "- Şıklar birbirine yakın uzunlukta olsun; belirgin şekilde uzun olan şık",
    "  cevabı ele veriyor.",
    "- \"Hiçbiri\", \"Hepsi\", \"Hiçbirine...\", \"Fark etmez\" gibi kaçamak şık",
    "  YASAK. İzleyici tahmin edecek somut bir şey bulamıyor, cevap tatmin",
    "  etmiyor. Her şık SOMUT bir seçenek olsun.",
    "- ŞIKLAR SORUYU DİLBİLGİSİ OLARAK DA CEVAPLASIN. Soru \"nereye yazılmalı\"",
    "  diye soruyorsa şıklar bir YER bildirmeli; \"hafızada tutulmalı\" cevabı",
    "  soruyla uyuşmuyor ve izleyici okurken takılıyor. Soruyu şıkka göre",
    "  yeniden yaz: \"Kredi kartı şifresi nerede saklanmalı?\"",
    "",
    "ANLATIM (seslendirilecek):",
    "- Sorunun kendisi olduğu gibi seslendirilecek; ayrı bir anlatım metni YOK.",
    "  Bu yüzden \"soru\" alanı hem ekranda okunabilir hem sesli okunduğunda",
    "  doğal duyulan tek bir cümle olmalı.",
    "- \"cevap_anlatim\" DOĞRU ŞIKKIN METNİNİ AYNEN İÇERMELİ. Ekranda yeşile",
    "  dönen şıkla kulaktaki cevap birebir aynı olmalı; başka kelimelerle",
    "  söylersen izleyici uyuşmazlık görüyor.",
    '- "cevap_anlatim": EN FAZLA 8 KELİME. Bu sınır kritik: cevap anlatımı uzun',
    "  olduğunda video 40 saniyeye çıkıyor ve tutulma düşüyor. Doğru şıkkı söyle,",
    "  varsa tek kısa sebep ekle, orada bitir.",
    '  İyi: "Doğru cevap: asla yıkanmaz. Kabuğu korumasını kaybeder."',
    '  Kötü: "Bu sorunun doğru cevabı asla yıkanmaz, çünkü yumurtanın kabuğunda',
    '  bulunan doğal koruyucu tabaka yıkandığında ortadan kalkar."',
    "",
    gecmisSorular.length
      ? "DAHA ÖNCE SORULMUŞ sorular - bunları ne aynen ne de başka kelimelerle tekrar et:\n" +
        JSON.stringify(gecmisSorular.slice(-60))
      : "",
    "",
    "YOUTUBE:",
    '- "title": EN FAZLA 50 KARAKTER, merak uyandıran, sonuna tek emoji.',
    '- "description": 2 cümle, ilk cümlede aramada yazılacak ifade geçsin.',
    '- "tags": 8-12 Türkçe etiket.',
    "",
    "SADECE şu JSON ile cevap ver, başka hiçbir açıklama yazma:",
    JSON.stringify(
      {
        baslik_ekran: "Bunları biliyor musun?",
        title: "...",
        description: "...",
        tags: ["..."],
        sorular: [
          {
            alan: "mutfak",
            soru: "...",
            secenekler: ["...", "...", "..."],
            dogru: 0,
            cevap_anlatim: "...",
          },
        ],
      },
      null,
      0
    ),
  ].join("\n");
}

// --- Doğrulama ------------------------------------------------------------
// Model kurallara her zaman uymuyor; render'a bozuk veri gitmesin diye
// biçimi burada denetliyoruz.
// Tek bir sorunun biçim denetimi. Parti bazlı denetimden soru bazlı denetime
// geçildi: bir partideki tek bozuk soru yüzünden diğer iki sağlam soruyu da
// çöpe atmak, doğrulama elemeleriyle birleşince üretimi tamamen durduruyordu.
function soruBicimHatalari(s) {
  const hatalar = [];

  if (!s.soru || s.soru.split(/\s+/).length > 14) {
    hatalar.push("soru metni yok ya da 14 kelimeden uzun");
  }
  if (!Array.isArray(s.secenekler) || s.secenekler.length !== 3) {
    hatalar.push("tam olarak 3 şık olmalı");
    return hatalar; // şıklar bozuksa kalan denetimler anlamsız
  }
  if (
    typeof s.dogru !== "number" ||
    s.dogru < 0 ||
    s.dogru >= s.secenekler.length
  ) {
    hatalar.push('"dogru" indeksi geçersiz');
    return hatalar;
  }
  if (!String(s.alan || "").trim()) {
    hatalar.push('"alan" etiketi yok');
  }

  // "Hiçbirine basılmamalı" gibi çekimli haller de yakalanıyor.
  const kacamak =
    /^\s*(hi[çc]bir|hepsi|t[üu]m[üu]|bilmiyorum|fark etmez|ikisi de)/i;
  if (s.secenekler.some((x) => kacamak.test(String(x).trim()))) {
    hatalar.push("kaçamak şık kullanılmış");
  }

  if (!s.cevap_anlatim) {
    hatalar.push("cevap anlatımı yok");
  } else {
    const kelime = s.cevap_anlatim.split(/\s+/).length;
    if (kelime > 10) {
      hatalar.push(`cevap anlatımı ${kelime} kelime (en fazla 10)`);
    }
    // Seslendirilen cevap ile ekranda işaretlenen şık uyuşmalı.
    const dogruSik = s.secenekler[s.dogru];
    const sadelestir = (t) =>
      String(t)
        .toLocaleLowerCase("tr-TR")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    if (!sadelestir(s.cevap_anlatim).includes(sadelestir(dogruSik))) {
      hatalar.push(`cevap anlatımı doğru şıkkı ("${dogruSik}") birebir içermiyor`);
    }
  }

  return hatalar;
}

// --- Bilgi doğrulama ------------------------------------------------------
//
// Biçim denetimleri (şık sayısı, kelime sınırı, alan çeşitliliği) sorunun
// DOĞRU olduğunu göstermiyor. Model "ütü lekesine asetonsuz oje" gibi
// tamamen uydurma bir cevabı kurallara uygun biçimde üretebiliyor.
//
// Bu katman bilginin kendisini denetliyor: soru, doğru cevabın NE OLDUĞU
// SÖYLENMEDEN modele yeniden soruluyor. Üç bağımsız örnek alınıyor ve her
// biri farklı bir modelden başlıyor - aynı modele üç kez sormak bağımsız
// kontrol sayılmaz, aynı hatayı üç kez tekrarlar.
//
// Kabul şartı: üç örnek de AYNI şıkkı seçmeli, bu şık üretilen cevapla
// eşleşmeli ve hiçbiri soruyu "tartışmalı" işaretlememeli.
const DOGRULAMA_ORNEK = 3;

function dogrulamaIstemi(soru) {
  const siklar = soru.secenekler
    .map((sik, i) => `${String.fromCharCode(65 + i)}) ${sik}`)
    .join("\n");

  return [
    "Aşağıdaki çoktan seçmeli soruyu cevapla. Sana doğru cevap VERİLMEDİ;",
    "kendi bilginle karar ver.",
    "",
    "SORU: " + soru.soru,
    siklar,
    "",
    "Kurallar:",
    "- Emin değilsen bunu açıkça belirt. Tahmin yürütme.",
    "- Cevap kaynağa, bölgeye, markaya ya da koşullara göre değişiyorsa",
    "  ya da uzmanlar arasında tartışmalıysa \"tartismali\" alanına true yaz.",
    "- Birden fazla şık doğru sayılabiliyorsa da \"tartismali\" true olsun.",
    "",
    "SADECE şu JSON ile cevap ver:",
    '{"cevap": "A", "eminlik": "yuksek|orta|dusuk", "tartismali": false, "gerekce": "tek cümle"}',
  ].join("\n");
}

async function soruDogrula(soru, logOnEk = "") {
  const beklenen = String.fromCharCode(65 + soru.dogru);
  const cevaplar = [];

  for (let i = 0; i < DOGRULAMA_ORNEK; i++) {
    let sonuc;
    try {
      const ham = await callGemini(dogrulamaIstemi(soru), {
        temperature: 0.25, // düşük: tahmin değil, bilgi istiyoruz
        modelOffset: i, // her örnek farklı modelden başlasın
      });
      sonuc = extractJson(ham);
    } catch (err) {
      return { gecti: false, sebep: "doğrulama çağrısı başarısız: " + err.message };
    }

    const cevap = String(sonuc.cevap || "").trim().toUpperCase().slice(0, 1);
    cevaplar.push(cevap);

    if (sonuc.tartismali === true) {
      return { gecti: false, sebep: `tartışmalı bulundu (${sonuc.gerekce || "-"})` };
    }
    if (String(sonuc.eminlik || "").toLowerCase() === "dusuk") {
      return { gecti: false, sebep: "doğrulayıcı emin değil" };
    }
  }

  const hepsiAyni = new Set(cevaplar).size === 1;
  if (!hepsiAyni) {
    return {
      gecti: false,
      sebep: `doğrulayıcılar anlaşamadı (${cevaplar.join(", ")})`,
    };
  }
  if (cevaplar[0] !== beklenen) {
    return {
      gecti: false,
      sebep: `doğrulayıcılar ${cevaplar[0]} dedi, soruda ${beklenen} işaretli`,
    };
  }

  return { gecti: true, sebep: `${DOGRULAMA_ORNEK}/${DOGRULAMA_ORNEK} doğrulandı` };
}

// Şıkları karıştırır ve doğru şıkkın yeni indeksini hesaplar.
//
// NEDEN KODDA: Modelden "doğru şıkkın sırasını değiştir" istemek güvenilir
// değil - doğru cevabı ilk şık olarak yazma eğilimi çok güçlü ve denetim
// üretimi tamamen bloke edecek noktaya geldi. Karıştırmayı burada yapmak
// hem kesin sonuç veriyor hem modelin işini kolaylaştırıyor.
function siklariKaristir(soru) {
  const esli = soru.secenekler.map((metin, i) => ({
    metin,
    dogruMu: i === soru.dogru,
  }));

  // Fisher-Yates
  for (let i = esli.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [esli[i], esli[j]] = [esli[j], esli[i]];
  }

  return {
    ...soru,
    secenekler: esli.map((e) => e.metin),
    dogru: esli.findIndex((e) => e.dogruMu),
  };
}

// --- Seslendirme ----------------------------------------------------------

async function seslendir(text, dosyaAdi, rate = BASE_RATE) {
  const tts = new EdgeTTS();
  await tts.synthesize(text, VOICE, { rate, pitch: "+0Hz" });
  fs.writeFileSync(path.join(AUDIO_DIR, dosyaAdi), tts.toBuffer());

  const sinirlar = tts
    .getWordBoundaries()
    .filter((b) => b.type === "WordBoundary");
  const sonu = sinirlar.length
    ? (sinirlar[sinirlar.length - 1].offset +
        sinirlar[sinirlar.length - 1].duration) /
      TICKS_PER_SECOND
    : 0;

  if (sonu === 0) {
    throw new Error(
      `"${text.slice(0, 30)}..." için zaman damgası alınamadı. Edge TTS erişimi engellenmiş olabilir.`
    );
  }
  return { src: `audio/${dosyaAdi}`, sure: sonu };
}

// Kanal kimliği kapanış ekranında gösteriliyor. Avatar bir kez indirilip
// public/brand/ altında duruyor; her render'da ağa çıkmıyoruz.
function kanalKimligi() {
  const avatarYolu = path.join(ROOT, "public/brand/avatar.jpg");
  return {
    channelName: process.env.CHANNEL_NAME || "Fokus",
    channelAvatar: fs.existsSync(avatarYolu) ? "brand/avatar.jpg" : null,
  };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: "inherit" });
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(" ")} kod ${code}`))
    );
    c.on("error", reject);
  });
}

// --- Ana akış -------------------------------------------------------------

async function main() {
  const noUpload = process.argv.includes("--no-upload");

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });

  console.log("=== 1/4 Sorular üretiliyor ve doğrulanıyor ===");
  const gecmis = loadUsed();

  // Doğrulamadan geçen sorular biriktiriliyor. Bir soru elenirse tüm parti
  // atılmıyor; eksik kalan kadarı yeni turda tamamlanıyor.
  const dogrulanmis = [];
  const kullanilanAlanlar = new Set();
  let sonQuiz = null;

  for (let tur = 1; tur <= MAX_TUR && dogrulanmis.length < HEDEF_SORU; tur++) {
    const aday = extractJson(await callGemini(buildPrompt(gecmis)));
    if (!Array.isArray(aday?.sorular) || aday.sorular.length === 0) {
      console.warn(`⚠️  Tur ${tur}/${MAX_TUR}: soru üretilemedi, yeniden deneniyor...`);
      continue;
    }
    sonQuiz = aday;

    for (const ham of aday.sorular) {
      if (dogrulanmis.length >= HEDEF_SORU) break;

      // Biçim denetimi soru bazında: bozuk olan atlanıyor, sağlamlar
      // partiden kurtarılıyor.
      const bicimHatalari = soruBicimHatalari(ham);
      if (bicimHatalari.length > 0) {
        console.log(
          `  [${ham.alan ?? "?"}] ${String(ham.soru ?? "").slice(0, 46)} ... ✗ biçim: ${bicimHatalari.join("; ")}`
        );
        continue;
      }

      const soru = siklariKaristir(ham);
      const alan = String(soru.alan || "").toLocaleLowerCase("tr-TR").trim();
      if (kullanilanAlanlar.has(alan)) continue; // aynı alandan ikinci soru olmasın

      const beklenenHarf = String.fromCharCode(65 + soru.dogru);
      process.stdout.write(
        `  [${alan}] ${soru.soru} → ${beklenenHarf}) ${soru.secenekler[soru.dogru]} ... `
      );

      const sonuc = await soruDogrula(soru);
      if (sonuc.gecti) {
        console.log(`✓ ${sonuc.sebep}`);
        dogrulanmis.push(soru);
        kullanilanAlanlar.add(alan);
      } else {
        console.log(`✗ ELENDİ: ${sonuc.sebep}`);
      }
    }
  }

  if (dogrulanmis.length < MIN_SORU) {
    throw new Error(
      `Yeterli DOĞRULANMIŞ soru üretilemedi (${dogrulanmis.length}/${MIN_SORU}). ` +
        "Yanlış bilgi yayınlamamak için işlem durduruldu; tekrar dene."
    );
  }

  if (dogrulanmis.length < HEDEF_SORU) {
    console.warn(
      `⚠️  ${HEDEF_SORU} soru hedeflendi, ${dogrulanmis.length} tanesi doğrulamadan geçti. ` +
        "Video bu kadarıyla üretiliyor."
    );
  }

  const quiz = { ...(sonQuiz ?? {}), sorular: dogrulanmis };
  console.log(`  → ${dogrulanmis.length} soru doğrulandı ve kullanılacak.`);

  console.log("\n=== 2/4 Ses efektleri hazırlanıyor ===");
  await run("node", ["scripts/makeSfx.mjs"]);

  console.log("\n=== 3/4 Seslendirme ===");
  const audioSegments = [];
  const questions = [];
  let imlec = 0;

  // Açılış
  const giris = await seslendir(quiz.baslik_ekran, "quiz-intro.mp3", "+12%");
  audioSegments.push({ src: giris.src, offsetSeconds: 0 });
  const introSaniye = Math.max(INTRO_SANIYE, giris.sure + 0.4);
  imlec = introSaniye;
  console.log(`  Açılış: ${giris.sure.toFixed(1)}s`);

  for (let i = 0; i < quiz.sorular.length; i++) {
    const s = quiz.sorular[i];

    // Ekrandaki metnin AYNISI seslendiriliyor. Daha önce ayrı bir
    // "soru_anlatim" alanı vardı ve model onu farklı yazabiliyordu; izleyici
    // ekranda bir soru okurken kulağında başka bir soru duyuyordu
    // (yayınlanan bir videoda bu yaşandı). Tek kaynak kullanmak uyuşmazlığı
    // yapısal olarak imkânsız kılıyor.
    const soruSes = await seslendir(s.soru, `quiz-soru-${i + 1}.mp3`);
    const cevapSes = await seslendir(
      s.cevap_anlatim,
      `quiz-cevap-${i + 1}.mp3`,
      "+10%"
    );

    // Soru bölümü: anlatım + düşünme payı. Geri sayım bu sürenin tamamında döner.
    const soruSaniye = soruSes.sure + DUSUNME_SANIYE;
    const cevapSaniye = cevapSes.sure + CEVAP_PAYI;

    audioSegments.push({ src: soruSes.src, offsetSeconds: imlec });
    audioSegments.push({ src: cevapSes.src, offsetSeconds: imlec + soruSaniye });

    questions.push({
      soru: s.soru,
      secenekler: s.secenekler,
      dogru: s.dogru,
      soruSaniye,
      cevapSaniye,
      // Tik-tak sesi ve geri sayım tam burada başlıyor: seslendirme bitince.
      anlatimSaniye: soruSes.sure,
    });

    console.log(
      `  Soru ${i + 1}: ${soruSaniye.toFixed(1)}s + cevap ${cevapSaniye.toFixed(1)}s`
    );
    imlec += soruSaniye + cevapSaniye;
  }

  // Kapanış
  // Cümleler arası uzun duraksamanın sebebi nokta işaretleri: Edge TTS her
  // noktada belirgin bir es veriyor. Virgülle bağlayıp hızı artırınca akış
  // bozulmadan duraksama kalkıyor.
  const kapanisMetni =
    "Kaç tanesini bildin, yorumda yaz. " +
    "Böyle videoların devamı için abone olmayı unutma.";
  const kapanis = await seslendir(kapanisMetni, "quiz-outro.mp3", "+18%");
  audioSegments.push({ src: kapanis.src, offsetSeconds: imlec });
  const outroSaniye = Math.max(OUTRO_SANIYE, kapanis.sure + 0.5);
  console.log(`  Kapanış: ${kapanis.sure.toFixed(1)}s`);

  const props = {
    title: quiz.baslik_ekran || "Bunları biliyor musun?",
    questions,
    outro: "Kaç tanesini bildin?",
    outroAlt: "Yorumda belirt 👇",
    ...kanalKimligi(),
    audioSegments,
    introSeconds: introSaniye,
    outroSeconds: outroSaniye,
  };

  const toplam = introSaniye + imlec - introSaniye + outroSaniye;
  console.log(`  Toplam süre: ~${toplam.toFixed(1)}s`);

  fs.writeFileSync(
    QUIZ_FILE,
    JSON.stringify({ ...quiz, props }, null, 2)
  );

  // YouTube yüklemesi metadata.json okuduğu için aynı biçimde yazıyoruz.
  fs.writeFileSync(
    path.join(DATA_DIR, "metadata.json"),
    JSON.stringify(
      {
        topic: quiz.sorular.map((s) => s.soru).join(" | "),
        kategori: "Quiz",
        title: quiz.title,
        description:
          (quiz.description || "") +
          "\n\nKaç tanesini bildin? Yorumda yaz 👇\n\n#Shorts #quiz #bilgiyarismasi",
        tags: quiz.tags || ["quiz", "bilgi testi", "genel kültür"],
      },
      null,
      2
    )
  );

  console.log("\n=== 4/4 Render ===");
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.ts") });
  const composition = await selectComposition({
    serveUrl,
    id: "QuizVideo",
    inputProps: props,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: OUT_PATH,
    inputProps: props,
    onProgress: ({ progress }) => {
      process.stdout.write(`\r  İlerleme: %${Math.round(progress * 100)}   `);
    },
  });
  console.log(`\n✅ Video hazır: ${OUT_PATH}`);

  // Sorular geçmişe yazılıyor ki tekrar sorulmasın.
  const yeniGecmis = [...gecmis, ...quiz.sorular.map((s) => s.soru)].slice(-300);
  fs.writeFileSync(USED_FILE, JSON.stringify(yeniGecmis, null, 2));

  if (noUpload) {
    console.log("--no-upload verildi, YouTube'a yüklenmedi.");
    return;
  }

  console.log("\n=== YouTube'a yükleniyor ===");
  fs.copyFileSync(OUT_PATH, path.join(ROOT, "out/short.mp4"));
  await run("node", ["scripts/upload.mjs"]);
}

main().catch((err) => {
  console.error("\n❌ produceQuiz hata:", err.message);
  process.exit(1);
});
