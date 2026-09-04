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

  console.log("YouTube'a yükleniyor:", metadata.title);

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
      status: {
        privacyStatus: process.env.YT_PRIVACY_STATUS || "public",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(VIDEO_PATH),
    },
  });

  console.log(
    `✅ Yüklendi: https://youtube.com/shorts/${res.data.id}`
  );
}

main().catch((err) => {
  console.error("❌ upload hata:", err.message);
  process.exit(1);
});
