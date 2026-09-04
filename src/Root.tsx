import React from "react";
import { Composition } from "remotion";
import { ShortVideo, ShortVideoProps } from "./ShortVideo";

const FPS = 30;

// Varsayılan/önizleme verisi. Gerçek üretimde bu değerler
// scripts/render.mjs tarafından inputProps olarak override edilir.
const defaultProps: ShortVideoProps = {
  title: "Bulaşık Süngerini\nYanlış mı Kullanıyorsun?",
  hookText: "Süngerin en kirli yeri",
  hookEndSeconds: 2.3,
  musicSrc: null,
  audioSegments: [{ src: "sample/narration.mp3", offsetSeconds: 0 }],
  backgroundScenes: [
    { src: "sample/background.mp4", durationInSeconds: 5, fromSeconds: 0, toSeconds: 2 },
    { src: "sample/background.mp4", durationInSeconds: 5, fromSeconds: 2, toSeconds: 4.7 },
  ],
  words: [
    { word: "Bulaşık", start: 0.0, end: 0.4 },
    { word: "süngerini", start: 0.4, end: 0.9 },
    { word: "her", start: 0.9, end: 1.1 },
    { word: "gün", start: 1.1, end: 1.4 },
    { word: "değiştirmiyorsan", start: 1.4, end: 2.3 },
    { word: "yanlış", start: 2.3, end: 2.8 },
    { word: "yapıyorsun.", start: 2.8, end: 3.5 },
  ],
  phases: [
    { label: "HOOK", color: "#F59E0B", startWordIndex: 0, badge: false },
    { label: "YANLIŞ", color: "#E23B3B", startWordIndex: 5, badge: true },
  ],
};

const calculateDuration = async ({ props }: { props: ShortVideoProps }) => {
  const words = props.words ?? [];
  const lastEnd = words.length ? words[words.length - 1].end : 30;
  // Kapanışta uzun sessizlik bırakmıyoruz: Shorts'ta video biter bitmez baştan
  // döndüğü için kısa bir kuyruk, tekrar izlenme (loop) oranını yükseltir.
  const durationInFrames = Math.max(
    FPS * 3,
    Math.round((lastEnd + 0.5) * FPS)
  );
  return { durationInFrames, props };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ShortVideo"
      component={ShortVideo}
      durationInFrames={30 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
      calculateMetadata={calculateDuration}
    />
  );
};
