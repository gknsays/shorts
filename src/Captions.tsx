import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CaptionLine, findActiveLine } from "./captionUtils";

export const Captions: React.FC<{
  lines: CaptionLine[];
  highlightColor?: string;
  textColor?: string;
  /** Bu saniyeden önce altyazı gösterilmez (kanca kartı ekrandayken). */
  hideBeforeSeconds?: number;
}> = ({
  lines,
  highlightColor = "#FFD400",
  textColor = "#FFFFFF",
  hideBeforeSeconds = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  if (t < hideBeforeSeconds) return null;

  const active = findActiveLine(lines, t);
  if (!active) return null;

  // Yeni bir altyazı satırı başladığında hafif bir "pop" (büyüyerek belirme)
  // animasyonu - video daha canlı ve dinamik hissettirsin diye.
  const framesSinceLineStart = frame - Math.round(active.start * fps);
  const popScale = interpolate(framesSinceLineStart, [0, 6], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const popOpacity = interpolate(framesSinceLineStart, [0, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        // Shorts arayüzü ekranın alt ~450px'ini (başlık, kanal adı, ses adı,
        // beğen/yorum butonları) kapatır. Altyazı 260px'te bu katmanın altında
        // kalıyordu; merkeze yakın konum hem okunur hem göz videoda kalır.
        bottom: 620,
        left: 60,
        right: 60,
        textAlign: "center",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "6px 18px",
        transform: `scale(${popScale})`,
        opacity: popOpacity,
      }}
    >
      {active.words.map((w, i) => {
        const isActive = t >= w.start && t <= w.end;
        return (
          <span
            key={i}
            style={{
              fontFamily: "Montserrat, Arial, sans-serif",
              fontWeight: 800,
              // Vurgulu kelimeyi transform:scale yerine fontSize ile büyütüyoruz;
              // scale sadece görsel olarak büyütüp komşu kelimelerin üzerine
              // biniyordu (layout'u etkilemiyordu). fontSize değişimi tarayıcının
              // komşu kelimeleri gerçekten itmesini sağlıyor, çakışma olmuyor.
              fontSize: isActive ? 70 : 64,
              lineHeight: 1.25,
              color: isActive ? highlightColor : textColor,
              WebkitTextStroke: "3px rgba(0,0,0,0.85)",
              paintOrder: "stroke fill",
              display: "inline-block",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};
