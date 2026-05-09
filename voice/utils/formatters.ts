export function speakDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

export function concise(sentences: string[]): string {
  return sentences.filter(Boolean).slice(0, 3).join(' ');
}
