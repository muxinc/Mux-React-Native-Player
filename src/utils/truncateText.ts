export function truncateText(text: string, maxLength: number, ellipsis = '…'): string {
  if (text.length <= maxLength) return text;
  const budget = maxLength - ellipsis.length;
  if (budget <= 0) return ellipsis.slice(0, maxLength);

  const slice = text.slice(0, budget);
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (sentenceEnd > budget * 0.5) {
    // A complete sentence needs no ellipsis.
    return slice.slice(0, sentenceEnd + 1);
  }
  const wordEnd = slice.lastIndexOf(' ');
  if (wordEnd > budget * 0.5) {
    return slice.slice(0, wordEnd) + ellipsis;
  }
  return slice + ellipsis;
}
