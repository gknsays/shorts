# Gizlilik Politikası

**Uygulama:** Uzay Shorts
**Son güncelleme:** 4 Eylül 2026
**İletişim:** gknsezer@gmail.com

## Bu uygulama nedir?

Uzay Shorts, tek bir kişinin kendi YouTube kanalına otomatik olarak kısa video
(Shorts) yüklemesi için yazılmış kişisel bir otomasyon aracıdır. Herkese açık bir
hizmet değildir; kayıt olma, giriş yapma veya kullanıcı hesabı oluşturma imkânı
sunmaz. Kaynak kodu tamamen açıktır:
https://github.com/gknsays/shorts

## Hangi verilere erişiyor?

Uygulama Google hesabınızdan yalnızca tek bir izin ister:

- `https://www.googleapis.com/auth/youtube.upload` — YouTube kanalına video yükleme

Bu izin **sadece** uygulamanın kendi ürettiği videoyu kanala yüklemek için
kullanılır. Uygulama:

- Mevcut videolarınızı **okumaz**, düzenlemez veya silmez
- Yorumlarınıza, abonelerinize, izlenme verilerinize veya analitiğinize **erişmez**
- E-posta, kişiler, takvim, Drive veya başka hiçbir Google verisine **erişmez**
- Google profil bilgilerinizi (ad, fotoğraf) **toplamaz**

## Veriler nerede saklanıyor?

Yetkilendirme sonucunda oluşan erişim/yenileme anahtarı (`token.json`) yalnızca
iki yerde bulunur:

1. Uygulamayı çalıştıran kişinin kendi bilgisayarında, yerel bir dosyada
2. Uygulamanın kaynak deposunda **şifreli GitHub Actions secret** olarak

Bu anahtar üçüncü taraflara aktarılmaz, satılmaz, reklam amacıyla kullanılmaz ve
herhangi bir sunucuya veya veritabanına gönderilmez. Uygulamanın kendine ait bir
sunucusu veya veritabanı yoktur.

## Üçüncü taraf servisler

Video üretimi sırasında şu servisler kullanılır. Bu servislere **hiçbir Google
kullanıcı verisi gönderilmez**; yalnızca üretilecek videonun konusuyla ilgili
metin ve arama terimleri iletilir:

- Google Gemini API — video senaryosu üretimi
- Microsoft Edge TTS — metin seslendirme
- Pexels, Pixabay — telifsiz stok video arama

## Erişimi nasıl iptal edersiniz?

https://myaccount.google.com/permissions adresinden "Uzay Shorts" uygulamasının
erişimini istediğiniz zaman kaldırabilirsiniz. İptal ettiğinizde uygulama artık
kanala video yükleyemez ve elindeki anahtar geçersiz hale gelir.

## Değişiklikler

Bu politikada bir değişiklik olursa bu sayfa güncellenir ve üstteki "son
güncelleme" tarihi değiştirilir.

## Sorular

Her türlü soru için: gknsezer@gmail.com
