// scripts/run.mjs
// Tüm otomasyonu baştan sona çalıştırır:
// senaryo üret -> seslendirme üret -> arka plan indir -> render et -> YouTube'a yükle
//
// Kullanım:
//   node scripts/run.mjs                  -> konuyu Claude otomatik seçer, yükler
//   node scripts/run.mjs "buzdolabı düzeni" -> konuyu sen belirlersin, yükler
//   node scripts/run.mjs --no-upload      -> sadece video üretir, YouTube'a yüklemez

import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} kod ${code} ile bitti`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const noUpload = args.includes("--no-upload");
  const topicArgs = args.filter((a) => a !== "--no-upload");

  console.log("=== 0/5 Arka plan müziği hazırlanıyor ===");
  // Müzik dosyaları depoya konmuyor, çalıştırma anında sentezleniyor
  // (zaten varsa saniyeler içinde atlanır).
  await run("node", ["scripts/makeMusic.mjs"]);

  console.log("\n=== 1/5 Senaryo üretiliyor ===");
  await run("node", ["scripts/generateScript.mjs", ...topicArgs]);

  console.log("\n=== 2/5 Seslendirme üretiliyor ===");
  await run("node", ["scripts/generateVoice.mjs"]);

  console.log("\n=== 3/5 Arka plan videosu indiriliyor ===");
  await run("node", ["scripts/fetchBackground.mjs"]);

  console.log("\n=== 4/5 Video render ediliyor ===");
  await run("node", ["scripts/render.mjs"]);

  if (noUpload) {
    console.log("\n--no-upload verildi, YouTube'a yüklenmedi. out/short.mp4 hazır.");
    return;
  }

  console.log("\n=== YouTube'a yükleniyor ===");
  await run("node", ["scripts/upload.mjs"]);

  console.log("\n🎉 Tüm pipeline tamamlandı!");
}

main().catch((err) => {
  console.error("❌ Pipeline hata ile durdu:", err.message);
  process.exit(1);
});
