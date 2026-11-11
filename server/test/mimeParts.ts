/** Decoded text of the MIME part with this content type. */
export function part(raw: string, type: string): string {
  const m = new RegExp(`Content-Type: ${type.replace('/', '\\/')}[^\\n]*\\r?\\n(?:[^\\r\\n]+\\r?\\n)*\\r?\\n([A-Za-z0-9+/=\\r\\n]+)`).exec(raw);
  return m ? Buffer.from(m[1].replace(/\s/g, ''), 'base64').toString() : '';
}
