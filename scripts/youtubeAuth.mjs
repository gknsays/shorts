// scripts/youtubeAuth.mjs
// TEK SEFERLİK kurulum scripti. Google OAuth izin akışını başlatır,
// tarayıcıda onay verdikten sonra token.json dosyasına refresh token kaydeder.
// Bundan sonraki tüm otomatik yüklemeler bu token.json'u kullanır.

import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import { google } from "googleapis";
import open from "open";

const REDIRECT_URI =
  process.env.YT_REDIRECT_URI || "http://localhost:8765/oauth2callback";

const oauth2Client = new google.auth.OAuth2(
  process.env.YT_CLIENT_ID,
  process.env.YT_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

async function main() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("Tarayıcı açılıyor, Google hesabınla izin ver...");
  console.log("Eğer otomatik açılmazsa şu linki kopyala:\n", authUrl);
  await open(authUrl);

  const port = Number(new URL(REDIRECT_URI).port || 8765);

  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, REDIRECT_URI);
        const code = url.searchParams.get("code");
        if (!code) return;

        res.end("Yetkilendirme tamamlandı, bu sekmeyi kapatabilirsin.");
        server.close();

        const { tokens } = await oauth2Client.getToken(code);
        fs.writeFileSync("token.json", JSON.stringify(tokens, null, 2));
        console.log("✅ token.json kaydedildi. Artık scripts/upload.mjs otomatik çalışabilir.");
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    server.listen(port);
  });
}

main().catch((err) => {
  console.error("❌ youtubeAuth hata:", err.message);
  process.exit(1);
});
