// scripts/copySecret.mjs
// GitHub Actions secret'larını tek tek panoya kopyalar; böylece değerleri
// hiçbir yere yazıp göstermeden doğrudan GitHub'daki "Secret" kutusuna
// yapıştırabilirsin.
//
// Kullanım:
//   node scripts/copySecret.mjs            -> ne kopyalanacağını listeler
//   node scripts/copySecret.mjs GEMINI_API_KEY
//   node scripts/copySecret.mjs YT_TOKEN_JSON   (token.json dosyasının tamamı)

import fs from "node:fs";
import { spawn } from "node:child_process";

// GitHub'a girilmesi gereken secret'lar. YT_TOKEN_JSON .env'de değil,
// token.json dosyasının tamamıdır.
const SECRETS = [
  "GEMINI_API_KEY",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "YT_CLIENT_ID",
  "YT_CLIENT_SECRET",
  "YT_REDIRECT_URI",
  "YT_PRIVACY_STATUS",
  "YT_TOKEN_JSON",
];

function readEnv() {
  const out = {};
  const raw = fs.readFileSync(".env", "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    // Değerin içinde "=" olabilir (base64 anahtarlar), sadece ilkinden bölüyoruz.
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    // Windows'un yerleşik "clip" komutu. Sonuna satır sonu eklememek için
    // doğrudan stdin'e yazıp kapatıyoruz.
    const child = spawn("cmd", ["/c", "clip"], { stdio: ["pipe", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`clip komutu ${code} ile bitti`))
    );
    child.stdin.end(text, "utf8");
  });
}

async function main() {
  const name = process.argv[2];
  const env = readEnv();

  if (!name) {
    console.log("GitHub'a girilecek secret'lar:\n");
    for (const key of SECRETS) {
      const value =
        key === "YT_TOKEN_JSON"
          ? fs.existsSync("token.json")
            ? fs.readFileSync("token.json", "utf-8").trim()
            : ""
          : env[key];
      const status = value ? `hazır (${value.length} karakter)` : "!! BOŞ !!";
      console.log(`  ${key.padEnd(20)} ${status}`);
    }
    console.log("\nKopyalamak için:  node scripts/copySecret.mjs <AD>");
    console.log("Örnek:            node scripts/copySecret.mjs GEMINI_API_KEY");
    return;
  }

  const key = name.toUpperCase();
  const value =
    key === "YT_TOKEN_JSON"
      ? fs.readFileSync("token.json", "utf-8").trim()
      : env[key];

  if (!value) {
    console.error(`❌ "${key}" bulunamadı ya da boş.`);
    console.error("   Adları görmek için argümansız çalıştır: node scripts/copySecret.mjs");
    process.exit(1);
  }

  await copyToClipboard(value);
  console.log(`✅ ${key} panoya kopyalandı (${value.length} karakter).`);
  console.log("   GitHub'daki Secret kutusuna Ctrl+V ile yapıştır.");
}

main().catch((err) => {
  console.error("❌ hata:", err.message);
  process.exit(1);
});
