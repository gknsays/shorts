// src/QuizVideo.tsx
// Quiz / bilgi testi formatı.
//
// SES TASARIMI: Sürekli çalan bir müzik yatağı YOK. Bunun yerine her sorunun
// düşünme penceresinde tik-tak sesi devreye giriyor, süre dolunca çan çalıyor.
// Sürekli müzik hem seslendirmenin önüne geçiyordu hem de "şimdi cevap verme
// zamanı" anını belirsiz bırakıyordu. Sesin sadece o pencerede olması, sessizlik
// ile tik-tak arasındaki kontrastı bir sinyale çeviriyor.
//
// TASARIM KARARI - GERİ SAYIM: Cevabı tahmin eden izleyici doğrulamak için
// kalıyor, yanılan şaşırıp yorumlara gidiyor. Shorts'ta hem tutulma hem yorum
// sayısı bu iki davranıştan besleniyor.
//
// ZAMANLAMA: Süreler soru başına ayrı veriliyor. Sabit süre kullanıldığında
// uzun soruların seslendirmesi görüntüden taşıyor, kısa olanlarda ekran boş
// bekliyordu.

import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { V, bgGradient } from "./visualTheme";

export type QuizQuestion = {
  soru: string;
  secenekler: string[];
  dogru: number;
  soruSaniye?: number; // anlatım + düşünme penceresi
  cevapSaniye?: number;
  anlatimSaniye?: number; // sorunun sesli okunması ne kadar sürüyor
};

export type QuizVideoProps = {
  title: string;
  questions: QuizQuestion[];
  outro?: string | null;
  outroAlt?: string | null;
  channelName?: string | null;
  channelAvatar?: string | null; // public/ içine göre yol
  audioSegments?: { src: string; offsetSeconds: number }[];
  introSeconds?: number;
  questionSeconds?: number;
  revealSeconds?: number;
  outroSeconds?: number;
};

const SIK_HARF = ["A", "B", "C", "D"];

// Her sorunun kendi vurgu rengi: video boyunca aynı sarıyı görmek tekdüze
// duruyordu, soru değişimini renk de haber veriyor.
const SORU_RENKLERI = ["#FFC53D", "#4CC9F0", "#B892FF"];

export const QUIZ_DEFAULTS = {
  intro: 2.0,
  question: 5.6,
  reveal: 4.2,
  outro: 4.5,
};

export function quizSureleri(props: QuizVideoProps) {
  const intro = props.introSeconds ?? QUIZ_DEFAULTS.intro;
  const outro = props.outroSeconds ?? QUIZ_DEFAULTS.outro;
  const bloklar = (props.questions ?? []).map((q) => ({
    soru: q.soruSaniye ?? props.questionSeconds ?? QUIZ_DEFAULTS.question,
    cevap: q.cevapSaniye ?? props.revealSeconds ?? QUIZ_DEFAULTS.reveal,
    anlatim: q.anlatimSaniye ?? 0,
  }));
  const toplam =
    intro + bloklar.reduce((t, b) => t + b.soru + b.cevap, 0) + outro;
  return { intro, outro, bloklar, toplam };
}

// Yavaşça sürüklenen renkli ışıklar. Düz koyu zemin "sade" duruyordu; hareketli
// bir zemin, kare sabitken bile videoyu canlı tutuyor.
const CanliZemin: React.FC<{ renk: string }> = ({ renk }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const x1 = 50 + Math.sin(t * 0.32) * 22;
  const y1 = 18 + Math.cos(t * 0.24) * 10;
  const x2 = 45 + Math.cos(t * 0.21) * 26;
  const y2 = 78 + Math.sin(t * 0.29) * 12;

  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(58% 34% at ${x1}% ${y1}%, ${renk}38 0%, rgba(0,0,0,0) 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(52% 30% at ${x2}% ${y2}%, #4C8DFF2E 0%, rgba(0,0,0,0) 70%)`,
        }}
      />
    </>
  );
};

// Kapanış ekranı efektleri. Sade avatar + yazı "canımı sıkıyor" geri bildirimi
// aldı; dönen ışınlar ve süzülen parçacıklar ekrana derinlik ve hareket katıyor.
// İkisi de saf SVG/CSS - ek dosya, görsel ya da kütüphane gerektirmiyor.
const DonenIsinlar: React.FC<{ renk: string }> = ({ renk }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const aci = (frame / fps) * 9; // yavaş dönüş
  const isinSayisi = 12;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.17,
        // Işınlar kenarlarda keskin bitince "kesilmiş kâğıt" gibi duruyordu.
        // Radyal maske merkeze doğru yoğunlaştırıp dışarı doğru eritiyor.
        WebkitMaskImage:
          "radial-gradient(circle at 50% 42%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.55) 38%, rgba(0,0,0,0) 68%)",
        maskImage:
          "radial-gradient(circle at 50% 42%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.55) 38%, rgba(0,0,0,0) 68%)",
        filter: "blur(2px)",
      }}
    >
      <svg width={1500} height={1500} style={{ transform: `rotate(${aci}deg)` }}>
        {Array.from({ length: isinSayisi }).map((_, i) => {
          const a = (i / isinSayisi) * Math.PI * 2;
          const uc = (o) => [
            750 + Math.cos(a + o) * 750,
            750 + Math.sin(a + o) * 750,
          ];
          const [x1, y1] = uc(-0.055);
          const [x2, y2] = uc(0.055);
          return (
            <polygon
              key={i}
              points={`750,750 ${x1},${y1} ${x2},${y2}`}
              fill={i % 2 === 0 ? renk : "transparent"}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

const Parcaciklar: React.FC<{ renk: string }> = ({ renk }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const adet = 26;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {Array.from({ length: adet }).map((_, i) => {
        // Sabit "rastgele" değerler: her render'da aynı desen çıksın.
        const tohum = (i * 9301 + 49297) % 233280;
        const r1 = tohum / 233280;
        const r2 = ((tohum * 7) % 233280) / 233280;
        const hiz = 6 + r1 * 10;
        const boyut = 6 + r2 * 12;
        const x = r1 * 100;
        // Aşağıdan yukarı süzülme; ekranın üstüne varınca alta dönüyor.
        const y = 105 - (((t * hiz + r2 * 120) % 120));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: boyut,
              height: boyut,
              borderRadius: "50%",
              background: i % 3 === 0 ? renk : "#FFFFFF",
              opacity: 0.10 + r2 * 0.22,
              filter: "blur(1px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Secenek: React.FC<{
  metin: string;
  harf: string;
  durum: "bekliyor" | "dogru" | "yanlis";
  gecikme: number;
  acilisFrame: number;
}> = ({ metin, harf, durum, gecikme, acilisFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - gecikme,
    fps,
    config: { damping: 16, stiffness: 130 },
  });

  // Doğru şık açıldığı anda kısa bir "pop" ve parlama: gözü oraya çekiyor.
  const pop =
    durum === "dogru"
      ? spring({
          frame: frame - acilisFrame,
          fps,
          config: { damping: 9, stiffness: 200, mass: 0.5 },
        })
      : 0;
  const olcek = durum === "dogru" ? 1 + 0.06 * Math.sin(pop * Math.PI) : 1;

  const arka =
    durum === "dogru"
      ? "rgba(51,209,122,0.24)"
      : durum === "yanlis"
      ? "rgba(255,255,255,0.04)"
      : "rgba(255,255,255,0.10)";
  const kenar =
    durum === "dogru"
      ? V.good
      : durum === "yanlis"
      ? "transparent"
      : "rgba(255,255,255,0.14)";
  const yazi = durum === "yanlis" ? V.inkFaint : V.ink;

  return (
    <div
      style={{
        opacity: enter * (durum === "yanlis" ? 0.5 : 1),
        transform: `translateX(${(1 - enter) * -30}px) scale(${olcek})`,
        display: "flex",
        alignItems: "center",
        gap: 22,
        background: arka,
        border: `3px solid ${kenar}`,
        borderRadius: 26,
        padding: "26px 30px",
        marginBottom: 22,
        boxShadow:
          durum === "dogru"
            ? `0 0 ${30 + pop * 40}px rgba(51,209,122,${0.25 + pop * 0.25})`
            : "none",
      }}
    >
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: 16,
          background: durum === "dogru" ? V.good : "rgba(255,255,255,0.12)",
          color: durum === "dogru" ? "#04220F" : V.ink,
          fontFamily: V.font,
          fontWeight: 900,
          fontSize: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {harf}
      </div>
      <div
        style={{
          fontFamily: V.font,
          fontWeight: 700,
          fontSize: 42,
          color: yazi,
          lineHeight: 1.15,
        }}
      >
        {metin}
      </div>
    </div>
  );
};

// Geri sayım halkası: rakam okumak dikkat isterken halka çevresel görüşle
// algılanıyor ve izleyicinin gözü soruda kalabiliyor.
const GeriSayim: React.FC<{
  baslangicFrame: number;
  bitisFrame: number;
  renk: string;
}> = ({ baslangicFrame, bitisFrame, renk }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sure = Math.max(1, bitisFrame - baslangicFrame);
  const gecen = frame - baslangicFrame;
  const kalan = Math.max(0, Math.min(1, 1 - gecen / sure));
  const cevre = 2 * Math.PI * 58;

  const acil = kalan < 0.34;
  const cizgiRenk = acil ? V.bad : renk;
  const nabiz = acil ? 1 + 0.07 * Math.sin((frame / 3.5) * Math.PI) : 1;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        marginTop: 22,
        transform: `scale(${nabiz})`,
      }}
    >
      <svg width={140} height={140}>
        <circle
          cx={70}
          cy={70}
          r={58}
          fill="rgba(0,0,0,0.25)"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={12}
        />
        <circle
          cx={70}
          cy={70}
          r={58}
          fill="none"
          stroke={cizgiRenk}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={cevre}
          strokeDashoffset={cevre * (1 - kalan)}
          transform="rotate(-90 70 70)"
        />
        <text
          x={70}
          y={70}
          textAnchor="middle"
          dominantBaseline="central"
          fill={acil ? V.bad : V.ink}
          fontFamily={V.font}
          fontWeight={900}
          fontSize={50}
        >
          {Math.max(1, Math.ceil((kalan * sure) / fps))}
        </text>
      </svg>
    </div>
  );
};

const AboneBegenCubugu: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const gir = spring({
    frame: frame - fps * 0.6,
    fps,
    config: { damping: 15, stiffness: 110 },
  });
  const nabiz = 1 + 0.05 * Math.sin((frame / (fps * 2.2)) * Math.PI * 2);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        // YouTube Shorts başlık/açıklama bandı ekranın altındaki ~380 pikseli
        // kaplıyor. Butonlar daha önce o bandın İÇİNDE kalıyordu (safeBottom-140)
        // ve videoyu izlerken başlığın arkasında görünmez oluyordu. Bandın
        // üstüne çıkarıldı.
        bottom: V.safeBottom + 70,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 26,
        opacity: gir,
        transform: `translateY(${(1 - gir) * 24}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "rgba(255,255,255,0.10)",
          border: "2px solid rgba(255,255,255,0.18)",
          borderRadius: 999,
          padding: "20px 34px",
        }}
      >
        <svg width={46} height={46} viewBox="0 0 24 24" fill={V.bad}>
          <path d="M12 21s-7.5-4.6-9.6-9A5.3 5.3 0 0 1 12 6.5 5.3 5.3 0 0 1 21.6 12c-2.1 4.4-9.6 9-9.6 9z" />
        </svg>
        <span
          style={{
            fontFamily: V.font,
            fontWeight: 800,
            fontSize: 40,
            color: V.ink,
          }}
        >
          Beğen
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "#FF0033",
          borderRadius: 999,
          padding: "20px 40px",
          transform: `scale(${nabiz})`,
          boxShadow: "0 14px 44px rgba(255,0,51,0.45)",
        }}
      >
        <svg width={44} height={44} viewBox="0 0 24 24" fill="#FFFFFF">
          <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6v-5a7 7 0 0 0-5.5-6.83V3.5a1.5 1.5 0 0 0-3 0v.67A7 7 0 0 0 5 11v5l-1.7 1.7a1 1 0 0 0 .7 1.7h16a1 1 0 0 0 .7-1.7L19 16z" />
        </svg>
        <span
          style={{
            fontFamily: V.font,
            fontWeight: 900,
            fontSize: 42,
            color: "#FFFFFF",
          }}
        >
          Abone ol
        </span>
      </div>
    </div>
  );
};

const Soru: React.FC<{
  q: QuizQuestion;
  sira: number;
  toplam: number;
  soruFrame: number; // cevabın açıldığı kare
  anlatimFrame: number; // seslendirmenin bittiği, düşünmenin başladığı kare
  renk: string;
}> = ({ q, sira, toplam, soruFrame, anlatimFrame, renk }) => {
  const frame = useCurrentFrame();
  const acildi = frame >= soruFrame;

  return (
    <AbsoluteFill
      style={{
        paddingTop: V.safeTop,
        paddingBottom: V.safeBottom,
        paddingLeft: V.safeX,
        paddingRight: V.safeX,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      {/* Soru sayacı: kaç soru kaldığını görmek videoyu bitirme isteği yaratıyor */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontFamily: V.font,
            fontWeight: 800,
            fontSize: 34,
            color: renk,
            letterSpacing: 2,
          }}
        >
          SORU {sira} / {toplam}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {Array.from({ length: toplam }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 30,
                height: 8,
                borderRadius: 4,
                background: i < sira ? renk : "rgba(255,255,255,0.18)",
              }}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          fontFamily: V.font,
          fontWeight: 900,
          fontSize: 66,
          lineHeight: 1.12,
          color: V.ink,
          letterSpacing: -1,
          marginBottom: 40,
          textShadow: "0 6px 30px rgba(0,0,0,0.45)",
        }}
      >
        {q.soru}
      </div>

      <div>
        {q.secenekler.map((s, i) => (
          <Secenek
            key={i}
            metin={s}
            harf={SIK_HARF[i] ?? String(i + 1)}
            durum={!acildi ? "bekliyor" : i === q.dogru ? "dogru" : "yanlis"}
            gecikme={6 + i * 5}
            acilisFrame={soruFrame}
          />
        ))}
      </div>

      {!acildi ? (
        <GeriSayim
          baslangicFrame={anlatimFrame}
          bitisFrame={soruFrame}
          renk={renk}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const QuizVideo: React.FC<QuizVideoProps> = (props) => {
  const {
    title,
    questions,
    outro,
    outroAlt,
    channelName,
    channelAvatar,
    audioSegments,
  } = props;

  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const { intro, bloklar } = quizSureleri(props);
  const introF = Math.round(intro * fps);

  const baslangiclar: number[] = [];
  let imlec = introF;
  for (const b of bloklar) {
    baslangiclar.push(imlec);
    imlec += Math.round((b.soru + b.cevap) * fps);
  }
  const outroStart = imlec;

  const introEnter = spring({ frame, fps, config: { damping: 14 } });
  const outroEnter = spring({
    frame: frame - outroStart,
    fps,
    config: { damping: 14 },
  });

  // Aktif sorunun rengi zemine de yansıyor.
  const aktifIndex = Math.max(
    0,
    baslangiclar.findLastIndex?.((b) => frame >= b) ??
      baslangiclar.reduce((acc, b, i) => (frame >= b ? i : acc), 0)
  );
  const aktifRenk = SORU_RENKLERI[aktifIndex % SORU_RENKLERI.length];

  return (
    <AbsoluteFill style={{ background: bgGradient }}>
      <CanliZemin renk={aktifRenk} />

      <Sequence from={0} durationInFrames={introF}>
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            padding: `0 ${V.safeX}px`,
          }}
        >
          <div
            style={{
              fontFamily: V.font,
              fontWeight: 900,
              fontSize: 88,
              lineHeight: 1.08,
              color: V.ink,
              textAlign: "center",
              letterSpacing: -2,
              transform: `scale(${0.85 + introEnter * 0.15})`,
              textShadow: "0 8px 40px rgba(0,0,0,0.5)",
            }}
          >
            {title}
          </div>
        </AbsoluteFill>
      </Sequence>

      {questions.map((q, i) => {
        const b = bloklar[i];
        const blokFrame = Math.round((b.soru + b.cevap) * fps);
        const soruFrame = Math.round(b.soru * fps);
        const anlatimFrame = Math.round(b.anlatim * fps);
        const dusunmeFrame = Math.max(1, soruFrame - anlatimFrame);

        return (
          <Sequence key={i} from={baslangiclar[i]} durationInFrames={blokFrame}>
            <Soru
              q={q}
              sira={i + 1}
              toplam={questions.length}
              soruFrame={soruFrame}
              anlatimFrame={anlatimFrame}
              renk={SORU_RENKLERI[i % SORU_RENKLERI.length]}
            />

            {/* Tik-tak YALNIZCA düşünme penceresinde. Seslendirme sürerken
                sessiz kalıyor ki anlatımın önüne geçmesin. */}
            <Sequence from={anlatimFrame} durationInFrames={dusunmeFrame}>
              <Audio src={staticFile("sfx/tiktak.wav")} volume={0.5} loop />
            </Sequence>

            {/* Süre dolduğu an çan: cevabın açıldığı anı işaretliyor */}
            <Sequence from={soruFrame} durationInFrames={Math.round(1.9 * fps)}>
              <Audio src={staticFile("sfx/zil.wav")} volume={0.42} />
            </Sequence>
          </Sequence>
        );
      })}

      {frame >= outroStart ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            padding: `0 ${V.safeX}px`,
            paddingBottom: V.safeBottom,
          }}
        >
          <DonenIsinlar renk={V.accent} />
          <Parcaciklar renk={V.accent} />

          {/* Kanal kimliği: izleyici videoyu beğendiğinde kimin kanalı
              olduğunu hatırlaması gerekiyor. Avatar + ad, abone dönüşümünü
              belirgin şekilde artıran en basit müdahale. */}
          {channelAvatar ? (
            <Img
              src={staticFile(channelAvatar)}
              style={{
                width: 440,
                height: 440,
                borderRadius: "50%",
                border: `10px solid ${V.accent}`,
                marginBottom: 30,
                transform: `scale(${0.7 + outroEnter * 0.3})`,
                boxShadow: `0 0 90px rgba(255,197,61,0.45), 0 20px 70px rgba(0,0,0,0.6)`,
              }}
            />
          ) : null}

          {channelName ? (
            <div
              style={{
                fontFamily: V.font,
                fontWeight: 900,
                fontSize: 96,
                color: V.ink,
                marginBottom: 26,
                letterSpacing: -2,
                textShadow: "0 8px 40px rgba(0,0,0,0.6)",
              }}
            >
              {channelName}
            </div>
          ) : null}

          <div
            style={{
              fontFamily: V.font,
              fontWeight: 900,
              fontSize: 62,
              color: V.inkSoft,
              textAlign: "center",
              lineHeight: 1.1,
              transform: `scale(${0.9 + outroEnter * 0.1})`,
            }}
          >
            {outro}
          </div>
          {outroAlt ? (
            <div
              style={{
                fontFamily: V.font,
                fontWeight: 800,
                fontSize: 48,
                color: V.accent,
                textAlign: "center",
                marginTop: 22,
                opacity: interpolate(
                  frame,
                  [outroStart + 8, outroStart + 24],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                ),
              }}
            >
              {outroAlt}
            </div>
          ) : null}
        </AbsoluteFill>
      ) : null}

      <AboneBegenCubugu />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 8,
          width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`,
          background: aktifRenk,
        }}
      />

      {(audioSegments ?? []).map((seg, i) => (
        <Sequence
          key={i}
          from={Math.round(seg.offsetSeconds * fps)}
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
