// Tek tek kelime zaman damgalarını (ElevenLabs / benzeri TTS çıktısı)
// ekranda gösterilecek altyazı satırlarına (chunk) gruplar.
// Her satır en fazla MAX_CHARS karakter veya MAX_WORDS kelime içerir.

export type WordTiming = {
  word: string;
  start: number; // saniye
  end: number; // saniye
};

export type CaptionLine = {
  words: WordTiming[];
  start: number;
  end: number;
};

const MAX_WORDS_PER_LINE = 4;
const MAX_CHARS_PER_LINE = 26;

export function groupWordsIntoLines(words: WordTiming[]): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: WordTiming[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
    currentChars = 0;
  };

  for (const w of words) {
    const wouldBeChars = currentChars + w.word.length + 1;
    if (
      current.length >= MAX_WORDS_PER_LINE ||
      wouldBeChars > MAX_CHARS_PER_LINE
    ) {
      flush();
    }
    current.push(w);
    currentChars += w.word.length + 1;
  }
  flush();

  return lines;
}

export function findActiveLine(
  lines: CaptionLine[],
  timeInSeconds: number
): CaptionLine | null {
  for (const line of lines) {
    if (timeInSeconds >= line.start && timeInSeconds <= line.end) {
      return line;
    }
  }
  return null;
}
