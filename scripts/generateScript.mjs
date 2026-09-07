// scripts/generateScript.mjs
// Google Gemini API'yi (ÜCRETSİZ katman, kredi kartı gerekmez) kullanarak:
//  - Eğer TOPIC verilmemişse otomatik bir "açıklanamayan olay" konusu seçer
//  - HOOK / OLAY / AÇIKLANAMAYAN / CTA formatında kısa bir Türkçe seslendirme metni yazar
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
    name: "Uzay & Evren Gizemleri",
    brief:
      "uzayda açıklanamayan gözlemler: tuhaf radyo sinyalleri, kayıp sondalar, " +
      "anlaşılamayan gök cisimleri, kara delikler, Ay ve Mars'ta görülen anormallikler, " +
      "yıldızların beklenmedik davranışı, uzay görevlerinde yaşanan sıra dışı olaylar. " +
      "Bilimsel olarak kaydedilmiş ama tam açıklanamamış olayları seç",
  },
  {
    name: "Çözülememiş Tarihi Gizemler",
    brief:
      "tarihte kaydedilmiş ama açıklanamayan olaylar: kayıp uygarlıklar, çözülemeyen " +
      "şifreli metinler, ortadan kaybolan ordular ve kafileler, anlaşılamayan haritalar, " +
      "mezarı bulunamayan hükümdarlar, aniden terk edilmiş şehirler",
  },
  {
    name: "Okyanus & Derin Deniz",
    brief:
      "okyanusun keşfedilmemiş tarafı: derinlerden gelen kaydedilmiş sesler, iz " +
      "bırakmadan kaybolan gemiler, derin deniz canlıları, haritalanmamış bölgeler, " +
      "su altında bulunan yapılar, batıklar",
  },
  {
    name: "Antik Teknoloji & Anlaşılamayan Eserler",
    brief:
      "çağının çok ötesinde görünen buluntular: nasıl yapıldığı bilinmeyen yapılar, " +
      "işlevi çözülemeyen aletler, imkânsız görünen taş işçiliği, döneminde olmaması " +
      "gereken hassasiyetteki nesneler",
  },
  {
    name: "Dünyanın Tuhaf & Yasak Yerleri",
    brief:
      "girilmesi yasak bölgeler, terk edilmiş şehirler, açıklanamayan coğrafi " +
      "anormallikler, pusulanın şaştığı alanlar, kimsenin yaşamadığı adalar, " +
      "kapalı tutulan tesisler",
  },
  {
    name: "Açıklanamayan Olaylar & Kayboluşlar",
    brief:
      "belgelenmiş kayboluşlar ve tekrar eden tuhaf olaylar: iz bırakmadan yok olan " +
      "insanlar ve uçaklar, çözülemeyen vakalar, yıllarca tekrarlanan gizemli sinyaller, " +
      "kimliği belirlenemeyen kayıtlar",
  },
  {
    name: "Doğanın Açıklanamayanları",
    brief:
      "doğada gözlemlenen ama tam açıklanamayan olaylar: tuhaf ışıklar, hayvanların " +
      "anlaşılamayan davranışları, olağandışı hava olayları, renk değiştiren göller, " +
      "kendiliğinden hareket eden kayalar",
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
  // Reddedilen adayların süreleri; isteme "bu kadar uzundu, kıs" diye geri veriliyor.
  const uzunMetinler = [];
  const kisaMetinler = [];
  const bosKapanislar = [];

  const buildPrompt = () => `
Sen Türkçe konuşan bir YouTube Shorts kanalı için içerik yazarısın.
Kanalın formatı: gerçekten yaşanmış ama BUGÜN HÂLÂ AÇIKLANAMAYAN bir olayı anlatan
20-28 saniyelik kısa bir seslendirme metni. Ton: merak uyandıran, sakin, iddialı değil.

ÇOK ÖNEMLİ - GÜVENİLİRLİK: Olay GERÇEK ve kayıtlı olmalı. Uydurma vaka, sahte
tarih, uydurma isim veya "bilim insanları şok oldu" tarzı abartı YAZMA. Gizem,
olayın kendisinden gelmeli; süslemeden değil. Komplo teorisi anlatma, doğrulanmış
olguyu anlat ve neyin açıklanamadığını söyle.

DETAY DOĞRULUĞU (bu kural ihlal edilirse video çöp olur): Yer adı, tarih, sayı ve
isimleri yalnızca EMİN olduğun durumda yaz. Emin değilsen o detayı hiç verme -
yanlış bilgi vermektense az bilgi ver. Yanlış bir detay ("Atlantik'te batan gemi
için Pasifik demek" gibi) videoyu bilen izleyicinin gözünde bitirir ve yorumlarda
düzeltilir.
Bu yüzden ÇOK İYİ BELGELENMİŞ, yaygın olarak bilinen vakaları seç; belirsiz veya
tek kaynaklı hikâyelere girme. Coğrafyayı yazmadan önce bir daha düşün.

${
  cliTopic
    ? `Konu şu olacak: "${cliTopic}".`
    : `Bu videonun kategorisi KESİNLİKLE şu olacak: "${category.name}".
Bu kategoride şunlar işlenir: ${category.brief}.
Bu kategori içinde, geniş kitleye hitap eden, şaşırtıcı ve SPESİFİK bir olay seç
(genel bir konu değil, belirli bir vaka: "okyanus gizemleri" değil, "1997'de
kaydedilen Bloop sesi" gibi).

GÖRSEL BULUNABİLİRLİK ŞARTI: Seçtiğin olay, ücretsiz stok video kütüphanelerinde
(Pexels/Pixabay) karşılığı bulunan bir ORTAM veya NESNE etrafında geçmeli -
uzay/yıldızlar, gezegen, ay, teleskop, derin okyanus, dalga, sis, orman, çöl,
mağara, antik kalıntı, taş yapı, eski harita, eski kitap, terk edilmiş bina,
buzul, fırtına, gece gökyüzü gibi. Görsel karşılığı olmayan tamamen soyut bir
olay seçme; ekranda gösterilecek bir şey kalmıyor.

Bu kategoride DAHA ÖNCE İŞLENMİŞ konular. Bunları ne aynen ne de başka kelimelerle
tekrar etme; aynı nesne/eylem etrafında dönen bir varyasyon da sayılır, tamamen
başka bir alt konuya geç:
${JSON.stringify(promptTopicList, null, 0)}`
}${
  bosKapanislar.length > 0
    ? `

DİKKAT - KAPANIŞ: Önceki denemende "gizem_metni" bir EKSİKLİK bildirerek bitti
(${JSON.stringify(bosKapanislar[bosKapanislar.length - 1].slice(-60))}).
Bu, videoyu bir yere bağlamadan bitiriyor. SON CÜMLE bir OLGU bildirmeli:
bulunan ama açıklanamayan bir nesne, kayıtlardaki bir çelişki, bugün hâlâ
devam eden somut bir durum. "bilinmiyor / bulunamadı / kanıtlanamadı /
çözülemedi" gibi bir fiille BİTİRME.`
    : ""
}${
  kisaMetinler.length > 0
    ? `

DİKKAT - FAZLA KISA: Önceki denemelerinde metin çok kısaydı (${kisaMetinler.join(
        ", "
      )} saniye; hedef ${HEDEF_MIN_SANIYE}-${HEDEF_MAKS_SANIYE} saniye). Hikâye
kurulmadan bitiyor ve izleyici "ne olmuş?" diye soruyor. Bu sefer olayın ÖLÇEĞİNİ
(kaç kişi, ne kadar büyük) ve açıklanamayan SOMUT detayı ekleyerek genişlet.
Dolgu cümlesi ekleme; eksik olan bilgiyi ekle.`
    : ""
}${
  uzunMetinler.length > 0
    ? `

DİKKAT - UZUNLUK: Önceki denemelerinde metin çok uzundu (${uzunMetinler.join(
        ", "
      )} saniye; hedef ${HEDEF_MAKS_SANIYE} saniyenin altı). Bu sefer BELİRGİN
şekilde kısalt: cümle sayısını azalt, sıfatları ve ara açıklamaları at, yıl/sayı
kullanımını en fazla bire indir. Bilgiyi koru, süslemeyi at.`
    : ""
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
1. "hook_metni"  -> ilk 1.5-2.5 saniye. İzleyicinin parmağını durduran açılış.
2. "olay_metni"  -> NE OLDU. İzleyici bu bölümü okuyunca olayı tam olarak
   anlamış olmalı. Zorunlu unsurlar: ne zaman, NEREDE (doğru yer adı), ne oldu ve
   ÖLÇEĞİ - kaç kişi, ne kadar büyük, ne kadar sürdü. İnsan varsa mutlaka söyle;
   "bir denizaltı kayboldu" değil, "99 mürettebatıyla birlikte kayboldu".
3. "gizem_metni" -> NEDEN hâlâ açıklanamıyor. Gerilimin zirvesi burası.
   En az BİR somut ve tuhaf detay ver (bulunan bir nesne, kaydedilen bir ses,
   tarihlerin tutmaması, bir tanığın ifadesi gibi) ve denenen açıklamalardan
   birini adıyla söyleyip neden yetersiz kaldığını belirt.
4. "cta_metni"   -> beğen + abone daveti.

HOOK KURALLARI (en kritik kısım - videonun izlenip izlenmemesini bu belirler):
- EN FAZLA 9 KELİME, TEK cümle. Bu sınır önemli: hook seslendirmede 2.5 saniyeyi
  geçerse izleyici cevaba varmadan kaydırıyor. Uzun yazma.
- SAYI/TARİH UYARISI: hook'ta yıl veya büyük sayı geçiyorsa EN FAZLA 7 KELİME yaz.
  "1997" yazıda tek kelimedir ama seslendirmede "bin dokuz yüz doksan yedi" olarak
  okunur ve 4-5 kelimelik süre yer. Yılı hook'ta vermek yerine "olay_metni"ne
  bırakabilirsin; hook'ta "yıllar önce", "on yıl boyunca" gibi kısa ifadeler yeterli.
- Bir "merak boşluğu" açsın: izleyici cevabı öğrenmek için kalmak zorunda hissetsin.
- İşe yarayan kalıplar: imkânsız görünen olgu ("Bu sinyal 40 yıldır her gün
  tekrarlıyor ve kaynağı bilinmiyor."), sayı + zaman ("150 yıldır aynı yerde
  görülüyor."), yer + tuhaflık ("Bu adaya kimse ayak basamıyor.").
- İçinde SOMUT bir dayanak geçsin: yer adı, süre, ölçek veya sayı. "İnanılmaz bir
  gizem" gibi boş cümle YAZMA - merakı kuran şey somutluktur.
- Hook bir ÇELİŞKİ ya da CEVAPSIZ SORU kurmalı, olayı tarif etmemeli.
  Kötü: "Bu nükleer denizaltı okyanusun dibinde sessizce yatıyor." (sadece tarif,
  ortada soru yok, "bu" neyi işaret ettiği belirsiz)
  İyi: "99 kişilik bir denizaltı, mürettebatı fark etmeden batmış olamaz."
- "Bu", "şu", "o" ile başlama; izleyici neden bahsettiğini bilmiyor. Neyden
  bahsettiğini ilk cümlede söyle.
- "Merhaba arkadaşlar", "Bugün sizlere", "Hadi başlayalım" gibi ısınma cümlesi YASAK.
- Cevabı hook'ta VERME; sadece merakı aç. Zaten kesin cevap yok - bunu avantaja çevir.
- "hook_ekran_metni": aynı hook'un ekranda dev punto yazılacak 2-5 kelimelik hali
  (tamamı büyük harf değil, normal yazım; ör. "40 yıldır susmayan sinyal").

ANLATIM TARZI (hook'tan sonraki bölümler için):
- Bağırmayan, sakin ama gerilimi tutan bir belgesel dış ses tonu: abartmadan,
  olguyu sırayla açarak. "İnanılmaz", "şok edici", "bilim insanları hayrete düştü"
  gibi klişe ve ünlem kullanma; gerilimi olayın kendisi taşısın.
- Sayı, tarih ve yer adı kullan - inandırıcılığı ve merakı asıl bunlar kurar.
- Geçişler doğal olsun: "Kayıtlara göre...", "Üç açıklama denendi...",
  "Ama bir sorun var:" gibi.
- Kısa cümleler ve akıcı bir ritim korunsun, Shorts'a uygun olsun.

Kurallar:
- "olay_metni" 2 cümle, "gizem_metni" 2 cümle. hook + olay + gizem toplamı
  65-78 kelime civarı olsun (29-34 saniye). Bu ALT sınır da bir hedeftir:
  daha kısa yazarsan hikâye kurulmadan bitiyor ve izleyici "ne olmuş?" diye
  soruyor. Anlaşılmayan kısa video, anlaşılan uzun videodan daha kötü tutulur.
  Sayı ve tarihleri sayarken dikkat: "1997" ve "150.000" tek kelime görünür ama
  seslendirmede 4-5 kelimelik süre alır. Metinde her yıl/büyük sayı için kendine
  4 kelime saymış gibi davran ve toplamı ona göre kıs. Video başına EN FAZLA
  iki tarih/büyük sayı kullan - fazlası hem süreyi şişiriyor hem anlatımı boğuyor.
  Neden bu kadar kısa: Shorts'ta en güçlü sıralama sinyali, videonun sonuna kadar
  izlenip başa dönmesidir (loop). 25 saniyelik video tamamlanıp döner; 45 saniyelik
  video ortasında bırakılır. Anlatımı sıkıştır: süsleme ve dolgu cümlesi at,
  bilgiyi bırak.
- "gizem_metni" CEVAPSIZ bitsin ama BOŞ bitmesin. Soruyu açık bırakmak hem yorum
  getirir hem videoyu baştan izletir (loop).
  YASAK: sadece olumsuz cümlelerle bitirmek. "Kanıt bulunamadı. İz yoktu. Açıklama
  yapılamadı." gibi arka arkaya üç olumsuz, izleyiciye tutunacak hiçbir şey
  bırakmıyor ve video "bir yere bağlanmadan" bitiyor.
  Onun yerine son cümle SOMUT ve TUHAF bir olguyu söylesin: bulunan ama
  açıklanamayan bir nesne, kayıtlardaki bir çelişki, hâlâ devam eden bir durum.
  İyi kapanış: "Enkazın ilk parçası, geminin rotasının 600 kilometre uzağında
  bulundu." Kötü kapanış: "Sebebi bugün hâlâ bilinmiyor."
BAŞLIK (title) KURALLARI - feed'de tıklanmayı bu belirler:
- EN FAZLA 50 KARAKTER. Shorts feed'inde başlık bu uzunluktan sonra kırpılıyor;
  vaadin kırpılan kısımda kalması tıklamayı doğrudan öldürür.
- Somut dayanak mutlaka geçsin: yer adı, tarih, sayı veya nesne adı. "İnanılmaz
  bir gizem" gibi her videoya uyabilecek başlık YAZMA.
- Cevabı başlıkta VERME; hook ile aynı merak boşluğunu taşısın.
- İşe yarayan kalıplar (birini seç, hepsini birden kullanma):
  "<Yer/Nesne>: <süre> yıldır çözülemedi", "<Olay> neden hâlâ açıklanamıyor?",
  "<Sayı> yıl önce kaydedildi, kaynağı bilinmiyor", "<Yer>'de kimsenin
  açıklayamadığı <şey>"
- Sonuna TEK emoji ekle (konuyla ilgili olsun), en fazla bir tane.
- Başlıkta TAMAMI büyük harf kelime kullanma; feed'de spam algılanıyor.

AÇIKLAMA (description):
- 2-3 cümle. İLK CÜMLE en kritik: insanların YouTube'da bu olayı ararken yazacağı
  ifade birebir geçsin (ör. "bloop sesi nedir", "voynich el yazması çözüldü mü").
  Arama sonuçlarında eşleşme buradan kuruluyor.
- İkinci cümlede olayın ne zaman/nerede gerçekleştiğini yaz.

ETİKETLER (tags) - 10-14 adet, şu üç grubu KARIŞTIRARAK ver:
- 4-5 adet DAR/uzun kuyruk terim: kullanıcının arama kutusuna yazacağı tam ifade
  ("bloop sesi nedir", "voynich el yazması gizemi").
- 3-4 adet ORTA terim: olayın adı + alan ("okyanus gizemi", "çözülemeyen şifre").
- 3-4 adet GENİŞ terim: kanalın genel alanı ("gizem", "açıklanamayan olaylar",
  "uzay gizemleri", "bilinmeyen tarih").
- Etiketler Türkçe olsun ve hiçbiri diğerinin birebir tekrarı olmasın.
GÖRSEL/STOK VİDEO TERİMLERİ (bu kısım kritik - yanlış terim, konuyla alakasız
arka plan videosuna yol açıyor):

TEMEL KURAL: Bu kanalın konuları soyut olabilir (bir sinyal, bir kayboluş, bir
şifre), ama EKRANDA GÖSTERİLECEK ŞEY SOMUT OLMAK ZORUNDA. Olayın geçtiği ORTAMI
veya olayla ilişkili NESNEYİ ara; olayın kendisini betimlemeye çalışma.
Örnek: konu "okyanus derinliğinden gelen açıklanamayan ses" ise "mysterious sound"
diye bir klip YOKTUR; "deep ocean", "underwater dark", "ocean waves" vardır.

Aşağıdaki görsel dağarcık stok kütüphanelerinde BOL ve bu kanalın konularına uyar.
Terimleri mümkün olduğunca bunların içinden veya bunlara yakın seç:
  uzay/gökyüzü: "night sky", "starry sky", "milky way", "deep space", "nebula",
    "galaxy", "planet earth", "moon surface", "full moon", "telescope",
    "satellite orbit", "solar eclipse", "aurora sky"
  okyanus/su: "deep ocean", "underwater dark", "ocean waves", "stormy sea",
    "coral reef", "diver underwater", "shipwreck underwater", "foggy lake"
  tarih/antik: "ancient ruins", "stone temple", "old manuscript", "old map",
    "ancient statue", "pyramid desert", "cave painting", "old book pages",
    "candle light", "medieval castle"
  atmosfer/gizem: "foggy forest", "dark forest", "abandoned building",
    "empty corridor", "desert dunes", "ice glacier", "cave interior",
    "lightning storm", "rain window", "smoke dark"

- "stok_arama_terimleri": TAM OLARAK 5 elemanlı İngilizce dizi. Sıra ÖNEMLİ, çünkü
  her eleman videonun belirli bir bölümünde ekranda görünecek:
    [0] KANCA bölümü         → olayın geçtiği ortamı kuran genel/geniş sahne
    [1] OLAY bölümü          → olayla doğrudan ilişkili nesne veya mekân
    [2] AÇIKLANAMAYAN bölümü → gerilimi taşıyan sahne (karanlık, derinlik, boşluk)
    [3] AÇIKLANAMAYAN bölümü → aynı atmosferin başka bir açısı
    [4] KAPANIŞ              → geniş, sakin, düşündüren kapanış sahnesi
  [2] ve [3] EN KRİTİK OLANLAR: gerilimin zirvesi orada, ekranın da o hissi
  taşıması gerekiyor.
  HER TERİM EN FAZLA 3 KELİME OLSUN. Bu sınır kritik: stok kütüphanelerinde
  "unexplained radio signal from space" gibi bir klip YOKTUR, ama "radio telescope"
  ve "deep space" vardır. Uzun ve cümle gibi yazılmış terimler hiçbir sonuç
  getirmiyor ve sahne genel bir yedek klibe düşüyor.
  Beş terim birbirinden GÖRSEL OLARAK farklı olsun; hepsi "night sky" olursa video
  tek düze görünür.
- "stok_yedek_terimleri": TAM OLARAK 5 elemanlı İngilizce dizi; her eleman
  "stok_arama_terimleri" içindeki AYNI SIRADAKİ terimin daha genel yedeği olsun.
  Her biri 1-2 kelime ve stok kütüphanelerinde kesinlikle sonuç veren yaygın bir
  sahne olmalı (yukarıdaki dağarcıktan seçmek en güvenlisi). Yine de konunun
  atmosferini taşımalı: "radio telescope" için yedek "night sky" olur,
  "person working" OLMAZ.
  Bu alan, spesifik terim tutmadığında o sahnenin kendi yedeğine düşmesini sağlar;
  yoksa tutmayan tüm sahneler aynı klibi paylaşıp video tekrara düşüyor.
- "stok_zorunlu_kelimeler": 2-4 elemanlı İngilizce TEK KELİMELİK isim dizisi. Bunlar
  konunun görsel çekirdeğidir; bir stok klip bunlardan HİÇBİRİNİ içermiyorsa o klip
  konuyla alakasızdır ve kullanılmayacaktır. Somut nesne/mekân adı ver.
  Örnek - konu "uzaydan gelen tekrarlayan sinyal" ise: ["space","sky","star","telescope"].
  Örnek - konu "okyanusta kaybolan gemi" ise: ["ocean","sea","ship","water"].
  Örnek - konu "çözülemeyen antik el yazması" ise: ["manuscript","book","paper","ancient"].
  "person", "nature", "background" gibi her videoya uyan genel kelimeler YAZMA.
- "stok_genel_terim": 2 kelimelik İngilizce yedek sorgu. Spesifik terimler sonuç
  vermezse bu kullanılır; yukarıdaki dağarcıktan konuya en yakın olanı seç
  (ör. "night sky", "deep ocean", "ancient ruins").
- "cta_metni": videonun EN SONUNDA söylenecek, sıcak ve samimi tek bir Türkçe cümle.
  EN FAZLA 5 KELİME. Mutlaka "beğen" ve "abone ol" fiillerini (veya eş anlamlılarını)
  içersin. Örnek uzunluk: "Beğen ve abone ol." / "Abone ol, kaçırma." Her seferinde farklı kelimelerle yaz, kalıplaşmış cümleyi tekrar etme.
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
  "olay_metni": "...",
  "gizem_metni": "...",
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

  // --- Süre ölçüsü ---------------------------------------------------
  // Ham kelime sayısı süreyi olduğundan kısa gösteriyor: "1997" yazıda tek
  // kelime ama seslendirmede "bin dokuz yüz doksan yedi" olarak okunuyor ve
  // 4-5 kelimelik süre alıyor. Bu kanalın konuları tarih/sayı ağırlıklı olduğu
  // için fark birikiyor. Sayıları ağırlıklandırıp gerçek süreye yaklaşıyoruz.
  const SAYI_AGIRLIGI = 4;
  // Bu sabit tahminden değil, üretilen videoların ölçülmesinden geldi:
  // 64 ağırlıklı kelime -> 28.7 saniye.
  const KELIME_PER_SANIYE = 2.2;
  const HEDEF_MAKS_SANIYE = 35;
  // Alt sınır da denetleniyor: fazla kısa metin hikâyeyi kuramadan bitiriyor.
  const HEDEF_MIN_SANIYE = 26;

  const kelimeler = (t) => String(t || "").trim().split(/\s+/).filter(Boolean);
  const kelimeSay = (t) => kelimeler(t).length;
  const agirlikliSay = (t) =>
    kelimeler(t).reduce((toplam, k) => {
      const rakamlar = k.replace(/[^0-9]/g, "");
      return toplam + (rakamlar.length >= 3 ? SAYI_AGIRLIGI : 1);
    }, 0);
  // Kapanış denetimi. "Bir yere bağlanmadan bitiyor" sorununun kaynağı, son
  // cümlenin bir OLGU değil bir EKSİKLİK bildirmesi: "kaynağı bilinmiyor",
  // "kanıtlanamadı", "çözülemedi". İzleyiciye tutunacak bir şey bırakmıyor.
  // İstemde yasaklamak yetmedi; ölçüp reddediyoruz.
  const BOS_KAPANIS =
    /(bilinmiyor|bulunamad|a[çc][ıi]klanamad|kan[ıi]tlanamad|[çc][öo]z[üu]lemed|s[ıi]r olarak kald|cevap aran|belirlenemed|tespit edilemed)\p{L}*[.!?]?\s*$/iu;

  const bosKapanisMi = (c) => {
    const metin = String(c?.gizem_metni || "").trim();
    if (!metin) return false;
    const cumleler = metin.split(/(?<=[.!?])\s+/).filter(Boolean);
    return BOS_KAPANIS.test(cumleler[cumleler.length - 1] || "");
  };

  const tahminiSure = (c) =>
    [c?.hook_metni, c?.olay_metni, c?.gizem_metni].reduce(
      (t, b) => t + agirlikliSay(b),
      0
    ) / KELIME_PER_SANIYE;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = extractJson(await callGemini(buildPrompt()));

    if (cliTopic) {
      parsed = candidate;
      break;
    }

    const duplicate = findDuplicate(candidate.topic, allPreviousTopics);
    const sure = tahminiSure(candidate);

    // Metnin uzunluğunu isteme yazmak yetmiyor: model sınırı düzenli olarak
    // aşıyor ve video loop bandının dışına çıkıyor. Ölçüp reddediyoruz.
    const bosKapanis = bosKapanisMi(candidate);

    if (
      !duplicate &&
      !bosKapanis &&
      sure <= HEDEF_MAKS_SANIYE &&
      sure >= HEDEF_MIN_SANIYE
    ) {
      parsed = candidate;
      break;
    }

    // Hedef bandın ortasına en yakın adayı elde tutuyoruz: hiçbir deneme
    // sınırı tutturamazsa en azından en dengelisini yayınlarız.
    const hedefOrta = (HEDEF_MIN_SANIYE + HEDEF_MAKS_SANIYE) / 2;
    const uzaklik = (c) => Math.abs(tahminiSure(c) - hedefOrta);
    if (!parsed || uzaklik(candidate) < uzaklik(parsed)) parsed = candidate;

    if (duplicate) {
      rejectedTopics.push(candidate.topic);
      console.warn(
        `⚠️  "${candidate.topic}" daha önceki "${duplicate}" konusuyla fazla benzer ` +
          `(deneme ${attempt}/${MAX_ATTEMPTS}), yeniden üretiliyor...`
      );
    } else if (bosKapanis) {
      bosKapanislar.push(candidate.gizem_metni);
      console.warn(
        `⚠️  Kapanış boş bitiyor ("...${candidate.gizem_metni
          .trim()
          .slice(-45)}") ` +
          `(deneme ${attempt}/${MAX_ATTEMPTS}), somut kapanışla yeniden üretiliyor...`
      );
    } else if (sure > HEDEF_MAKS_SANIYE) {
      uzunMetinler.push(Math.round(sure));
      console.warn(
        `⚠️  Metin ~${Math.round(sure)} sn, hedef ${HEDEF_MIN_SANIYE}-${HEDEF_MAKS_SANIYE} sn ` +
          `(deneme ${attempt}/${MAX_ATTEMPTS}), kısaltılarak yeniden üretiliyor...`
      );
    } else {
      kisaMetinler.push(Math.round(sure));
      console.warn(
        `⚠️  Metin ~${Math.round(sure)} sn ile fazla kısa, hedef ${HEDEF_MIN_SANIYE}-${HEDEF_MAKS_SANIYE} sn ` +
          `(deneme ${attempt}/${MAX_ATTEMPTS}), genişletilerek yeniden üretiliyor...`
      );
    }
  }

  if (rejectedTopics.length === MAX_ATTEMPTS) {
    console.warn(
      "⚠️  3 denemede de yeterince farklı bir konu üretilemedi. Kategori havuzu " +
        "tükeniyor olabilir: CATEGORY_FILTER'a bir kategori daha eklemeyi düşün."
    );
  }

  // Model hook'u atlarsa video eski (kancasız) haline düşmesin diye
  // yanlış metninin ilk cümlesini hook'a terfi ettiriyoruz.
  if (!parsed.hook_metni && parsed.olay_metni) {
    const firstSentence = parsed.olay_metni.split(/(?<=[.!?])\s+/)[0];
    parsed.hook_metni = firstSentence;
    parsed.olay_metni = parsed.olay_metni.slice(firstSentence.length).trim();
    console.warn("⚠️  Model hook üretmedi, ilk cümle hook'a terfi ettirildi.");
  }
  if (!parsed.hook_ekran_metni) {
    parsed.hook_ekran_metni = parsed.title || parsed.topic || "";
  }

  // Süre denetimi: model kelime sınırını aşarsa video loop bandının dışına
  // çıkıyor ve tamamlanma oranı düşüyor. Sessizce geçmesin.
  //
  // Ham kelime sayısı süreyi olduğundan kısa gösteriyor: "1997" yazıda tek
  // kelime ama seslendirmede "bin dokuz yüz doksan yedi" olarak okunuyor ve
  // 4-5 kelimelik süre alıyor. Bu kanalın konuları tarih ve sayı ağırlıklı
  // olduğu için fark birikiyor (ölçülen bir örnekte 63 kelime 30 saniye sürdü).
  // Sayıları ağırlıklandırıp gerçek süreye yakın bir tahmin üretiyoruz.
  const bolumler = [parsed.hook_metni, parsed.olay_metni, parsed.gizem_metni];
  const konusmaKelime = bolumler.reduce((t, b) => t + kelimeSay(b), 0);
  const agirlikli = bolumler.reduce((t, b) => t + agirlikliSay(b), 0);
  const tahminSn = Math.round(agirlikli / KELIME_PER_SANIYE);

  const hookAgirlik = agirlikliSay(parsed.hook_metni);
  if (hookAgirlik > 12) {
    console.warn(
      `⚠️  Hook ağır: ${kelimeSay(parsed.hook_metni)} kelime ama ` +
        `~${(hookAgirlik / KELIME_PER_SANIYE).toFixed(1)} sn sürecek (hedef 2.5 sn). ` +
        "Muhtemelen içinde yıl/sayı var; hook kartı fazla uzun ekranda kalacak."
    );
  }

  if (tahminSn > HEDEF_MAKS_SANIYE) {
    console.warn(
      `⚠️  Metin ~${tahminSn} sn (${konusmaKelime} kelime, sayılar ağırlıklı). ` +
        "Hedef 20-28 sn; video loop bandının dışına çıkabilir."
    );
  } else {
    console.log(`   Metin: ${konusmaKelime} kelime, ~${tahminSn} sn (sayılar ağırlıklı)`);
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
