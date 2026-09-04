// scripts/fetchBackground.mjs
// Konuya uygun dikey/kırpılabilir stok video klipleri bulur ve indirir.
// İki ücretsiz kaynak kullanır: Pexels ve (anahtar verilmişse) Pixabay.
//
// ALAKASIZ KLİP SORUNU VE ÇÖZÜMÜ:
// Stok video API'leri sonuç bulamadığında boş dönmek yerine "yakın" saydıkları
// popüler klipleri döndürüyor. Dönen sonucu alakalı varsaymak bu yüzden yanlış:
// limon konusunda hamur açma / soğan doğrama / kayısı klipleri böyle geliyordu.
//
// Kural: konuyla alakasız hiçbir klip indirilmez.
//   1. SERT FİLTRE - metadata'daki "stok_zorunlu_kelimeler"den en az biri klibin
//      açıklayıcı metninde (Pexels'te adres slug'ı, Pixabay'de etiketler) geçmiyorsa
//      aday elenir. Konu dışına çıkmayı engelleyen asıl mekanizma budur.
//   2. Eleme sonrası kalanlar sorgu kelimeleriyle örtüşme oranına göre sıralanır.
//   3. Bir sahne için uygun klip yoksa ALAKASIZ KLİP İNDİRİLMEZ; onaylanmış
//      kliplerden biri o sahnede tekrar kullanılır. Hiç uygun klip yoksa pipeline
//      durur - konu dışı bir video yayınlamaktansa o gün video çıkmasın.
//
// Çıktı: public/video/background-1.mp4 ... background-N.mp4, data/background.json

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const DATA_DIR = path.resolve("data");
const VIDEO_DIR = path.resolve("public/video");

// --- Kaynaklar ------------------------------------------------------------
// Her kaynak, sonuçları ortak bir şekle çeviriyor:
//   { key, provider, text, duration, files: [{ link, width, height }] }
// "text": alaka denetiminin üzerinde çalıştığı açıklayıcı metin.

async function searchPexels(query, orientation) {
  if (!process.env.PEXELS_API_KEY) return [];

  const params = new URLSearchParams({ query, per_page: "30" });
  if (orientation) params.set("orientation", orientation);

  const res = await fetch(
    `https://api.pexels.com/videos/search?${params.toString()}`,
    { headers: { Authorization: process.env.PEXELS_API_KEY } }
  );
  if (!res.ok) {
    throw new Error(`Pexels API hatası (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return (data.videos || []).map((v) => ({
    key: `pexels-${v.id}`,
    provider: "Pexels",
    // Pexels'in adres slug'ı klibin başlığıdır:
    // .../video/a-person-squeezing-a-lemon-1234567/
    tokens: tokenize(v.url || ""),
    duration: v.duration,
    files: (v.video_files || [])
      .filter((f) => f.file_type === "video/mp4")
      .map((f) => ({ link: f.link, width: f.width, height: f.height })),
  }));
}

async function searchPixabay(query, orientation) {
  if (!process.env.PIXABAY_API_KEY) return [];

  const params = new URLSearchParams({
    key: process.env.PIXABAY_API_KEY,
    q: query.slice(0, 100),
    per_page: "30",
    safesearch: "true",
  });

  const res = await fetch(`https://pixabay.com/api/videos/?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Pixabay API hatası (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return (data.hits || [])
    .map((h) => {
      const files = Object.values(h.videos || {})
        .filter((f) => f && f.url && f.width && f.height)
        .map((f) => ({ link: f.url, width: f.width, height: f.height }));
      return {
        key: `pixabay-${h.id}`,
        provider: "Pixabay",
        // Pixabay etiketleri açıkça veriyor - slug tahmininden daha güvenilir.
        tokens: tokenize(`${h.tags || ""} ${h.pageURL || ""}`),
        duration: h.duration,
        files,
      };
    })
    .filter((v) => v.files.length > 0)
    // Pixabay'de yön filtresi yok; dikey isteniyorsa istemci tarafında süzüyoruz.
    .filter((v) =>
      orientation === "portrait"
        ? v.files.some((f) => f.height > f.width)
        : true
    );
}

// --- Alaka denetimi -------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "of", "on", "in", "at", "with", "and", "for", "to",
  "up", "close", "shot", "view", "person", "man", "woman", "someone",
]);

function queryWords(query) {
  return String(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

const tokenize = (text) => String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Kelime, metnin kelimelerinden birine uyuyor mu?
//
// Düz alt-dize araması (text.includes) burada ciddi yanlış eşleşme üretiyordu:
// "wall" -> "wallpaper", "tire" -> "entire", "cord" -> "record",
// "car" -> "cardboard", "oil" -> "boiling". Bunlar konuyla alakasız kliplerin
// filtreyi geçmesine yol açıyordu.
//
// Bu yüzden kelime sınırına bakıyoruz, ama çekim eklerini de kaçırmamak için
// en fazla 3 harflik uzamayı kabul ediyoruz:
//   drill -> drills / drilled / drilling  ✓
//   wall  -> wallpaper (+5)               ✗
function wordMatches(tokens, word) {
  return tokens.some(
    (t) => t === word || (t.startsWith(word) && t.length - word.length <= 3)
  );
}

// SERT FİLTRE: zorunlu kelimelerden en az biri geçmiyorsa klip konu dışıdır.
// Eşleşen kelimeyi de döndürüyoruz; hangi kelimenin klibi kabul ettirdiğini
// görmek, fazla genel bir zorunlu kelimeyi ("paper", "water") yakalamayı
// kolaylaştırıyor.
function matchedRequiredWord(video, requiredWords) {
  if (requiredWords.length === 0) return "(filtre yok)";
  return requiredWords.find((w) => wordMatches(video.tokens, w)) ?? null;
}

function relevanceRatio(query, video) {
  const words = queryWords(query);
  if (words.length === 0) return 0;
  let matched = 0;
  for (const w of words) if (wordMatches(video.tokens, w)) matched++;
  return matched / words.length;
}

// Bir adayın kabul edilmesi için İKİ koşulu birden sağlaması gerekir:
//
//   (a) Zorunlu kelimelerden en az biri geçmeli.
//   (b) Sorgunun anlamlı kelimelerinin en az yarısı geçmeli.
//
// Tek başına (a) yetmiyor: Pixabay arama terimlerini OR'luyor, yani
// "electric drill wall" sorgusuna Çin Seddi ("wall"), traktör mibzeri ("drill")
// ve elektro gitar ("electric") gibi klipler dönüyor. Bunların her biri tek bir
// zorunlu kelimeyle filtreyi geçerdi. (b) koşulu bunları eliyor: Çin Seddi
// üç kelimeden yalnız birini karşıladığı için %33'te kalıp reddediliyor.
//
// Tek başına (b) de yetmiyor: sorgu genel yedek terime ("home repair diy")
// düştüğünde konuyla ilgisiz bir klip yüksek oran alabiliyor.
const MIN_RELEVANCE = 0.5;

function pickBestCandidate(query, videos, usedKeys, requiredWords) {
  const candidates = videos
    .filter((v) => !usedKeys.has(v.key))
    .map((v) => ({
      video: v,
      matched: matchedRequiredWord(v, requiredWords),
      ratio: relevanceRatio(query, v),
    }))
    .filter((c) => c.matched !== null && c.ratio >= MIN_RELEVANCE);

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => b.ratio - a.ratio)[0];
}

function pickBestFile(video) {
  // Dikey dosya varsa 1080 genişliğe en yakın olanı tercih et.
  const portrait = video.files
    .filter((f) => f.height > f.width)
    .sort((a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080));
  if (portrait.length > 0) return portrait[0];

  // Yatay klip 9:16'ya kırpılacağı için yanları kesilecek; en yüksek
  // çözünürlüklüsünü alıyoruz, yoksa kırpma sonrası görüntü yumuşak kalıyor.
  return [...video.files].sort((a, b) => b.height - a.height)[0];
}

// Bir sahne için sırayla denenecek aramalar. Sorgu genişlese bile sert filtre
// her adımda uygulandığı için konu dışına çıkılmaz.
function buildAttempts(specificQuery, broadQuery) {
  const attempts = [
    { fn: searchPexels, name: "Pexels", query: specificQuery, orientation: "portrait" },
    { fn: searchPixabay, name: "Pixabay", query: specificQuery, orientation: "portrait" },
    { fn: searchPexels, name: "Pexels", query: specificQuery, orientation: null },
    { fn: searchPixabay, name: "Pixabay", query: specificQuery, orientation: null },
  ];

  if (broadQuery && broadQuery !== specificQuery) {
    attempts.push(
      { fn: searchPexels, name: "Pexels", query: broadQuery, orientation: "portrait" },
      { fn: searchPixabay, name: "Pixabay", query: broadQuery, orientation: "portrait" },
      { fn: searchPexels, name: "Pexels", query: broadQuery, orientation: null },
      { fn: searchPixabay, name: "Pixabay", query: broadQuery, orientation: null }
    );
  }

  return attempts;
}

async function findClip(specificQuery, broadQuery, usedKeys, requiredWords) {
  for (const attempt of buildAttempts(specificQuery, broadQuery)) {
    const label = `${attempt.name} "${attempt.query}"${
      attempt.orientation ? " [dikey]" : " [her yön]"
    }`;

    let results = [];
    try {
      results = await attempt.fn(attempt.query, attempt.orientation);
    } catch (err) {
      console.log(`      ! ${label} → ${err.message}`);
      continue;
    }

    if (results.length === 0) continue; // anahtar yok ya da sonuç yok

    const candidate = pickBestCandidate(
      attempt.query,
      results,
      usedKeys,
      requiredWords
    );

    if (candidate) {
      console.log(
        `      ✓ ${label} → "${candidate.matched}" eşleşti, alaka %${Math.round(
          candidate.ratio * 100
        )}`
      );
      return candidate.video;
    }

    console.log(`      ✗ ${label} → ${results.length} sonucun hiçbiri konu filtresini geçmedi`);
  }

  return null;
}

async function downloadClip(video, index) {
  const file = pickBestFile(video);
  const outPath = path.join(VIDEO_DIR, `background-${index + 1}.mp4`);
  const shape = file.height > file.width ? "dikey" : "yatay (9:16'ya kırpılacak)";

  console.log(
    `      indiriliyor [${video.provider}]: ${file.width}x${file.height} ${shape}`
  );
  const res = await fetch(file.link);
  if (!res.ok) throw new Error(`indirme başarısız (${res.status})`);
  await pipeline(res.body, fs.createWriteStream(outPath));

  return {
    src: `video/background-${index + 1}.mp4`,
    durationInSeconds: video.duration || 6,
  };
}

async function main() {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "metadata.json"), "utf-8")
  );

  const terms =
    metadata.stok_arama_terimleri && metadata.stok_arama_terimleri.length > 0
      ? metadata.stok_arama_terimleri
      : Array(5).fill(metadata.stok_arama_terimi || metadata.topic || "lifestyle");

  // Konu dışına çıkmayı engelleyen zorunlu kelimeler. Model üretmediyse
  // arama terimlerinin kelimelerinden türetiyoruz.
  const requiredWords = (
    metadata.stok_zorunlu_kelimeler && metadata.stok_zorunlu_kelimeler.length > 0
      ? metadata.stok_zorunlu_kelimeler
      : [...new Set(terms.flatMap(queryWords))]
  )
    .map((w) => String(w).toLowerCase().trim())
    .filter(Boolean);

  const broadTerm =
    metadata.stok_genel_terim || queryWords(terms[0]).slice(0, 2).join(" ") || "";

  if (requiredWords.length === 0) {
    console.warn(
      "  ⚠️  Zorunlu kelime listesi boş; konu filtresi uygulanamıyor. " +
        "metadata.json içindeki stok_zorunlu_kelimeler alanını kontrol et."
    );
  }
  if (!process.env.PIXABAY_API_KEY) {
    console.log(
      "  ℹ️  PIXABAY_API_KEY tanımlı değil; sadece Pexels kullanılacak. " +
        "İkinci kaynak için pixabay.com/api/docs adresinden ücretsiz anahtar alabilirsin."
    );
  }

  console.log(`${terms.length} klip aranacak.`);
  console.log(`  Konu filtresi (en az biri eşleşmeli): ${requiredWords.join(", ")}`);
  console.log(`  Genel yedek terim: "${broadTerm}"`);

  fs.mkdirSync(VIDEO_DIR, { recursive: true });

  const usedKeys = new Set();
  const accepted = []; // konu filtresini geçmiş klipler
  const sceneVideos = []; // her sahnede kullanılacak klip

  for (let i = 0; i < terms.length; i++) {
    console.log(`  [${i + 1}] Aranıyor: "${terms[i]}"`);
    const video = await findClip(terms[i], broadTerm, usedKeys, requiredWords);

    if (video) {
      usedKeys.add(video.key);
      accepted.push(video);
      sceneVideos.push(video);
      continue;
    }

    // Konuya uygun yeni klip yok. ALAKASIZ KLİP İNDİRMİYORUZ; onaylanmış
    // kliplerden birini bu sahnede tekrar kullanıyoruz.
    if (accepted.length > 0) {
      console.log("      ↻ uygun yeni klip yok, önceki uygun kliplerden biri tekrar kullanılacak");
      sceneVideos.push(accepted[i % accepted.length]);
    } else {
      console.log("      ↻ henüz onaylanmış klip yok, bu sahne atlanıyor");
      sceneVideos.push(null);
    }
  }

  if (accepted.length === 0) {
    throw new Error(
      "Konuyla alakalı hiçbir stok video bulunamadı. Konu dışı görüntü kullanmamak " +
        "için işlem durduruldu. metadata.json içindeki stok_zorunlu_kelimeler fazla " +
        "dar olabilir (çok teknik bir terim); daha yaygın bir nesne adı gerekiyor."
    );
  }

  // Tekrar kullanılan klipleri tekrar indirmiyoruz; aynı dosya birden fazla
  // sahnede gösterilebilir.
  const downloaded = new Map();
  const clips = [];

  for (const video of sceneVideos) {
    if (!video) continue;

    if (downloaded.has(video.key)) {
      clips.push({ ...downloaded.get(video.key) });
      continue;
    }

    try {
      const clip = await downloadClip(video, downloaded.size);
      downloaded.set(video.key, clip);
      clips.push(clip);
    } catch (err) {
      console.warn(`      ⚠️  indirilemedi, atlanıyor: ${err.message}`);
    }
  }

  if (clips.length === 0) {
    throw new Error("Uygun klipler bulundu ama hiçbiri indirilemedi.");
  }

  const providers = [...new Set(accepted.map((v) => v.provider))].join(" + ");
  console.log(
    `  ${accepted.length} farklı uygun klip (${providers}), ${clips.length} sahnede kullanılacak.`
  );

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "background.json"),
    JSON.stringify({ clips }, null, 2)
  );

  console.log(`✅ Arka plan hazır (${clips.length} sahne).`);
}

main().catch((err) => {
  console.error("❌ fetchBackground hata:", err.message);
  process.exit(1);
});
