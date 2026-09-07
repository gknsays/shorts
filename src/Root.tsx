import React from "react";
import { Composition } from "remotion";
import { ShortVideo, ShortVideoProps } from "./ShortVideo";
import { LongVideo, LongVideoProps, DEFAULT_THEME } from "./LongVideo";
import { RankingVideo, RankingVideoProps } from "./RankingVideo";
import { QuizVideo, QuizVideoProps, quizSureleri } from "./QuizVideo";

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
    { label: "OLAY", color: "#38BDF8", startWordIndex: 5, badge: true },
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

// --- Yatay (16:9) uzun video kompozisyonu ---------------------------------
// Sahne süreleri seslendirmeden gelir; toplam süre sahnelerin toplamıdır.
const longDefaultProps: LongVideoProps = {
  title: "Örnek Video",
  theme: DEFAULT_THEME,
  musicSrc: null,
  watermark: null,
  scenes: [
    {
      id: "scene-1",
      kind: "titleCard",
      media: { kind: "none", src: null },
      audioSrc: null,
      durationInSeconds: 3,
      words: [],
      heading: "Örnek Video",
      subheading: "produce-video ile üretilir",
    },
  ],
};

const calculateLongDuration = async ({ props }: { props: LongVideoProps }) => {
  const total = (props.scenes ?? []).reduce(
    (sum, s) => sum + (s.durationInSeconds || 0),
    0
  );
  return {
    durationInFrames: Math.max(FPS, Math.round(total * FPS)),
    props,
  };
};

// --- Görsel odaklı formatlar ----------------------------------------------
// Bu iki kompozisyon stok video ya da yapay zekâ görseli KULLANMAZ; her şeyi
// Remotion çiziyor. Projedeki bütün görsel sorunların kaynağı dışarıdan gelen
// görüntünün konuyla eşleşmemesiydi; burada o bağımlılık yok.

const RANKING_INTRO = 2.2;
const RANKING_PER_ITEM = 2.1;
const RANKING_OUTRO = 2.6;

const rankingDefaultProps: RankingVideoProps = {
  title: "1 milyon TL kaç yıl yeter?",
  subtitle: "Günlük harcamana göre",
  items: [
    { label: "Günde 2.000 TL", value: 1.4, display: "1,4 yıl" },
    { label: "Günde 1.000 TL", value: 2.7, display: "2,7 yıl" },
    { label: "Günde 500 TL", value: 5.5, display: "5,5 yıl" },
    { label: "Günde 250 TL", value: 11.0, display: "11,0 yıl" },
    { label: "Günde 100 TL", value: 27.4, display: "27,4 yıl" },
  ],
  outro: "Sen hangisindesin?",
  // Bu bir sıralama değil karşılaştırma: "1 numara" rozeti burada anlamsız.
  showRank: false,
  musicSrc: null,
  audioSegments: [],
};

const calculateRankingDuration = async ({
  props,
}: {
  props: RankingVideoProps;
}) => {
  const n = (props.items ?? []).length;
  const toplam =
    (props.introSeconds ?? RANKING_INTRO) +
    n * (props.secondsPerItem ?? RANKING_PER_ITEM) +
    (props.outroSeconds ?? RANKING_OUTRO);
  return { durationInFrames: Math.max(FPS, Math.round(toplam * FPS)), props };
};

const quizDefaultProps: QuizVideoProps = {
  title: "Bunları biliyor musun?",
  questions: [
    {
      soru: "Bir yumurtayı buzdolabında ne kadar saklayabilirsin?",
      secenekler: ["1 hafta", "3-5 hafta", "3 ay"],
      dogru: 1,
    },
    {
      soru: "Çamaşır makinesinde en çok elektriği ne harcar?",
      secenekler: ["Suyu ısıtmak", "Tamburu döndürmek", "Sıkma"],
      dogru: 0,
    },
    {
      soru: "Telefon şarjı en çok neyden yıpranır?",
      secenekler: ["Gece boyu şarjda kalmak", "Isı", "Hızlı şarj"],
      dogru: 1,
    },
  ],
  outro: "Kaç tanesini bildin?",
  outroAlt: "Yorumda belirt 👇",
  channelName: "Fokus",
  channelAvatar: "brand/avatar.jpg",
  audioSegments: [],
};

const calculateQuizDuration = async ({ props }: { props: QuizVideoProps }) => {
  // Süre bileşenle aynı fonksiyondan geliyor; soru başına seslendirme
  // süreleri verildiğinde toplam otomatik uzuyor.
  const { toplam } = quizSureleri(props);
  return { durationInFrames: Math.max(FPS, Math.round(toplam * FPS)), props };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="LongVideo"
      component={LongVideo}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={longDefaultProps}
      calculateMetadata={calculateLongDuration}
    />
    <Composition
      id="RankingVideo"
      component={RankingVideo}
      durationInFrames={20 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={rankingDefaultProps}
      calculateMetadata={calculateRankingDuration}
    />
    <Composition
      id="QuizVideo"
      component={QuizVideo}
      durationInFrames={20 * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={quizDefaultProps}
      calculateMetadata={calculateQuizDuration}
    />
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
    </>
  );
};
