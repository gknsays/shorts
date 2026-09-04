# Günlük Shorts Otomasyonu (Remotion + YouTube) — 100% Ücretsiz Sürüm

Bu proje her çalıştırıldığında:
0. **Arka plan müziğini** saf Node ile sentezler (indirme yok, telif riski yok — `public/music/` yoksa üretilir).
1. **Google Gemini API (ücretsiz)** ile "günlük hayatta yanlış yapılan bir iş ve doğrusu" temalı bir konu, **kanca (hook)**, seslendirme metni, YouTube başlığı/açıklama/etiketleri üretir. Konu, geçmiştekilerle benzerlik ölçülerek tekrar etmemesi sağlanır.
2. **Microsoft Edge TTS (ücretsiz, API anahtarı gerekmez)** ile metni dört ayrı bölüm halinde (KANCA → YANLIŞ → DOĞRU → ABONE OL), her bölümde biraz artan enerjiyle Türkçe seslendirmeye çevirir ve kelime kelime zaman damgası alır.
3. **Pexels (ücretsiz)**'ten konuya uygun 5 farklı dikey (9:16) stok video indirir.
4. **Remotion** ile dikey Shorts videosunu render eder: ilk ~2.5 saniyede ekranı kaplayan kanca kartı, konuşulan kelimenin renkli vurgulandığı (karaoke tarzı) altyazı, "YANLIŞ / DOĞRU" rozetleri, üstte ilerleme çubuğu, kapanışta abone animasyonu ve kısık arka plan müziği.
5. **YouTube Data API v3 (ücretsiz)** ile videoyu kanala Shorts olarak, Türkçe dil etiketiyle yükler.

`node scripts/run.mjs` bu adımları sırayla çalıştırır. `.github/workflows/daily-short.yml` ile bunu her gün otomatik tetikleyebilirsin (bilgisayarının açık olması gerekmez, GitHub'ın sunucularında ücretsiz çalışır).

**Bu kurulumda hiçbir adım için kredi kartı veya ödeme gerekmiyor.**

---

## Gerekli hesaplar/API'ler ve nasıl alınır

| # | Servis | Ne için kullanılıyor | Nereden alınır | Maliyet |
|---|--------|----------------------|------------------|---------|
| 1 | **Google Gemini API** | Konu/senaryo/başlık üretimi | [aistudio.google.com](https://aistudio.google.com/apikey) > Get API key | **Ücretsiz** (süresiz, kart istemiyor; Flash model günlük düşük hacimli kullanım için fazlasıyla yeterli) |
| 2 | **Microsoft Edge TTS** | Türkçe seslendirme + kelime zamanlaması | Hiçbir kayıt/anahtar gerekmiyor, kod içinde hazır | **Ücretsiz**, sınırsız |
| 3 | **Pexels API** | Telifsiz stok video | [pexels.com/api](https://www.pexels.com/api/) | **Ücretsiz**, anında key veriyor |
| 3b | **Pixabay API** | İkinci stok video kaynağı (opsiyonel ama önerilir) | [pixabay.com/api/docs](https://pixabay.com/api/docs/) | **Ücretsiz**, ticari kullanım serbest, atıf gerekmiyor |
| 4 | **YouTube Data API v3** | Videoyu kanala otomatik yükleme | Google Cloud Console (aşağıdaki adımlar) | **Ücretsiz** (günlük kota dahilinde; 1 video/gün bu kotanın çok altında) |

### YouTube Data API v3 kurulumu (adım adım)

1. [Google Cloud Console](https://console.cloud.google.com/) üzerinde yeni bir proje oluştur.
2. **APIs & Services > Library** kısmından **"YouTube Data API v3"**'ü bul ve **Enable** et. (Sadece bu tek API yeterli.)
3. **APIs & Services > OAuth consent screen**: "External" seç, uygulama adı gir, kendi Google hesabını "Test user" olarak ekle.
4. **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - Application type: **Desktop app**
   - Oluşturunca sana **Client ID** ve **Client Secret** verir → `.env` dosyasına yaz.
5. Bilgisayarında bir kere şunu çalıştır (tarayıcı açılır, kendi YouTube kanalınla giriş yapıp izin verirsin):
   ```bash
   npm run youtube-auth
   ```
   Bu işlem sonunda proje klasöründe bir `token.json` oluşur. **Bu dosyayı bir daha oluşturman gerekmez**, otomatik yüklemeler bunu kullanır.

> Not: OAuth consent screen "Testing" modundaysa refresh token 7 günde bir sıfırlanabilir. Kalıcı otomasyon için consent screen'i **"In production"** durumuna al (kişisel/tek kullanıcılı bir uygulama için Google'ın ekstra onayına gerek kalmadan, "Publish app" butonuna basman yeterli).

---

## Kurulum

```bash
npm install
cp .env.example .env
# .env dosyasına GEMINI_API_KEY, PEXELS_API_KEY, YT_CLIENT_ID, YT_CLIENT_SECRET gir
npm run youtube-auth   # tek seferlik YouTube izni
```

## Tek bir video üretip test etme (YouTube'a yüklemeden)

```bash
node scripts/run.mjs --no-upload
```

Konuyu kendin de verebilirsin:

```bash
node scripts/run.mjs "buzdolabında yiyecek saklama" --no-upload
```

Video `out/short.mp4` içinde oluşur. Beğenirsen `--no-upload` olmadan tekrar çalıştırıp doğrudan YouTube'a yükleyebilirsin.

Kompozisyonu canlı önizlemek istersen:

```bash
npm run preview
```

## Kanalın nişi (CATEGORY_FILTER)

YouTube bir kanalı bir kitleye oturtabilmek için **konu tutarlılığı** ister. 15 kategoriye birden yayılan bir kanalda algoritma "bunu kime göstereyim?" sorusuna cevap bulamaz ve gösterim vermez. Bu yüzden konu havuzu `.env` (veya Actions'ta repo variable) üzerinden daraltılabiliyor:

```
CATEGORY_FILTER=Ev Tamiratı & Tadilat,Araba Bakımı & Sürüş,Ev Güvenliği & Acil Durum Bilgisi
```

Bu üçlü bilinçli seçildi: üçü de **aynı izleyici profiline** hitap ediyor (evini ve arabasını kendi idare eden yetişkin), üçü de "yanlış yaparsan pahalıya patlar" temalı olduğu için izlenme oranı yüksek, ve Türkçe Shorts'ta mutfak/temizlik kadar doygun değiller. Arama trafiği de kalıcı: bir yıl sonra da izlenirler.

Boş bırakılırsa 15 kategorilik geniş havuz kullanılır. Geçerli kategori adları `scripts/generateScript.mjs` içindeki `ALL_CATEGORIES` listesinde.

`CHANNEL_TAGS` ise her videoya eklenen sabit etiketlerdir; YouTube'un videolarını birbiriyle ilişkilendirip "sonraki video" trafiği üretmesine yardım eder.

## Tam otomatik yayın (GitHub Actions — ücretsiz, günde 4 video)

Workflow günde **4 kez** tetikleniyor ve her tetiklemede yeni bir konu → seslendirme → video → YouTube yükleme döngüsü çalışıyor. Saatler Türkiye saatine (TRT, UTC+3) göre en yüksek etkileşim pencerelerine yerleştirildi:

| TRT saati | Neden seçildi |
|---|---|
| 13:00 | **Öğle arası zirvesi** — birden fazla bağımsız veri setinde (Buffer, Hootsuite, SocialPilot) Shorts izlenmesinin en yoğun olduğu pencere |
| 16:00 | **Öğleden sonra "altın saat"** — okul/iş çıkışı, kısa mola trafiği |
| 19:00 | **Akşam zirvesi** — eve dönüş, boş vakit başlangıcı |
| 21:30 | Akşam rahatlama saati, ikinci dalga izlenme |

**Neden 10 değil de 4?** Aynı kanaldan gün içinde çok sayıda video çıktığında YouTube her birine daha küçük bir başlangıç gösterim havuzu ayırır ve videolar birbirinin izleyicisini yer. Kanal oturmamışken doğru strateji, gösterimi az sayıda videoda yoğunlaştırıp izlenme oranını yukarı çekmektir. Videolar düzenli olarak 1000+ görüntülenmeye ulaşmaya başlayınca sıklığı kademeli artırabilirsin (önce 6, sonra 8).

Saatler `.github/workflows/daily-short.yml` içinde UTC cron olarak tanımlı; değiştirmek istersen dosyanın başındaki tabloyu kullanarak TRT → UTC çevirisini yapıp `cron:` satırlarını güncelle.

**Konu tekrarını önleme (iki katmanlı):**

1. *İstem katmanı*: Her çalıştırma `data/used-topics.json` dosyasını okuyup o kategoride işlenmiş **son 40 konuyu** Gemini'ye "bunları ne aynen ne de başka kelimelerle tekrar etme" diye iletiyor.
2. *Ölçüm katmanı*: Modele söylemek tek başına yetmiyor — aynı fikri farklı kelimelerle geri getirebiliyor. Bu yüzden üretilen konu, geçmişteki **tüm** konularla kelime kümesi üzerinden karşılaştırılıyor. Türkçe çekim eklerini eritmek için kelimeler ilk 5 harfe kırpılıyor ("süngeri" ≈ "süngerini" ≈ "süngerler"), sonra örtüşme oranı hesaplanıyor. %55'in üzerindeyse konu reddedilip, reddedilen konu isteme eklenerek yeniden üretiliyor (en fazla 3 deneme).

Geçmişte son **300** kayıt tutuluyor ve workflow bu dosyayı her çalıştırmadan sonra repoya geri commit'liyor (`chore: konu gecmisini guncelle [skip ci]`). Workflow'da ayrıca `concurrency` grubu var: iki çalıştırma aynı anda başlayıp aynı geçmişi okuyamaz.

1. Bu klasörü bir GitHub reposuna push'la (`.env` ve `token.json` **asla** commit'leme, `.gitignore` zaten engelliyor; `data/used-topics.json` ise bilinçli olarak takip ediliyor).
2. Repo **Settings > Secrets and variables > Actions** kısmına şu secret'ları ekle:
   - `GEMINI_API_KEY`, `GEMINI_MODEL`
   - `EDGE_TTS_VOICE`, `EDGE_TTS_RATE`
   - `PEXELS_API_KEY`
   - `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REDIRECT_URI`, `YT_PRIVACY_STATUS`
   - `YT_TOKEN_JSON` → kendi bilgisayarında oluşan `token.json` dosyasının **tüm içeriğini** buraya yapıştır.
3. Actions sekmesinden "Run workflow" ile bir kere elle tetikleyip ilk denemeyi kontrol et.

GitHub Actions'ın ücretsiz planı, herkese açık (public) repolarda **sınırsız**, özel (private) repolarda ise ayda **2.000 dakika** ücretsiz dakika veriyor. Bu otomasyon çalıştırma başına ~8-12 dakika sürüyor; günde 4 çalıştırma × ~10 dakika ≈ 40 dakika/gün, ayda ~1.200 dakika eder — bu haliyle **özel repoda da ücretsiz kotanın içinde kalır**. Sıklığı artırırsan bu hesabı yeniden yap.

Bundan sonra her gün otomatik olarak: 4 farklı konu → seslendirme → video → YouTube'a Shorts olarak yüklenir.

---

## Arka plan videolarının konu dışına çıkmaması

Stok video API'leri, sorguya uyan sonuç bulamadıklarında boş dönmek yerine "yakın" saydıkları popüler klipleri döndürür. Dönen sonucu alakalı varsaymak bu yüzden yanlıştır: limon konulu bir videoda hamur açma, soğan doğrama ve kayısı klipleri bu şekilde geliyordu.

`scripts/fetchBackground.mjs` bunu üç kademeyle engelliyor:

1. **Sert konu filtresi.** Gemini her konu için `stok_zorunlu_kelimeler` üretir (ör. limon konusunda `["lemon","citrus","juice"]`, uzatma kablosunda `["cable","cord","socket","plug"]`). Bir klibin açıklayıcı metninde — Pexels'te adres slug'ı, Pixabay'de etiketler — bu kelimelerden **en az biri geçmiyorsa klip elenir**, puanı ne olursa olsun.
2. **Kademeli arama.** Spesifik terim → genel konu terimi, her biri Pexels ve Pixabay üzerinde, önce dikey sonra her yön. Sorgu genişlese bile sert filtre her adımda uygulandığı için konu dışına çıkılmaz.
3. **Alakasız klip indirme yasağı.** Bir sahneye uygun yeni klip bulunamazsa onaylanmış kliplerden biri o sahnede tekrar kullanılır. Hiç uygun klip yoksa pipeline durur — konu dışı bir video yayınlamaktansa o gün video çıkmasın.

`orientation=portrait` kısıtı da gevşetildi: dikey stok havuzu küçük olduğu için dikeyde uygun sonuç yoksa yatay klipler aranıp 9:16'ya kırpılıyor. Konuya uygun yatay klip, alakasız dikey klipten iyidir.

## Video/tasarım özelleştirme

- Renkler, fontlar, rozet metinleri, kanca kartı, ilerleme çubuğu, abone animasyonu: `src/ShortVideo.tsx`
- Altyazı konumu/boyutu: `src/Captions.tsx` — `bottom` değeri özellikle önemli: Shorts arayüzü ekranın alt ~450px'ini (başlık, kanal adı, butonlar) kapatır, altyazı bunun altında kalmamalı
- Altyazı satır uzunluğu/kelime sayısı: `src/captionUtils.ts` (`MAX_WORDS_PER_LINE`, `MAX_CHARS_PER_LINE`)
- Senaryo formatı/prompt, kanca kuralları, başlık/etiket kuralları: `scripts/generateScript.mjs`
- Kanalın nişi: `.env` içindeki `CATEGORY_FILTER` ve `CHANNEL_TAGS`
- Arka plan müziği: `scripts/makeMusic.mjs` (akor dizisi, BPM, ton). Müzik indirilmiyor, saf Node ile sentezleniyor — ortada eser olmadığı için telif/Content ID riski yok. `public/music/` klasörü repoya girmez, çalıştırma anında üretilir (`npm run make-music`). Ses seviyesi `src/ShortVideo.tsx` içindeki `volume={0.07}`
- Seslendirme sesi/hızı: `.env` içindeki `EDGE_TTS_VOICE` (`tr-TR-EmelNeural` / `tr-TR-AhmetNeural`) ve `EDGE_TTS_RATE`
- Yükleme gizliliği (public/unlisted/private): `.env` içindeki `YT_PRIVACY_STATUS`

## Bilinen sınırlamalar

- Edge TTS resmi bir API değil, Microsoft Edge tarayıcısının arka planda kullandığı ücretsiz bir servisi kullanıyor. Şu ana kadar geniş bir topluluk tarafından güvenilir şekilde kullanılıyor, ancak Microsoft dilerse erişimi değiştirebilir/kısıtlayabilir — bu ihtimale karşı `scripts/generateVoice.mjs` dosyasını ElevenLabs gibi resmi (ücretli) bir servise kolayca çevirebilecek şekilde ayrı bir modül olarak tuttum.
- Gemini API'nin ücretsiz katmanında dakika/gün bazlı istek limitleri var; günde 1 video üretimi bu limitlerin çok altında kalır.
- YouTube, yeni yüklenen kanallarda otomasyon/spam şüphesiyle videoları sınırlayabilir; ilk günlerde `YT_PRIVACY_STATUS=unlisted` ile test edip sonra `public`'e geçmen önerilir.
