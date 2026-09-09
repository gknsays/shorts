// scripts/upload.mjs
// out/short.mp4 dosyasını, data/metadata.json içindeki başlık/açıklama/etiketlerle
// YouTube Data API v3 üzerinden yükler ve Shorts olarak işaretler.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const DATA_DIR = path.resolve("data");
const VIDEO_PATH = path.resolve("out/short.mp4");

function buildAuth() {
  const token = JSON.parse(fs.readFileSync("token.json", "utf-8"));
  const oauth2Client = new google.auth.OAuth2(
    process.env.YT_CLIENT_ID,
    process.env.YT_CLIENT_SECRET,
    process.env.YT_REDIRECT_URI || "http://localhost:8765/oauth2callback"
  );
  oauth2Client.setCredentials(token);
  return oauth2Client;
}

async function main() {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "metadata.json"), "utf-8")
  );

  if (!fs.existsSync(VIDEO_PATH)) {
    throw new Error(`${VIDEO_PATH} bulunamadı. Önce 'npm run render' çalıştır.`);
  }

  const auth = buildAuth();
  const youtube = google.youtube({ version: "v3", auth });

  // Shorts algoritmasının videoyu doğru sınıflandırması için
  // başlık/açıklamada #Shorts geçmesi önemlidir.
  const description = metadata.description.includes("#Shorts")
    ? metadata.description
    : `${metadata.description}\n\n#Shorts`;

  // YAYIN SAATINI GITHUB'A DEGIL YOUTUBE'A BIRAKIYORUZ.
  // GitHub Actions tetiklemeleri saatlerce gecikebiliyor, dolayisiyla
  // "isin calistigi an" yayin saati olarak kullanilamaz. Bunun yerine video
  // hedef saatten once uretilip "private + publishAt" ile yukleniyor;
  // yayina alma isini YouTube dakikasi dakikasina kendisi yapiyor.
  //
  // PUBLISH_AT, scripts/slotGuard.mjs tarafindan RFC3339 (UTC) olarak
  // veriliyor. Bos ise ya da gecmisteyse dogrudan yayinlaniyor - gecmis bir
  // ana zamanlama yapilamaz, YouTube bunu hata olarak dondurur.
  const publishAtRaw = (process.env.PUBLISH_AT || "").trim();
  let publishAt = null;
  if (publishAtRaw) {
    const hedef = new Date(publishAtRaw);
    if (Number.isNaN(hedef.getTime())) {
      console.warn(`PUBLISH_AT okunamadi ("${publishAtRaw}"), dogrudan yayinlanacak.`);
    } else if (hedef.getTime() <= Date.now()) {
      console.warn(`PUBLISH_AT gecmiste (${publishAtRaw}), dogrudan yayinlanacak.`);
    } else {
      publishAt = hedef.toISOString().split(".")[0] + "Z";
    }
  }

  // publishAt yalnizca video "private" yuklendiginde calisir; "public"
  // yuklenirse YouTube zamanlamayi yok sayar ve video aninda yayina girer.
  const status = publishAt
    ? { privacyStatus: "private", publishAt, selfDeclaredMadeForKids: false }
    : {
        privacyStatus: process.env.YT_PRIVACY_STATUS || "public",
        selfDeclaredMadeForKids: false,
      };

  console.log("YouTube'a yükleniyor:", metadata.title);
  if (publishAt) {
    const trt = new Date(new Date(publishAt).getTime() + 3 * 3600 * 1000);
    const iki = (n) => String(n).padStart(2, "0");
    console.log(
      `Yayin zamanlandi: ${iki(trt.getUTCHours())}:${iki(trt.getUTCMinutes())} TRT (${publishAt})`
    );
  }

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: metadata.title.slice(0, 100),
        description,
        tags: metadata.tags,
        categoryId: "26", // "Nasıl Yapılır & Stil" kategorisi
        // Dil sinyali: bunlar boş bırakılırsa YouTube videonun hangi dilde
        // olduğunu tahmin etmek zorunda kalır ve Türkçe konuşan izleyicilere
        // önerme olasılığı düşer. Shorts feed'inde dil eşleşmesi en güçlü
        // hedefleme sinyallerinden biridir.
        defaultLanguage: "tr",
        defaultAudioLanguage: "tr",
      },
      status,
    },
    media: {
      body: fs.createReadStream(VIDEO_PATH),
    },
  });

  console.log(`✅ Yüklendi: https://youtube.com/shorts/${res.data.id}`);
  if (publishAt) {
    console.log("Video su an gizli; YouTube yukaridaki saatte kendisi yayina alacak.");
  }
}

main().catch((err) => {
  console.error("❌ upload hata:", err.message);
  process.exit(1);
});
