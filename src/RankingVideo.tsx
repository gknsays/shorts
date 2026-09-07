// src/RankingVideo.tsx
// Sıralama / karşılaştırma formatı.
//
// TASARIM KARARI - SONDAN BAŞA AÇILIŞ: Liste en alttaki sıradan başlayıp
// birinciye doğru açılıyor. Böylece merak sona saklanıyor; izleyici birinciyi
// görmek için kalıyor ve çoğu zaman kaçırdığı sıraları görmek için videoyu
// başa sarıyor. Baştan sona açılan bir liste ilk saniyede biterdi.

import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { V, bgGradient, trSayi } from "./visualTheme";

export type RankingItem = {
  label: string;
  value: number;
  // Ekranda gösterilecek hazır metin ("27,4 yıl"). Verilmezse value biçimlenir.
  display?: string | null;
};

export type RankingVideoProps = {
  title: string;
  subtitle?: string | null;
  items: RankingItem[];
  outro?: string | null;
  // Sıra numarası gösterilsin mi. Gerçek bir sıralamada ("en kalabalık 5 il")
  // anlamlı; saf karşılaştırmada ("günde şu kadar harcarsan") kafa karıştırıyor.
  showRank?: boolean;
  musicSrc?: string | null;
  audioSegments?: { src: string; offsetSeconds: number }[];
  // Her satırın ekranda açılması için ayrılan süre.
  secondsPerItem?: number;
  introSeconds?: number;
  outroSeconds?: number;
};

const FPS_FALLBACK = 30;

// Sayının sıfırdan hedefe doğru sayması. Sabit bir sayı yazmak yerine saymak,
// izleyicinin gözünü satırda tutuyor ve "ne kadara çıkacak?" merakı yaratıyor.
const CountUp: React.FC<{
  value: number;
  display?: string | null;
  progress: number;
}> = ({ value, display, progress }) => {
  if (display) {
    // Hazır metin varsa (birim içeriyor olabilir) sayıyı ondan türetiyoruz:
    // metindeki ilk sayıyı animasyonlu olanla değiştiriyoruz.
    const eslesme = display.match(/[\d.,]+/);
    if (eslesme) {
      const basamak = (eslesme[0].split(",")[1] || "").length;
      const anlik = trSayi(value * progress, basamak);
      return <>{display.replace(eslesme[0], anlik)}</>;
    }
    return <>{display}</>;
  }
  return <>{trSayi(value * progress)}</>;
};

const Row: React.FC<{
  item: RankingItem;
  rank: number; // 1 = en büyük değer
  maxValue: number;
  appearFrame: number;
  showRank: boolean;
}> = ({ item, rank, maxValue, appearFrame, showRank }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - appearFrame;

  const enter = spring({
    frame: local,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.7 },
  });

  // Çubuk ve sayı aynı anda dolmuyor: çubuk biraz önde gidiyor, sayı onu
  // takip ediyor. Aynı anda olduğunda göz ikisini birden takip edemiyor.
  const barFill = interpolate(local, [4, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const numFill = interpolate(local, [8, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (local < 0) return null;

  const birinci = rank === 1;
  const oran = maxValue > 0 ? item.value / maxValue : 0;

  return (
    <div
      style={{
        opacity: enter,
        transform: `translateY(${(1 - enter) * 40}px)`,
        marginBottom: 34,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          marginBottom: 12,
        }}
      >
        {showRank ? (
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: birinci ? V.barTop : "rgba(255,255,255,0.12)",
              color: birinci ? "#1A1300" : V.ink,
              fontFamily: V.font,
              fontWeight: 900,
              fontSize: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {rank}
          </div>
        ) : null}

        <div
          style={{
            fontFamily: V.font,
            fontWeight: 800,
            fontSize: 44,
            color: V.ink,
            lineHeight: 1.1,
            flex: 1,
          }}
        >
          {item.label}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            flex: 1,
            height: 26,
            borderRadius: 13,
            background: "rgba(255,255,255,0.10)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.max(2, oran * barFill * 100)}%`,
              height: "100%",
              borderRadius: 13,
              background: birinci ? V.barTop : V.bar,
            }}
          />
        </div>

        <div
          style={{
            fontFamily: V.font,
            fontWeight: 900,
            fontSize: 40,
            color: birinci ? V.barTop : V.inkSoft,
            minWidth: 240,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <CountUp value={item.value} display={item.display} progress={numFill} />
        </div>
      </div>
    </div>
  );
};

export const RankingVideo: React.FC<RankingVideoProps> = ({
  title,
  subtitle,
  items,
  outro,
  showRank = true,
  musicSrc,
  audioSegments,
  secondsPerItem = 2.1,
  introSeconds = 2.2,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const perItem = Math.round(secondsPerItem * fps);
  const introFrames = Math.round(introSeconds * fps);

  // Değere göre BÜYÜKTEN KÜÇÜĞE sıralıyoruz. Böylece 1 numara hem en uzun
  // çubuğa hem altın vurguya sahip oluyor; girdi sırası ne olursa olsun
  // vurgu ile görsel birbirini tutuyor. (Önce bu yapılmadığında "1" rozeti
  // en kısa çubuğun yanında duruyordu ve okuma ters dönüyordu.)
  const sirali = [...items].sort((a, b) => b.value - a.value);
  const maxValue = Math.max(...sirali.map((i) => i.value), 0);

  const baslikEnter = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 110 },
  });

  // Satırlar sondan başa açılıyor: dizideki son eleman ilk görünür.
  const sonIndex = sirali.length - 1;

  const outroStart = introFrames + sirali.length * perItem;
  const outroGorunur = outro && frame >= outroStart;

  return (
    <AbsoluteFill style={{ background: bgGradient }}>
      {/* Üstte hafif bir ışık: düz koyu zemin ekranda ölü duruyor */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 55% at 50% 0%, rgba(76,141,255,0.22) 0%, rgba(0,0,0,0) 60%)",
        }}
      />

      <AbsoluteFill
        style={{
          paddingTop: V.safeTop,
          paddingBottom: V.safeBottom,
          paddingLeft: V.safeX,
          paddingRight: V.safeX,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            opacity: baslikEnter,
            transform: `translateY(${(1 - baslikEnter) * 24}px)`,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontFamily: V.font,
              fontWeight: 900,
              fontSize: 74,
              lineHeight: 1.08,
              color: V.ink,
              letterSpacing: -1,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                fontFamily: V.font,
                fontWeight: 600,
                fontSize: 38,
                color: V.inkFaint,
                marginTop: 14,
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {sirali.map((item, i) => (
            <Row
              key={i}
              item={item}
              rank={i + 1}
              maxValue={maxValue}
              showRank={showRank}
              appearFrame={introFrames + (sonIndex - i) * perItem}
            />
          ))}
        </div>

        {outroGorunur ? (
          <div
            style={{
              fontFamily: V.font,
              fontWeight: 800,
              fontSize: 46,
              color: V.accent,
              textAlign: "center",
              marginTop: 18,
              opacity: interpolate(
                frame,
                [outroStart, outroStart + 10],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              ),
            }}
          >
            {outro}
          </div>
        ) : null}
      </AbsoluteFill>

      {/* İlerleme çubuğu: izleyiciye "az kaldı" hissi verip bırakmayı azaltıyor */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 8,
          width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`,
          background: V.accent,
        }}
      />

      {musicSrc ? (
        <Audio
          src={musicSrc.startsWith("http") ? musicSrc : staticFile(musicSrc)}
          volume={0.09}
          loop
        />
      ) : null}

      {(audioSegments ?? []).map((seg, i) => (
        <Sequence
          key={i}
          from={Math.round(seg.offsetSeconds * (fps || FPS_FALLBACK))}
          layout="none"
        >
          <Audio
            src={seg.src.startsWith("http") ? seg.src : staticFile(seg.src)}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
