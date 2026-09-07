// scripts/generateScript.mjs
// Google Gemini API'yi (ÜCRETSİZ katman, kredi kartı gerekmez) kullanarak:
//  - Eğer TOPIC verilmemişse otomatik bir "günlük hayatta yanlış yapılan iş" konusu seçer
//  - HOOK / YANLIŞ / DOĞRU / CTA formatında kısa bir Türkçe seslendirme metni yazar
//  - YouTube başlığı, açıklaması ve etiketlerini üretir
// Çıktı: data/metadata.json

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const USED_TOPICS_FILE = path.join(DATA_DIR, "used-topics.json");
// Ücretsiz katmanda kullanılabilen hızlı model. Güncel model adları için
// https://ai.google.dev/gemini-api/docs/models adresine bak.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Geniş ve güncel kategori havuzu. Her çalıştırmada sırayla bir sonraki
// kategoriye geçilir (round-robin), böylece art arda hep aynı alan
// (ör. sadece mutfak/yemek) çıkmaz, kanal çeşitli kalır.
//
// ÖNEMLİ (algoritma notu): YouTube bir kanalı bir kitleye oturtabilmek için konu
// tutarlılığı ister. Kanal küçükken 15 kategoriye birden yayılmak, algoritmanın
// "bu kanalı kime göstereyim?" sorusuna cevap bulamamasına yol açar. .env içine
//   CATEGORY_FILTER=Mutfak & Yemek Hazırlama,Ev Temizliği,Çamaşır & Kıyafet Bakımı
// yazarak havuzu 2-4 komşu kategoriye daraltabilirsin; kanal oturana kadar dar
// kalması büyümeyi hızlandırır.
// "brief": modele o kategori içinde NE tür alt konular arayacağını söyler.
// "aliases": kategori adı sonradan değiştiyse eski konu geçmişinin de aynı
// kategoriye ait sayılması için (tekrar kontrolü bozulmasın diye).
const ALL_CATEGORIES = [
  {
    name: "Araba Bakımı & Sürüş",
    brief:
      "araç bakımı ve sürüş: lastik, direksiyon, far, silecek, cam, akü, motor yağı, " +
      "fren, yakıt, yağmurda/karda sürüş, park, emniyet kemeri, araç içi düzen. " +
      "Servise gitmeden yapılabilen ama yanlış yapıldığında pahalıya patlayan işler öncelikli",
  },
  {
    name: "Telefon & Teknoloji Kullanımı",
    brief:
      "telefon ve bilgisayar: şarj alışkanlıkları, batarya, depolama, ekran, kablo, " +
      "wifi ve modem, kulaklık, klavye, güvenlik ve şifre, uygulama ayarları",
  },
  {
    name: "Sağlık & Günlük Alışkanlıklar",
    brief:
      "uyku, su tüketimi, duruş ve masa başı, yürüyüş, esneme, göz yorgunluğu, " +
      "sabah/akşam rutinleri (tıbbi tavsiye değil, genel bilgi)",
  },
  {
    name: "Spor & Egzersiz",
    brief:
      "koşu, ağırlık, esneme, ısınma, spor ayakkabısı, antrenman öncesi/sonrası, " +
      "sakatlanmadan çalışma",
  },
  {
    name: "Mutfak & Gıda Saklama",
    brief:
      "buzdolabında saklama, tazelik, pişirme, tencere-tava, kahve ve çay, ekmek, " +
      "sebze-meyve, gıda güvenliği",
  },
  {
    name: "Çamaşır & Ev Temizliği",
    brief:
      "çamaşır makinesi, yıkama programı, kurutma, ütü, leke, bulaşık, süpürge, " +
      "havlu ve nevresim bakımı",
  },
  {
    name: "Para & Alışveriş",
    brief:
      "market alışverişi, fatura, kredi kartı, abonelikler, tasarruf, fiyat karşılaştırma, " +
      "cüzdan ve nakit yönetimi",
  },
  {
    name: "Seyahat & Bavul",
    brief:
      "bavul hazırlama, uçak kuralları, otel, sırt çantası, yolculukta güvenlik, " +
      "araçla uzun yol",
  },
  {
    name: "Ev Güvenliği & Acil Durum",
    brief:
      "evde güvenlik: uzatma kablosu ve priz yükü, yangın söndürücü, duman dedektörü, " +
      "asansör, merdiven, kapı-kilit, su kaçağı, deprem hazırlığı, ilk yardım. " +
      "Görsel karşılığı olan somut nesneler üzerinden anlat",
  },
  {
    name: "Ofis & Masa Başı",
    brief:
      "masa düzeni, ekran yüksekliği, sandalye, aydınlatma, klavye ve fare, " +
      "uzun süre oturmanın etkileri",
  },
];

const norm = (s) => String(s).trim().toLocaleLowerCase("tr-TR");

// Bir konu geçmişi girdisinin kategorisi, verilen kategoriyle eşleşiyor mu?
// (eski/yeniden adlandırılmış kategori adlarını da kapsar)
function categoryMatches(category, recordedName) {
  if (!category || !recordedName) return false;
  const target = [category.name, ...(category.aliases ?? [])].map(norm);
  return target.includes(norm(recordedName));
}

function resolveCategories() {
  const filter = (process.env.CATEGORY_FILTER || "").trim();
  if (!filter) return ALL_CATEGORIES;

  const wanted = filter.split(",").map(norm).filter(Boolean);

  const matched = ALL_CATEGORIES.filter((c) =>
    [c.name, ...(c.aliases ?? [])].some((n) => wanted.includes(norm(n)))
  );

  if (matched.length === 0) {
    console.warn(
      "⚠️  CATEGORY_FILTER içindeki hiçbir kategori tanınmadı, tüm havuz kullanılıyor.\n" +
        `    Geçerli değerler: ${ALL_CATEGORIES.map((c) => c.name).join(" | ")}`
    );
    return ALL_CATEGORIES;
  }

  console.log(
    `Kategori havuzu daraltıldı (${matched.length}): ${matched
      .map((c) => c.name)
      .join(", ")}`
  );
  return matched;
}

const CATEGORIES = resolveCategories();

function loadUsedTopics() {
  try {
    return JSON.parse(fs.readFileSync(USED_TOPICS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveUsedTopics(topics) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(topics, null, 2));
}

// Aynı modelde ısrar etmek yerine yedek modellere de geçiyoruz.
//
// Gemini'nin ücretsiz katmanında 503 ("This model is currently experiencing high
// demand") sık görülüyor ve bu yoğunluk model bazında. Tek modelde 5 kez deneyip
// pes etmek, günde 4 kez çalışan bir işi tamamen düşürüyordu; farklı bir modelin
// kapasitesi genelde aynı anda müsait oluyor.
//
// Sıra: .env'deki GEMINI_MODEL -> yedekler. GEMINI_MODEL_FALLBACKS ile
// değiştirilebilir (virgülle ayrılmış).
const FALLBACK_MODELS = (
  process.env.GEMINI_MODEL_FALLBACKS ||
  "gemini-flash-lite-latest,gemini-2.5-flash,gemini-2.5-flash-lite"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const MODEL_CHAIN = [...new Set([MODEL, ...FALLBACK_MODELS])];

const ATTEMPTS_PER_MODEL = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function requestGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9 },
    }),
  });

  if (res.ok) {
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .join("");
    if (!text) {
      throw Object.assign(
        new Error("Gemini boş yanıt döndü: " + JSON.stringify(data)),
        { retryable: false }
      );
    }
    return text;
  }

  const body = await res.text();
  const error = new Error(`Gemini API hatası (${res.status}): ${body}`);
  error.status = res.status;
  // 503/429/500: geçici yoğunluk, beklemeye değer.
  // 404: bu model bu anahtarla yok, beklemenin anlamı yok, sıradakine geç.
  error.retryable = [429, 500, 503].includes(res.status);
  error.modelMissing = res.status === 404;
  throw error;
}

async function callGemini(prompt) {
  let lastError = null;

  for (const model of MODEL_CHAIN) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const text = await requestGemini(model, prompt);
        if (model !== MODEL) console.log(`   (yedek model kullanıldı: ${model})`);
        return text;
      } catch (err) {
        lastError = err;

        if (err.modelMissing) {
          console.log(`"${model}" bu anahtarla kullanılamıyor, sıradaki modele geçiliyor...`);
          break;
        }
        if (!err.retryable) throw err;

        if (attempt === ATTEMPTS_PER_MODEL) {
          console.log(`"${model}" ${ATTEMPTS_PER_MODEL} denemede de yanıt vermedi, sıradaki modele geçiliyor...`);
          break;
        }

        // Üstel bekleme + rastgele sapma. Sapma önemli: 4 çalıştırma aynı
        // anda tetiklenirse hepsi aynı saniyede tekrar denemesin.
        const waitSeconds = Math.round(6 * 2 ** (attempt - 1) + Math.random() * 4);
        console.log(
          `${model} yoğun (${err.status}). ${waitSeconds}s sonra tekrar (deneme ${attempt}/${ATTEMPTS_PER_MODEL})...`
        );
        await sleep(waitSeconds * 1000);
      }
    }
  }

  throw new Error(
    `Denenen tüm modeller yanıt vermedi (${MODEL_CHAIN.join(", ")}). ` +
      `Son hata: ${lastError?.message ?? "bilinmiyor"}`
  );
}

function extractJson(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// YouTube açıklamasının ilk satırları arama/öneri sinyali olarak en ağır basan
// kısım. Etiketleri ayrıca hashtag'e çevirip sona ekliyoruz - YouTube ilk üç
// hashtag'i başlığın hemen üstünde de gösterir, bu da tıklamayı artırır.
function buildDescription(parsed) {
  const base = (parsed.description || "").trim();

  const hashtags = (parsed.tags || [])
    .slice(0, 5)
    .map(
      (t) =>
        "#" +
        String(t)
          .toLocaleLowerCase("tr-TR")
          .replace(/[^\p{L}\p{N}\s]/gu, "")
          .trim()
          .split(/\s+/)
          .join("")
    )
    .filter((t) => t.length > 2);

  const parts = [base];
  if (parsed.topic) parts.push(`📌 Bu videoda: ${parsed.topic}`);
  parts.push("👍 Beğenip abone olursan her gün yenisi gelir.");
  parts.push([...new Set([...hashtags, "#Shorts", "#shortsturkiye"])].join(" "));

  return parts.join("\n\n");
}

// --- Konu tekrarı denetimi -------------------------------------------------
// Modele "şunları tekrar etme" demek tek başına yetmiyor: aynı fikri farklı
// kelimelerle geri getirebiliyor ("bulaşık süngerini değiştirmemek" ->
// "sünger ne sıklıkla yenilenmeli"). Bu yüzden üretilen konuyu, geçmiştekilerle
// kelime kümesi üzerinden karşılaştırıp gerçekten yeni mi diye ölçüyoruz.

const TOPIC_STOPWORDS = new Set([
  "ve", "ile", "için", "bir", "bu", "şu", "o", "da", "de", "mi", "mı", "mu",
  "nasıl", "neden", "yanlış", "doğru", "yapmak", "yapma", "kullanmak", "gibi",
  "daha", "çok", "en", "her", "ama", "olarak", "sonra", "önce",
]);

// Türkçe çekim ekleri ("süngeri", "süngerini", "süngerler") aynı kökten gelen
// kelimeleri farklı gösterir. Kelimeleri ilk 5 harfe kırpmak, sözlük/stemmer
// gerektirmeden bu ekleri büyük ölçüde eritir.
function topicTokens(topic) {
  return new Set(
    norm(topic)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !TOPIC_STOPWORDS.has(w))
      .map((w) => w.slice(0, 5))
  );
}

function similarity(a, b) {
  const A = topicTokens(a);
  const B = topicTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

const SIMILARITY_LIMIT = 0.55;

function findDuplicate(topic, previousTopics) {
  for (const prev of previousTopics) {
    if (similarity(topic, prev) >= SIMILARITY_LIMIT) return prev;
  }
  return null;
}

async function main() {
  const cliTopic = process.argv.slice(2).join(" ").trim();
  const usedEntries = loadUsedTopics(); // [{ topic, kategori }, ...]

  // Round-robin: her çalıştırmada bir sonraki kategoriye geç.
  const category = cliTopic
    ? null
    : CATEGORIES[usedEntries.length % CATEGORIES.length];

  // Bu kategoride daha önce işlenen TÜM konular (sadece son 10'u değil):
  // kategori havuzu 2-3'e daraldığında aynı konuya dönme riski çok artıyor.
  const previousTopicsInCategory = usedEntries
    .filter((e) => categoryMatches(category, e.kategori))
    .map((e) => e.topic)
    .filter(Boolean);

  // Modele gösterilen liste (istem şişmesin diye son 40 ile sınırlı);
  // benzerlik denetimi ise tüm geçmişe karşı yapılır.
  const promptTopicList = previousTopicsInCategory.slice(-40);

  // Aynı konu farklı kategori altında da tekrar edebilir, o yüzden benzerlik
  // kontrolünde tüm geçmişe bakıyoruz.
  const allPreviousTopics = usedEntries.map((e) => e.topic).filter(Boolean);

  const rejectedTopics = [];

  const buildPrompt = () => `
Sen Türkçe konuşan bir YouTube Shorts kanalı için içerik yazarısın.
Kanalın formatı: "Günlük hayatta YANLIŞ yapılan bir işi gösterip, ardından DOĞRUSUNU"
anlatan 20-28 saniyelik kısa bir seslendirme metni.

${
  cliTopic
    ? `Konu şu olacak: "${cliTopic}".`
    : `Bu videonun kategorisi KESİNLİKLE şu olacak: "${category.name}".
Bu kategoride şunlar işlenir: ${category.brief}.
Bu kategori içinde, geniş kitleye hitap eden, şaşırtıcı ve pratik, spesifik bir alt konu bul.

GÖRSEL BULUNABİLİRLİK ŞARTI (bu kural ihlal edilirse video görsel olarak çöker):
Seçtiğin konunun ana nesnesi, ücretsiz stok video kütüphanelerinde (Pexels/Pixabay)
BOLCA bulunan bir şey olmalı. Bu kütüphaneler uluslararası; Türkiye'ye özgü ya da
çok teknik nesnelerin karşılığı YOK.
  Karşılığı VAR  : araba, lastik, direksiyon, far, telefon, şarj kablosu, laptop,
                   buzdolabı, çamaşır makinesi, bulaşık, süpürge, yatak, su bardağı,
                   koşu ayakkabısı, spor salonu, bavul, market arabası, kredi kartı,
                   priz, uzatma kablosu, yangın söndürücü, merdiven, ofis masası
  Karşılığı YOK  : kombi, petek, silikon, derz, dübel, sigorta kutusu, doğalgaz
                   vanası, alçı, şofben, kalorifer peteği
Karşılığı olmayan bir nesne seçersen sahnelerin hepsi aynı jenerik klibe düşüyor
ve video tek düze görünüyor. Böyle bir konu seçme.

Bu kategoride DAHA ÖNCE İŞLENMİŞ konular. Bunları ne aynen ne de başka kelimelerle
tekrar etme; aynı nesne/eylem etrafında dönen bir varyasyon da sayılır, tamamen
başka bir alt konuya geç:
${JSON.stringify(promptTopicList, null, 0)}`
}${
  rejectedTopics.length > 0
    ? `

DİKKAT: Az önce şu konuları önerdin ve geçmiştekilerle fazla benzer oldukları için
REDDEDİLDİLER: ${JSON.stringify(rejectedTopics)}.
Bu sefer bunlardan ve yukarıdaki listeden belirgin şekilde uzak, farklı bir nesne
veya farklı bir eylem etrafında kurulu bir konu seç.`
    : ""
}

VİDEONUN YAPISI (4 parça, sırayla seslendirilecek):
1. "hook_metni"   -> ilk 1.5-2.5 saniye. İzleyicinin parmağını durduran açılış.
2. "yanlis_metni" -> çoğu insanın nasıl/neden yanlış yaptığı.
3. "dogru_metni"  -> doğrusu.
4. "cta_metni"    -> beğen + abone daveti.

HOOK KURALLARI (en kritik kısım - videonun izlenip izlenmemesini bu belirler):
- 6-11 kelime, TEK cümle. Bu sınır önemli: hook seslendirmede 2.5 saniyeyi
  geçerse izleyici cevaba varmadan kaydırıyor. Uzun yazma.
- Bir "merak boşluğu" açsın: izleyici cevabı öğrenmek için kalmak zorunda hissetsin.
- İşe yarayan kalıplar: doğrudan iddia ("... aslında temizlemiyor, kirletiyor."),
  şaşırtıcı oran ("Bunu yapanların onda dokuzu farkında değil."),
  ikinci tekil şahıs uyarı ("Bunu her gün yapıyorsan, farkında olmadan ... bozuyorsun.").
- İçinde konunun SOMUT nesnesi geçsin (sünger, priz, çamaşır makinesi...). Soyut kalma.
- "Merhaba arkadaşlar", "Bugün sizlere", "Hadi başlayalım" gibi ısınma cümlesi YASAK.
- Cevabı hook'ta VERME; sadece merakı aç.
- "hook_ekran_metni": aynı hook'un ekranda dev punto yazılacak 2-5 kelimelik hali
  (tamamı büyük harf değil, normal yazım; ör. "Süngerin en kirli yeri").

ANLATIM TARZI (hook'tan sonraki bölümler için):
- Sert/emredici bir reklam sesi gibi DEĞİL; iki arkadaşın sohbet ederken birinin
  diğerine "ay bak sana bir şey anlatayım" der gibi anlattığı, sıcak, samimi,
  bilgilendirici bir tonda olsun.
- "Aslında çoğumuz...", "Ben de uzun süre öyle sanıyordum ama...", "Şöyle bir şey var:"
  gibi doğal, konuşma diline yakın geçişler kullan.
- Kısa cümleler ve akıcı bir ritim korunsun, Shorts'a uygun olsun.

Kurallar:
- "yanlis_metni" 2 cümle, "dogru_metni" 2 cümle. hook + yanlış + doğru toplamı
  55-70 kelime civarı olsun (20-28 saniye). BU SINIRI AŞMA.
  Neden bu kadar kısa: Shorts'ta en güçlü sıralama sinyali, videonun sonuna kadar
  izlenip başa dönmesidir (loop). 25 saniyelik video tamamlanıp döner; 45 saniyelik
  video ortasında bırakılır. Anlatımı sıkıştır: süsleme ve dolgu cümlesi at,
  bilgiyi bırak.
BAŞLIK (title) KURALLARI - feed'de tıklanmayı bu belirler:
- EN FAZLA 50 KARAKTER. Shorts feed'inde başlık bu uzunluktan sonra kırpılıyor;
  vaadin kırpılan kısımda kalması tıklamayı doğrudan öldürür.
- Somut nesne mutlaka geçsin (silikon, sigorta, akü, derz, kombi...). "Bu hatayı
  yapmayın" gibi nesnesiz, herhangi bir videoya uyabilecek başlık YAZMA.
- Cevabı başlıkta VERME; hook ile aynı merak boşluğunu taşısın.
- İşe yarayan kalıplar (birini seç, hepsini birden kullanma):
  "<Nesne> <eylem> yapanlar dikkat", "<Nesne> hakkında bilmediğin şey",
  "<Sayı> kişiden <sayı>'si bunu yanlış yapıyor", "<Nesne> neden <beklenmedik sonuç>?"
- Sonuna TEK emoji ekle (konuyla ilgili olsun), en fazla bir tane.
- Başlıkta TAMAMI büyük harf kelime kullanma; feed'de spam algılanıyor.

AÇIKLAMA (description):
- 2-3 cümle. İLK CÜMLE en kritik: insanların YouTube'da bu konuyu ararken yazacağı
  ifade birebir geçsin (ör. "duş silikonu nasıl çekilir"). Arama sonuçlarında
  eşleşme buradan kuruluyor.
- İkinci cümlede videonun verdiği somut faydayı yaz.

ETİKETLER (tags) - 10-14 adet, şu üç grubu KARIŞTIRARAK ver:
- 4-5 adet DAR/uzun kuyruk terim: kullanıcının arama kutusuna yazacağı tam ifade
  ("duş silikonu nasıl çekilir", "banyo derz temizliği").
- 3-4 adet ORTA terim: konunun nesnesi + alan ("silikon çekme", "banyo tadilatı").
- 3-4 adet GENİŞ terim: kanalın genel alanı ("ev tamiri", "tadilat ipuçları",
  "pratik bilgiler", "usta tavsiyesi").
- Etiketler Türkçe olsun ve hiçbiri diğerinin birebir tekrarı olmasın.
GÖRSEL/STOK VİDEO TERİMLERİ (bu kısım kritik - yanlış terim, konuyla alakasız
arka plan videosuna yol açıyor):
- "stok_arama_terimleri": TAM OLARAK 5 elemanlı İngilizce dizi. Sıra ÖNEMLİ, çünkü
  her eleman videonun belirli bir bölümünde ekranda görünecek:
    [0] KANCA bölümü  → konunun nesnesini genel olarak gösteren sahne
    [1] YANLIŞ bölümü → hatalı/özensiz yapılan hali, dağınıklık, sorunun kendisi
    [2] DOĞRU bölümü  → DÜZGÜN YAPILAN İŞLEMİN KENDİSİ
    [3] DOĞRU bölümü  → aynı işlemin başka bir anı ya da temiz/başarılı sonucu
    [4] KAPANIŞ       → memnun sonuç, tamamlanmış iş
  [2] ve [3] EN KRİTİK OLANLAR: izleyici videoyu doğru yöntemi görmek için izliyor.
  Bu ikisi mutlaka DOĞRU yöntemin uygulandığı eylemi betimlesin; "home repair diy",
  "person working" gibi jenerik sahneler YAZMA - bunlar konuyu göstermez.
  HER TERİM EN FAZLA 3 KELİME OLSUN. Bu sınır kritik: stok kütüphanelerinde
  "installing new gas hose" ya da "checking gas leak with soap" gibi bir klip YOKTUR,
  ama "gas hose" ve "gas pipe" vardır. Uzun ve cümle gibi yazılmış terimler hiçbir
  sonuç getirmiyor ve sahne genel bir yedek klibe düşüyor.
  Aşağıdaki dağarcık stok kütüphanelerinde BOL; terimleri mümkün olduğunca
  bunların içinden ya da bunlara yakın seç:
    araba: "car tire", "steering wheel", "car headlight", "windshield wiper",
      "car engine", "driving rain", "car dashboard", "parking car"
    teknoloji: "smartphone screen", "charging phone", "laptop keyboard",
      "usb cable", "wifi router", "headphones", "phone battery"
    ev: "washing machine", "refrigerator open", "vacuum cleaner", "dishes sink",
      "laundry basket", "power outlet", "extension cord", "fire extinguisher"
    mutfak: "cutting vegetables", "cooking pan", "coffee cup", "fresh bread",
      "kitchen counter", "food storage"
    sağlık/spor: "person sleeping", "drinking water", "running shoes",
      "gym workout", "stretching exercise", "office desk", "sitting posture"
    para/seyahat: "counting money", "credit card", "supermarket shelf",
      "shopping cart", "packing suitcase", "airport luggage"
  Terimler stok video kütüphanelerinde GERÇEKTEN bulunabilecek, yaygın sahneler olsun;
  aşırı spesifik/sinematik tarifler ("hand rolling lemon counterclockwise") yazma.
  Her terimin içinde konunun ana nesnesi geçsin.
- "stok_yedek_terimleri": TAM OLARAK 5 elemanlı İngilizce dizi; her eleman
  "stok_arama_terimleri" içindeki AYNI SIRADAKİ terimin daha genel yedeği olsun.
  Her biri 1-2 kelime ve stok kütüphanelerinde kesinlikle sonuç veren yaygın bir
  sahne olmalı. Yine de konunun nesnesini taşımalı: "gas hose" için yedek
  "gas pipe" veya "kitchen stove" olur, "person working" OLMAZ.
  Bu alan, spesifik terim tutmadığında o sahnenin kendi yedeğine düşmesini sağlar;
  yoksa tüm tutmayan sahneler aynı klibi paylaşıp video tekrara düşüyor.
- "stok_zorunlu_kelimeler": 2-4 elemanlı İngilizce TEK KELİMELİK isim dizisi. Bunlar
  konunun görsel çekirdeğidir; bir stok klip bunlardan HİÇBİRİNİ içermiyorsa o klip
  konuyla alakasızdır ve kullanılmayacaktır. Geniş değil, somut nesne/mekan adı ver.
  Örnek - konu "uzatma kablosunun sarılı kullanılması" ise: ["cable","cord","socket","plug"].
  Örnek - konu "banyo silikonunun küflenmesi" ise: ["bathroom","tile","shower","caulk"].
  "person", "home", "work" gibi her videoya uyan genel kelimeler YAZMA.
- "stok_genel_terim": 2 kelimelik İngilizce yedek sorgu. Spesifik terimler sonuç
  vermezse bu kullanılır, ama yine konuyu temsil etmeli (ör. "electrical socket",
  "bathroom tiles", "car tire").
- "cta_metni": videonun EN SONUNDA söylenecek, sıcak ve samimi tek bir Türkçe cümle.
  EN FAZLA 7 KELİME. Mutlaka "beğen" ve "abone ol" fiillerini (veya eş anlamlılarını)
  içersin. Her seferinde farklı kelimelerle yaz, kalıplaşmış cümleyi tekrar etme.
  Neden bu kadar kısa: kapanış anonsu izleyicinin kaydırdığı yerdir. 14 kelimelik
  bir CTA 4 saniye sürüyor ve 26 saniyelik videonun altıda birini kaplıyor; bu
  süre boyunca izleyici zaten gitmiş oluyor, ama izlenme oranı hesabına dahil
  edildiği için ortalama tutulmayı aşağı çekiyor. Kısa CTA hem oranı korur hem
  videonun başa dönmesini (loop) kolaylaştırır.

SADECE aşağıdaki JSON formatında, başka hiçbir açıklama olmadan cevap ver:
{
  "topic": "kısa konu özeti",
  "kategori": "${category ? category.name : "konudan çıkarılan kategori adı"}",
  "title": "...",
  "description": "...",
  "tags": ["...", "..."],
  "hook_metni": "...",
  "hook_ekran_metni": "...",
  "yanlis_metni": "...",
  "dogru_metni": "...",
  "cta_metni": "...",
  "stok_arama_terimleri": ["...", "...", "...", "...", "..."],
  "stok_yedek_terimleri": ["...", "...", "...", "...", "..."],
  "stok_zorunlu_kelimeler": ["...", "...", "..."],
  "stok_genel_terim": "..."
}
`.trim();

  console.log(
    `Gemini API ile senaryo üretiliyor${category ? ` (kategori: ${category.name})` : ""}...`
  );

  // Konu geçmiştekilere fazla benziyorsa, reddedilenleri isteme ekleyip
  // yeniden üretiyoruz. 3 denemede de benzer çıkarsa (havuz gerçekten
  // tükenmiş olabilir) sonuncuyu kabul edip uyarı basıyoruz - pipeline'ın
  // tamamen durması, tekrar eden bir konudan daha kötü.
  const MAX_ATTEMPTS = 3;
  let parsed = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = extractJson(await callGemini(buildPrompt()));

    if (cliTopic) {
      parsed = candidate;
      break;
    }

    const duplicate = findDuplicate(candidate.topic, allPreviousTopics);
    if (!duplicate) {
      parsed = candidate;
      break;
    }

    rejectedTopics.push(candidate.topic);
    console.warn(
      `⚠️  "${candidate.topic}" daha önceki "${duplicate}" konusuyla fazla benzer ` +
        `(deneme ${attempt}/${MAX_ATTEMPTS}), yeniden üretiliyor...`
    );
    parsed = candidate; // son çare olarak elde kalsın
  }

  if (rejectedTopics.length === MAX_ATTEMPTS) {
    console.warn(
      "⚠️  3 denemede de yeterince farklı bir konu üretilemedi. Kategori havuzu " +
        "tükeniyor olabilir: CATEGORY_FILTER'a bir kategori daha eklemeyi düşün."
    );
  }

  // Model hook'u atlarsa video eski (kancasız) haline düşmesin diye
  // yanlış metninin ilk cümlesini hook'a terfi ettiriyoruz.
  if (!parsed.hook_metni && parsed.yanlis_metni) {
    const firstSentence = parsed.yanlis_metni.split(/(?<=[.!?])\s+/)[0];
    parsed.hook_metni = firstSentence;
    parsed.yanlis_metni = parsed.yanlis_metni.slice(firstSentence.length).trim();
    console.warn("⚠️  Model hook üretmedi, ilk cümle hook'a terfi ettirildi.");
  }
  if (!parsed.hook_ekran_metni) {
    parsed.hook_ekran_metni = parsed.title || parsed.topic || "";
  }

  // Süre denetimi: model kelime sınırını aşarsa video loop bandının dışına
  // çıkıyor ve tamamlanma oranı düşüyor. Sessizce geçmesin.
  const kelimeSay = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;
  const konusmaKelime =
    kelimeSay(parsed.hook_metni) +
    kelimeSay(parsed.yanlis_metni) +
    kelimeSay(parsed.dogru_metni);
  // Alt sinir da denetleniyor: fazla kisa metinde "yanlis" kurulmadan
  // "dogru"ya geciliyor ve izleyici neyin anlatildigini kavrayamiyor.
  if (konusmaKelime < 45) {
    console.warn(
      `⚠️  Metin ${konusmaKelime} kelime ile fazla kisa (hedef 55-70). ` +
        "Yanlis-dogru kurgusu kurulmadan bitiyor olabilir."
    );
  }

  if (konusmaKelime > 80) {
    console.warn(
      `⚠️  Metin ${konusmaKelime} kelime (hedef 55-70, ~20-28 sn). ` +
        "Video loop bandının dışına çıkabilir."
    );
  } else {
    // 2.2 sabiti tahminden degil olcumden geldi: Edge TTS Turkce, kullandigimiz
    // hiz ayarlarinda ~2.2 kelime/saniye konusuyor (64 kelime -> 28.7 saniye).
    // Onceki 2.6 degeri sureyi oldugundan kisa gosteriyordu.
    console.log(`   Metin: ${konusmaKelime} kelime (~${Math.round(konusmaKelime / 2.2)} sn)`);
  }

  if (parsed.title && parsed.title.length > 55) {
    console.warn(
      `⚠️  Başlık ${parsed.title.length} karakter (hedef ≤50). Shorts feed'inde kırpılabilir.`
    );
  }

  // Her videoya eklenen sabit kanal etiketleri: YouTube'un videoları birbiriyle
  // ilişkilendirip "sonraki video" trafiği üretmesine yardım eder.
  // .env -> CHANNEL_TAGS=ev tamiri,tadilat,kendin yap
  const channelTags = (process.env.CHANNEL_TAGS || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (channelTags.length > 0) {
    const existing = new Set((parsed.tags || []).map(norm));
    parsed.tags = [
      ...(parsed.tags || []),
      ...channelTags.filter((t) => !existing.has(norm(t))),
    ];
  }

  parsed.description = buildDescription(parsed);

  usedEntries.push({
    topic: parsed.topic,
    kategori: parsed.kategori || category?.name || null,
  });
  // Kategori havuzu daraldığı için geçmişi uzun tutuyoruz: tekrar denetimi
  // ancak hatırladığı kadarını engelleyebilir.
  saveUsedTopics(usedEntries.slice(-300));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "metadata.json"),
    JSON.stringify(parsed, null, 2)
  );

  console.log("✅ Senaryo hazır:", parsed.title);
  console.log("   Hook:", parsed.hook_metni);
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((err) => {
  console.error("❌ generateScript hata:", err.message);
  process.exit(1);
});
