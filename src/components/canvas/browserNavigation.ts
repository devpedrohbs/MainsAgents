export const browserHome = 'https://www.google.com/';

export function browserDestination(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^(javascript|data|file|about):/i.test(value)) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  }
  if (!/\s/.test(value) && /^(localhost(?::\d+)?|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]|$)/i.test(value)) {
    try { return new URL(`https://${value}`).href; } catch { return null; }
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
