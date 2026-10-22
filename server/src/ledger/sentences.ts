/**
 * Sentence splitter with character offsets using native Intl.Segmenter.
 * Accurately parses sentences, avoiding false splits on abbreviations (e.g. "No.1")
 * or decimals (e.g. "4.8").
 */
export interface SentenceSpan {
  text: string;
  startOffset: number;
  endOffset: number;
}

export function splitIntoSentences(text: string): SentenceSpan[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const results: SentenceSpan[] = [];

  for (const { segment, index } of segmenter.segment(text)) {
    const trimmed = segment.trim();
    if (trimmed.length > 0) {
      const leadingWhitespace = segment.indexOf(trimmed);
      const start = index + (leadingWhitespace >= 0 ? leadingWhitespace : 0);
      const end = start + trimmed.length;
      results.push({
        text: trimmed,
        startOffset: start,
        endOffset: end,
      });
    }
  }

  return results;
}
