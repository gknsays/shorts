// src/visualTheme.ts
// Görsel odaklı formatların (Sıralama, Quiz) ortak tasarım dili.
//
// NEDEN AYRI BİR DOSYA: Bu formatların tamamı Remotion'un kendi çizdiği
// grafiğe dayanıyor - stok video ya da yapay zekâ görseli kullanmıyorlar.
// Bu, projedeki bütün görsel sorunların kaynağını (dışarıdan gelen görüntünün
// konuyla eşleşmemesi) ortadan kaldırıyor: her piksel bizim kontrolümüzde ve
// sonuç her çalıştırmada aynı kalitede çıkıyor.

export const V = {
  // 9:16 dikey, mobil ekranda okunabilirlik önceliği
  width: 1080,
  height: 1920,

  font: "Montserrat, Arial, sans-serif",

  // Koyu zemin: feed'de parlak beyaz kartlar göz yorar ve kaydırılır.
  // Hafif mavi-mor gradyan hem derinlik verir hem markalaşmayı kolaylaştırır.
  bg0: "#0B1020",
  bg1: "#151B33",

  ink: "#FFFFFF",
  inkSoft: "rgba(255,255,255,0.72)",
  inkFaint: "rgba(255,255,255,0.40)",

  // Vurgu renkleri. Sıcak sarı dikkat çeker, yeşil/kırmızı doğru-yanlış için.
  accent: "#FFC53D",
  good: "#33D17A",
  bad: "#FF5A5F",
  bar: "#4C8DFF",
  barTop: "#FFC53D", // birinci sıradaki çubuk ayrı renkte

  // Güvenli alanlar: YouTube Shorts arayüzü altta ~320px, sağda ~180px
  // kaplıyor. İçeriği bu alanların dışında tutmazsak metin butonların
  // altında kalıyor.
  safeTop: 210,
  safeBottom: 380,
  safeX: 72,
} as const;

export const bgGradient = `linear-gradient(160deg, ${V.bg0} 0%, ${V.bg1} 55%, ${V.bg0} 100%)`;

// Türkçe sayı biçimi: 1234567.8 -> "1.234.567,8"
export function trSayi(n: number, basamak = 0): string {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: basamak,
    maximumFractionDigits: basamak,
  }).format(n);
}
