import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Loop,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Captions } from "./Captions";
import { groupWordsIntoLines, WordTiming } from "./captionUtils";

export type PhaseMarker = {
  label: string; // "YANLIŞ" | "DOĞRU" | serbest metin
  color: string; // rozet rengi
  startWordIndex: number; // bu fazın kaçıncı kelimeden başladığı
  badge?: boolean; // sağ üstteki rozet gösterilsin mi (varsayılan: evet)
  cue?: string | null; // "subscribe" -> abone animasyonu
};

export type BackgroundClip = {
  src: string; // public/ klasörüne göre relative ya da tam URL
  durationInSeconds: number; // klibin kendi (kaynak) süresi
};

export type AudioSegment = {
  src: string; // public/ klasörüne göre relative
  offsetSeconds: number; // bu parçanın zaman çizelgesindeki başlangıç saniyesi
};

export type ShortVideoProps = {
  title: string;
  audioSegments: AudioSegment[];
  backgroundClips: BackgroundClip[];
  words: WordTiming[];
  phases?: PhaseMarker[];
  /** İlk 1.5-2.5 saniyede ekranı kaplayan kanca yazısı. */
  hookText?: string;
  /** Kanca bölümünün bittiği saniye (generateVoice tarafından hesaplanır). */
  hookEndSeconds?: number;
  /** Opsiyonel arka plan müziği (public/ altına göre relative yol). */
  musicSrc?: string | null;
};

const TRANSITION_FRAMES = 15; // 0.5s @ 30fps - klipler arası geçiş süresi

// Klip boyunca yavaşça yakınlaşan/uzaklaşan hafif hareket - video daha
// "canlı" görünsün diye. Yönü klipten klibe değişir (monoton hissetmesin).
const KenBurns: React.FC<{
  durationInFrames: number;
  direction: "in" | "out";
  children: React.ReactNode;
}> = ({ durationInFrames, direction, children }) => {
  const frame = useCurrentFrame();
  const scale =
    direction === "in"
      ? interpolate(frame, [0, durationInFrames], [1, 1.15], {
          extrapolateRight: "clamp",
        })
      : interpolate(frame, [0, durationInFrames], [1.15, 1], {
          extrapolateRight: "clamp",
        });

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const BackgroundReel: React.FC<{ clips: BackgroundClip[] }> = ({ clips }) => {
  const { fps, durationInFrames } = useVideoConfig();

  const perClipDuration = useMemo(() => {
    const n = clips.length;
    if (n <= 1) return durationInFrames;
    // TransitionSeries, ardışık sequence'lar arasındaki geçiş süresi kadar
    // üst üste bindirme yapar; toplam süre hedefe ulaşsın diye buna göre hesaplıyoruz.
    return Math.max(
      TRANSITION_FRAMES + 1,
      Math.round(
        (durationInFrames + (n - 1) * TRANSITION_FRAMES) / n
      )
    );
  }, [clips.length, durationInFrames]);

  const items: React.ReactNode[] = [];

  clips.forEach((clip, i) => {
    const resolvedSrc = clip.src.startsWith("http")
      ? clip.src
      : staticFile(clip.src);

    const clipDurationInFrames = Math.max(
      1,
      Math.round((clip.durationInSeconds || 6) * fps)
    );

    const video = (
      <OffthreadVideo
        src={resolvedSrc}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    );

    items.push(
      <TransitionSeries.Sequence
        key={`clip-${i}`}
        durationInFrames={perClipDuration}
      >
        <KenBurns
          durationInFrames={perClipDuration}
          direction={i % 2 === 0 ? "in" : "out"}
        >
          {perClipDuration > clipDurationInFrames ? (
            <Loop durationInFrames={clipDurationInFrames}>{video}</Loop>
          ) : (
            video
          )}
        </KenBurns>
      </TransitionSeries.Sequence>
    );

    if (i < clips.length - 1) {
      items.push(
        <TransitionSeries.Transition
          key={`transition-${i}`}
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
      );
    }
  });

  return <TransitionSeries>{items}</TransitionSeries>;
};

// Üstte ilerleyen ince çubuk. Shorts'ta izleyiciye "az kaldı, bitişini gör"
// hissi verdiği için bırakma oranını düşürür; videonun ne kadar süreceğini
// baştan gösterir.
const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 10,
        background: "rgba(255,255,255,0.18)",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: "#FFD400",
          boxShadow: "0 0 14px rgba(255,212,0,0.8)",
        }}
      />
    </div>
  );
};

// Videonun ilk saniyelerinde ekranı kaplayan kanca yazısı. İzleyicinin
// kaydırmayı bırakmasını sağlayan tek en önemli görsel öğe: sesle aynı anda
// merak boşluğunu açar, sesi kapalı izleyene de mesajı ulaştırır.
const HookCard: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pop = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 140, mass: 0.6 },
  });
  const opacity = interpolate(
    frame,
    [0, 2, durationInFrames - 8, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  // Kanca birkaç saniye ekranda kalıyor; sabit bir görüntü "donmuş" hissi
  // verdiği için yazıya çok hafif bir yaklaşma veriyoruz.
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.05], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: "0 70px",
        opacity,
      }}
    >
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.38)" }} />
      <div
        style={{
          fontFamily: "Montserrat, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 96,
          lineHeight: 1.15,
          color: "#FFFFFF",
          textAlign: "center",
          WebkitTextStroke: "7px rgba(0,0,0,0.9)",
          paintOrder: "stroke fill",
          transform: `scale(${(0.75 + pop * 0.25) * drift})`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14 } });
  const opacity = interpolate(frame, [75, 95], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 140,
        left: 40,
        right: 40,
        textAlign: "center",
        opacity,
        transform: `translateY(${(1 - enter) * -40}px)`,
      }}
    >
      <div
        style={{
          display: "inline-block",
          background: "rgba(0,0,0,0.55)",
          borderRadius: 20,
          padding: "18px 28px",
        }}
      >
        <span
          style={{
            fontFamily: "Montserrat, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 52,
            color: "#FFFFFF",
            lineHeight: 1.2,
          }}
        >
          {title}
        </span>
      </div>
    </div>
  );
};

const PhaseBadge: React.FC<{ phases: PhaseMarker[]; words: WordTiming[] }> = ({
  phases,
  words,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const active = useMemo(() => {
    let current: PhaseMarker | null = null;
    for (const p of phases) {
      const wordStart = words[p.startWordIndex]?.start ?? 0;
      if (t >= wordStart) current = p;
    }
    return current;
  }, [phases, words, t]);

  if (!active || active.badge === false) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        right: 40,
        background: active.color,
        borderRadius: 16,
        padding: "12px 26px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
      }}
    >
      <span
        style={{
          fontFamily: "Montserrat, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 40,
          color: "#FFFFFF",
          letterSpacing: 1,
        }}
      >
        {active.label}
      </span>
    </div>
  );
};

const FLASH_DURATION_FRAMES = 24; // 0.8s @ 30fps

const PhaseFlashContent: React.FC<{ label: string; color: string }> = ({
  label,
  color,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    frame,
    fps,
    config: { damping: 9, stiffness: 180, mass: 0.5 },
  });
  const opacity = interpolate(
    frame,
    [0, 3, FLASH_DURATION_FRAMES - 8, FLASH_DURATION_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const flashOpacity = interpolate(
    frame,
    [0, 2, 9, FLASH_DURATION_FRAMES],
    [0, 0.6, 0.22, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <AbsoluteFill style={{ backgroundColor: color, opacity: flashOpacity }} />
      <div
        style={{
          fontFamily: "Montserrat, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 118,
          color: "#FFFFFF",
          WebkitTextStroke: "6px rgba(0,0,0,0.9)",
          paintOrder: "stroke fill",
          textAlign: "center",
          opacity,
          transform: `scale(${0.3 + pop * 0.9})`,
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};

// Her faz (HOOK -> YANLIŞ -> DOĞRU -> ABONE OL) değişiminde ekranın ortasında
// büyükçe yanıp sönen, ses efektli bir "flaş" gösterir - videoya vurgu/enerji katar.
const PhaseFlash: React.FC<{ phases: PhaseMarker[]; words: WordTiming[] }> = ({
  phases,
  words,
}) => {
  const { fps } = useVideoConfig();
  const sfxSrc = staticFile("sfx/transition.mp3");

  return (
    <>
      {phases.slice(1).map((p, i) => {
        const startSeconds = words[p.startWordIndex]?.start ?? 0;
        const startFrame = Math.max(0, Math.round(startSeconds * fps));
        return (
          <Sequence
            key={i}
            from={startFrame}
            durationInFrames={FLASH_DURATION_FRAMES}
          >
            <PhaseFlashContent label={p.label} color={p.color} />
            <Audio src={sfxSrc} />
          </Sequence>
        );
      })}
    </>
  );
};

// CTA bölümünde ekrana gelen, nabız gibi atan abone butonu + dokunan parmak.
// "Abone ol" sözünü sadece duymak yerine görmek dönüşümü belirgin artırır.
const SubscribeCue: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 11, stiffness: 150, mass: 0.6 },
  });
  // ~0.9 saniyede bir nabız
  const pulse = 1 + 0.06 * Math.sin((frame / fps) * Math.PI * 2.2);
  const tap = interpolate(frame % 40, [0, 8, 16, 40], [0, 1, 0, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 340,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        transform: `translateY(${(1 - enter) * 60}px) scale(${enter * pulse})`,
      }}
    >
      {/* Buton ekranın tam ortasında dursun diye parmak, akışa girmeden
          butona göre konumlanıyor (flex içinde yan yana dizilirlerse ikisinin
          ortak merkezi ortalanır ve buton sola kayar). */}
      <div style={{ position: "relative" }}>
        <div
          style={{
            background: "#FF0033",
            borderRadius: 999,
            padding: "22px 54px",
            boxShadow: "0 10px 34px rgba(255,0,51,0.45)",
            fontFamily: "Montserrat, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 54,
            color: "#FFFFFF",
            letterSpacing: 1,
          }}
        >
          ABONE OL
        </div>
        <div
          style={{
            position: "absolute",
            left: "100%",
            top: "50%",
            marginLeft: 12,
            fontSize: 76,
            transform: `translateY(-40%) scale(${1 + tap * 0.35}) rotate(${
              -12 + tap * 8
            }deg)`,
          }}
        >
          👆
        </div>
      </div>
    </div>
  );
};

export const ShortVideo: React.FC<ShortVideoProps> = ({
  title,
  audioSegments,
  backgroundClips,
  words,
  phases,
  hookText,
  hookEndSeconds,
  musicSrc,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const lines = useMemo(() => groupWordsIntoLines(words), [words]);

  const hookFrames = Math.max(
    1,
    Math.round((hookEndSeconds ?? 0) * fps)
  );
  const showHook = Boolean(hookText) && (hookEndSeconds ?? 0) > 0;

  const subscribePhase = (phases ?? []).find((p) => p.cue === "subscribe");
  const subscribeStartFrame = subscribePhase
    ? Math.max(
        0,
        Math.round((words[subscribePhase.startWordIndex]?.start ?? 0) * fps)
      )
    : null;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <BackgroundReel clips={backgroundClips} />

      {/* Okunabilirlik için karartma */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      {showHook ? (
        <Sequence from={0} durationInFrames={hookFrames}>
          <HookCard text={hookText as string} />
        </Sequence>
      ) : (
        <Sequence from={0}>
          <TitleCard title={title} />
        </Sequence>
      )}

      {phases && phases.length > 0 && (
        <>
          <PhaseBadge phases={phases} words={words} />
          <PhaseFlash phases={phases} words={words} />
        </>
      )}

      {subscribeStartFrame !== null && (
        <Sequence
          from={subscribeStartFrame}
          durationInFrames={Math.max(1, durationInFrames - subscribeStartFrame)}
        >
          <SubscribeCue />
        </Sequence>
      )}

      {/* Kanca ekrandayken altyazıyı bastırıyoruz: aynı cümle hem ortada dev
          puntoyla hem altta kelime kelime akarsa ekran kalabalıklaşıyor.
          (Sequence ile sarmalamıyoruz; Sequence içinde useCurrentFrame sıfırdan
          başlar ve altyazının mutlak zaman damgaları kayar.) */}
      <Captions
        lines={lines}
        hideBeforeSeconds={showHook ? hookEndSeconds ?? 0 : 0}
      />

      <ProgressBar />

      {musicSrc ? (
        <Audio
          src={musicSrc.startsWith("http") ? musicSrc : staticFile(musicSrc)}
          volume={0.07}
          loop
        />
      ) : null}

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
