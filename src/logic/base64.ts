// UTF-8-tekst naar base64 (GitHub wil bestandsinhoud in base64), zonder afhankelijkheden.
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63];
    out += i + 1 < bytes.length ? CHARS[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? CHARS[n & 63] : '=';
  }
  return out;
}
