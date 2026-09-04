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
    name: "Mutfak & Yemek Hazırlama",
    brief:
      "yemek pişirme teknikleri, malzeme saklama, mutfak aleti kullanımı, tazelik ve gıda güvenliği",
  },
  {
    name: "Ev Tamiratı & Tadilat",
    aliases: ["Ev Tamiratı & Basit DIY"],
    brief:
      "ev tadilatı ve tamirat işleri: boya-badana, alçı/duvar onarımı, fayans ve derz, silikon çekme, " +
      "musluk/sifon/tesisat, kapı-pencere ayarı, dübel-vida-matkap kullanımı, elektrik prizi ve anahtar, " +
      "parke/laminat, rutubet ve küf. Amatörün ustadan öğreneceği, işi baştan doğru yapmayı gösteren " +
      "öğretici konular seç; usta çağırmadan çözülebilen ama yanlış yapıldığında pahalıya patlayan işler ideal",
  },
  {
    name: "Ev Temizliği",
    brief: "temizlik ürünleri, yüzey bakımı, leke çıkarma, beyaz eşya temizliği",
  },
  {
    name: "Teknoloji & Telefon Kullanımı",
    brief: "telefon/bilgisayar ayarları, batarya, depolama, güvenlik, internet",
  },
  {
    name: "Sağlık & Günlük Alışkanlıklar",
    brief: "uyku, duruş, su tüketimi, günlük rutinler (tıbbi tavsiye değil, genel bilgi)",
  },
  {
    name: "Para & Bütçe Yönetimi",
    brief: "fatura, alışveriş, tasarruf, abonelik yönetimi",
  },
  {
    name: "Ev Düzeni & Depolama",
    brief: "dolap düzeni, saklama kapları, küçük alan kullanımı",
  },
  {
    name: "Çamaşır & Kıyafet Bakımı",
    brief: "yıkama programları, kumaş bakımı, kurutma, ütü, leke",
  },
  {
    name: "Araba Bakımı & Sürüş",
    brief:
      "araç bakımı ve sürüş: lastik basıncı ve diş derinliği, motor yağı ve filtre, akü ve şarj, " +
      "fren balatası, cam suyu ve silecek, klima ve polen filtresi, rölanti, debriyaj ve vites " +
      "kullanımı, yakıt tasarrufu, kış/yaz hazırlığı, yıkama ve boya bakımı. Servise gitmeden " +
      "yapılabilen ama yanlış yapıldığında pahalı arızaya yol açan işler öncelikli",
  },
  {
    name: "Bahçe & Bitki Bakımı",
    brief: "sulama, saksı, toprak, gübre, budama, iç mekan bitkileri",
  },
  {
    name: "Seyahat & Bavul Hazırlama",
    brief: "bavul düzeni, uçak kuralları, seyahat hazırlığı",
  },
  {
    name: "Kişisel Bakım & Güzellik",
    brief: "cilt, saç, tıraş, diş bakımı, ürün kullanımı",
  },
  {
    name: "Ofis & Verimlilik",
    brief: "masa düzeni, klavye kısayolları, zaman yönetimi, e-posta",
  },
  {
    name: "Elektronik Cihaz & Şarj Aletleri Bakımı",
    brief: "şarj alışkanlıkları, kablo bakımı, cihaz ömrü, ısınma",
  },
  {
    name: "Ev Güvenliği & Acil Durum Bilgisi",
    brief:
      "evdeki güvenlik ve acil durumlar: elektrik tesisatı ve sigorta, uzatma kablosu ve priz yükü, " +
      "doğalgaz ve kombi, su kaçağı ve vana kapatma, yangın söndürücü ve duman dedektörü, " +
      "çamaşır/bulaşık makinesi hortumu, tüp ve ocak güvenliği, deprem hazırlığı. " +
      "Çoğu insanın farkında olmadan risk aldığı, tamirat bilgisiyle iç içe geçen konular seç",
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

async function callGemini(prompt, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9 },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    const isOverloaded = res.status === 503 || res.status === 429;
    if (isOverloaded && attempt < 5) {
      const waitSeconds = attempt * 8; // 8s, 16s, 24s, 32s
      console.log(
        `Gemini şu an yoğun (${res.status}). ${waitSeconds} saniye sonra tekrar denenecek (deneme ${attempt}/5)...`
      );
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      return callGemini(prompt, attempt + 1);
    }
    throw new Error(`Gemini API hatası (${res.status}): ${text}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("");
  if (!text) throw new Error("Gemini boş yanıt döndü: " + JSON.stringify(data));
  return text;
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
anlatan 30-45 saniyelik kısa bir seslendirme metni.

${
  cliTopic
    ? `Konu şu olacak: "${cliTopic}".`
    : `Bu videonun kategorisi KESİNLİKLE şu olacak: "${category.name}".
Bu kategoride şunlar işlenir: ${category.brief}.
Bu kategori içinde, geniş kitleye hitap eden, şaşırtıcı ve pratik, spesifik bir alt konu bul.

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
- "yanlis_metni" 2-3 cümle, "dogru_metni" 2-3 cümle. hook + yanlış + doğru toplamı
  75-110 kelime civarı olsun (30-45 saniye).
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
- "stok_arama_terimleri": TAM OLARAK 5 elemanlı İngilizce dizi. Her eleman, metinde
  anlatılan FARKLI bir görsel anı betimleyen 2-4 kelimelik stok video sorgusu olsun.
  Terimler stok video kütüphanelerinde GERÇEKTEN bulunabilecek, yaygın sahneler olsun;
  aşırı spesifik/sinematik tarifler ("hand rolling lemon counterclockwise") yazma.
  Her terimin içinde konunun ana nesnesi geçsin.
- "stok_zorunlu_kelimeler": 2-4 elemanlı İngilizce TEK KELİMELİK isim dizisi. Bunlar
  konunun görsel çekirdeğidir; bir stok klip bunlardan HİÇBİRİNİ içermiyorsa o klip
  konuyla alakasızdır ve kullanılmayacaktır. Geniş değil, somut nesne/mekan adı ver.
  Örnek - konu "uzatma kablosunun sarılı kullanılması" ise: ["cable","cord","socket","plug"].
  Örnek - konu "banyo silikonunun küflenmesi" ise: ["bathroom","tile","shower","caulk"].
  "person", "home", "work" gibi her videoya uyan genel kelimeler YAZMA.
- "stok_genel_terim": 2 kelimelik İngilizce yedek sorgu. Spesifik terimler sonuç
  vermezse bu kullanılır, ama yine konuyu temsil etmeli (ör. "electrical socket",
  "bathroom tiles", "car tire").
- "cta_metni": videonun EN SONUNDA söylenecek, sıcak ve samimi tek bir Türkçe cümle
  (8-14 kelime). Mutlaka "beğen" ve "abone ol" fiillerini (veya eş anlamlılarını) içersin.
  Her seferinde farklı kelimelerle yaz, kalıplaşmış cümleyi tekrar etme.

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
