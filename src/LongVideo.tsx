import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ---------------------------------------------------------------------------
// Tip tanımları - storyboard.json bu şekilde üretilir (scripts/produceVideo.mjs)
// ---------------------------------------------------------------------------

export type Word = { word: string; start: number; end: number };

export type DynamicElement =
  | { type: "none" }
  | { type: "lowerThird"; data: { name: string; description?: string } }
  | {
      type: "statCounter";
      data: { counters: { value: number; label: string; suffix?: string }[] };
    }
  | { type: "infoBox"; data: { title: string; content: string } };

export type LongScene = {
  id: string;
  kind: "intro" | "image" | "video" | "titleCard" | "endCard";
  media: { kind: "image" | "video" | "none"; src: string | null };
  audioSrc: string | null;
  durationInSeconds: number;
  words: Word[];
  heading?: string | null;
  subheading?: string | null;
  kenBurns?: { zoomFrom: number; zoomTo: number; panX: number; panY: number };
  dynamic?: DynamicElement;
};

export type Theme = {
  primary: string;
  secondary: string;
  accent: string;
  titleFont: string;
  bodyFont: string;
};

export type LongVideoProps = {
  title: string;
  theme: Theme;
  scenes: LongScene[];
  musicSrc: string | null;
  watermark?: string | null;
};

export const DEFAULT_THEME: Theme = {
  primary: "#F5B301",
  secondary: "#101820",
  accent: "#2FB65A",
  titleFont: "Segoe UI Semibold, Inter, system-ui, sans-serif",
  bodyFont: "Segoe UI, Inter, system-ui, sans-serif",
};

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const FADE = 0.45; // sahne başı/sonu yumuşak geçiş süresi (saniye)

const useSeconds = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
};

// Altyazı: konuşulan kelime vurgulu, en fazla 7 kelimelik satırlar halinde
const CHUNK = 7;

const Subtitles: React.FC<{ words: Word[]; theme: Theme }> = ({
  words,
  theme,
}) => {
  const t = useSeconds();
  if (!words.length) return null;

  let activeIndex = words.findIndex((w) => t >= w.start && t <= w.end);
  if (activeIndex === -1) {
    // kelimeler arasındaki boşluklarda son söylenen kelimede kal
    for (let i = 0; i < words.length; i++) {
      if (words[i].start <= t) activeIndex = i;
    }
  }
  if (activeIndex === -1) return null;

  const chunkIndex = Math.floor(activeIndex / CHUNK);
  const chunk = words.slice(chunkIndex * CHUNK, chunkIndex * CHUNK + CHUNK);
  const localActive = activeIndex - chunkIndex * CHUNK;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 96,
        display: "flex",
        justifyContent: "center",
        padding: "0 140px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 16px",
          background: "rgba(8,10,14,0.55)",
          borderRadius: 18,
          padding: "18px 32px",
          maxWidth: 1400,
        }}
      >
        {chunk.map((w, i) => (
          <span
            key={`${w.word}-${i}`}
            style={{
              fontFamily: theme.bodyFont,
              fontSize: 52,
              fontWeight: 700,
              letterSpacing: -0.5,
              color: i === localActive ? theme.primary : "#F4F6F8",
              textShadow: "0 4px 18px rgba(0,0,0,0.65)",
              transform: i === localActive ? "translateY(-3px)" : "none",
            }}
          >
            {w.word}
          </span>
        ))}
      </div>
    </div>
  );
};

// Ken Burns: sabit görseli yavaş zoom + pan ile canlandırır
const KenBurnsImage: React.FC<{
  src: string;
  duration: number;
  config: NonNullable<LongScene["kenBurns"]>;
}> = ({ src, duration, config }) => {
  const t = useSeconds();
  const progress = Math.min(1, Math.max(0, t / Math.max(0.1, duration)));
  const scale = interpolate(progress, [0, 1], [config.zoomFrom, config.zoomTo]);
  const x = interpolate(progress, [0, 1], [0, config.panX]);
  const y = interpolate(progress, [0, 1], [0, config.panY]);

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#05070B" }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translate(${x}px, ${y}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

const VideoLayer: React.FC<{ src: string }> = ({ src }) => (
  <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#05070B" }}>
    <OffthreadVideo
      src={staticFile(src)}
      muted
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </AbsoluteFill>
);

// Görüntünün üzerine sinematik karartma - altyazı her zaman okunur kalsın
const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(4,6,10,0.55) 0%, rgba(4,6,10,0.05) 32%, rgba(4,6,10,0.15) 62%, rgba(4,6,10,0.85) 100%)",
    }}
  />
);

// ---------------------------------------------------------------------------
// Dinamik öğeler
// ---------------------------------------------------------------------------

const LowerThird: React.FC<{
  data: { name: string; description?: string };
  theme: Theme;
}> = ({ data, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 20,
  });
  const x = interpolate(enter, [0, 1], [-620, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: 90,
        bottom: 250,
        transform: `translateX(${x}px)`,
        display: "flex",
        alignItems: "stretch",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ width: 12, backgroundColor: theme.primary }} />
      <div style={{ backgroundColor: "rgba(10,13,18,0.9)", padding: "20px 34px" }}>
        <div
          style={{
            fontFamily: theme.titleFont,
            fontSize: 46,
            fontWeight: 800,
            color: "#FFFFFF",
          }}
        >
          {data.name}
        </div>
        {data.description ? (
          <div
            style={{
              fontFamily: theme.bodyFont,
              fontSize: 30,
              color: theme.primary,
              marginTop: 6,
            }}
          >
            {data.description}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const StatCounter: React.FC<{
  data: { counters: { value: number; label: string; suffix?: string }[] };
  theme: Theme;
}> = ({ data, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 45,
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 140,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        gap: 90,
      }}
    >
      {data.counters.map((c, i) => (
        <div key={i} style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: theme.titleFont,
              fontSize: 96,
              fontWeight: 900,
              color: theme.primary,
              textShadow: "0 8px 30px rgba(0,0,0,0.55)",
            }}
          >
            {Math.round(c.value * p).toLocaleString("tr-TR")}
            {c.suffix ?? ""}
          </div>
          <div
            style={{
              fontFamily: theme.bodyFont,
              fontSize: 34,
              color: "#EEF1F5",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
};

const InfoBox: React.FC<{
  data: { title: string; content: string };
  theme: Theme;
}> = ({ data, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 22,
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 110,
        right: 90,
        width: 520,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [-40, 0])}px)`,
        backgroundColor: "rgba(10,13,18,0.88)",
        borderTop: `6px solid ${theme.accent}`,
        borderRadius: 12,
        padding: "24px 28px",
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          fontFamily: theme.titleFont,
          fontSize: 38,
          fontWeight: 800,
          color: "#FFFFFF",
          marginBottom: 8,
        }}
      >
        {data.title}
      </div>
      <div
        style={{
          fontFamily: theme.bodyFont,
          fontSize: 28,
          lineHeight: 1.35,
          color: "#C9D2DD",
        }}
      >
        {data.content}
      </div>
    </div>
  );
};

const DynamicLayer: React.FC<{ element?: DynamicElement; theme: Theme }> = ({
  element,
  theme,
}) => {
  if (!element || element.type === "none") return null;
  if (element.type === "lowerThird")
    return <LowerThird data={element.data} theme={theme} />;
  if (element.type === "statCounter")
    return <StatCounter data={element.data} theme={theme} />;
  if (element.type === "infoBox")
    return <InfoBox data={element.data} theme={theme} />;
  return null;
};

// ---------------------------------------------------------------------------
// Kartlar (titleCard / endCard) - AI görseli gerektirmez, tamamen kodla çizilir
// ---------------------------------------------------------------------------

const Card: React.FC<{
  heading: string;
  subheading?: string | null;
  theme: Theme;
  variant: "title" | "end";
  hasMedia?: boolean;
}> = ({ heading, subheading, theme, variant, hasMedia }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 30,
  });

  return (
    <AbsoluteFill
      style={{
        background: hasMedia
          ? "linear-gradient(180deg, rgba(4,6,10,0.72) 0%, rgba(4,6,10,0.58) 50%, rgba(4,6,10,0.82) 100%)"
          : `radial-gradient(circle at 30% 20%, ${theme.secondary} 0%, #04060A 70%)`,
        justifyContent: "center",
        alignItems: "center",
        // Altta altyazı şeridi için yer bırakılır
        padding: "140px 140px 300px",
      }}
    >
      <div
        style={{
          width: interpolate(p, [0, 1], [0, 220]),
          height: 8,
          backgroundColor: theme.primary,
          marginBottom: 42,
          borderRadius: 4,
        }}
      />
      <div
        style={{
          fontFamily: theme.titleFont,
          fontSize: variant === "title" ? 116 : 96,
          fontWeight: 900,
          color: "#FFFFFF",
          textAlign: "center",
          lineHeight: 1.08,
          opacity: p,
          transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px)`,
          textShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        {heading}
      </div>
      {subheading ? (
        <div
          style={{
            fontFamily: theme.bodyFont,
            fontSize: 44,
            color: theme.primary,
            marginTop: 36,
            textAlign: "center",
            opacity: interpolate(p, [0.4, 1], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {subheading}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Tek sahne
// ---------------------------------------------------------------------------

const SceneView: React.FC<{ scene: LongScene; theme: Theme }> = ({
  scene,
  theme,
}) => {
  const t = useSeconds();
  const d = scene.durationInSeconds;

  // Sahne başında ve sonunda yumuşak geçiş (dissolve hissi)
  const opacity = Math.min(
    interpolate(t, [0, FADE], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    interpolate(t, [d - FADE, d], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  const isCard = scene.kind === "titleCard" || scene.kind === "endCard";

  return (
    <AbsoluteFill style={{ opacity }}>
      <>
          {scene.media.kind === "image" && scene.media.src ? (
            <KenBurnsImage
              src={scene.media.src}
              duration={d}
              config={
                scene.kenBurns ?? {
                  zoomFrom: 1.06,
                  zoomTo: 1.18,
                  panX: -20,
                  panY: 10,
                }
              }
            />
          ) : null}
          {scene.media.kind === "video" && scene.media.src ? (
            <VideoLayer src={scene.media.src} />
          ) : null}
          {scene.media.kind === "none" ? (
            <AbsoluteFill
              style={{
                background: `linear-gradient(140deg, ${theme.secondary}, #04060A)`,
              }}
            />
          ) : null}
          <Vignette />
          {!isCard ? <DynamicLayer element={scene.dynamic} theme={theme} /> : null}
      </>

      {isCard ? (
        <Card
          heading={scene.heading ?? ""}
          subheading={scene.subheading}
          theme={theme}
          variant={scene.kind === "titleCard" ? "title" : "end"}
          hasMedia={scene.media.kind !== "none"}
        />
      ) : null}

      {scene.audioSrc ? <Audio src={staticFile(scene.audioSrc)} /> : null}
      <Subtitles words={scene.words} theme={theme} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Ana kompozisyon
// ---------------------------------------------------------------------------

export const LongVideo: React.FC<LongVideoProps> = ({
  theme,
  scenes,
  musicSrc,
  watermark,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  let cursor = 0;
  const positioned = scenes.map((scene) => {
    const from = Math.round(cursor * fps);
    const frames = Math.max(1, Math.round(scene.durationInSeconds * fps));
    cursor += scene.durationInSeconds;
    return { scene, from, frames };
  });

  const progress = frame / Math.max(1, durationInFrames);

  return (
    <AbsoluteFill style={{ backgroundColor: "#04060A" }}>
      {positioned.map(({ scene, from, frames }) => (
        <Sequence key={scene.id} from={from} durationInFrames={frames}>
          <SceneView scene={scene} theme={theme} />
        </Sequence>
      ))}

      {musicSrc ? <Audio src={staticFile(musicSrc)} volume={0.06} loop /> : null}

      {/* İnce ilerleme çubuğu - izleyiciye "ne kadar kaldı" hissi verir */}
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: 6,
          width: `${progress * 100}%`,
          backgroundColor: theme.primary,
          opacity: 0.85,
        }}
      />

      {watermark ? (
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 64,
            fontFamily: theme.bodyFont,
            fontSize: 28,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.72)",
          }}
        >
          {watermark}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
