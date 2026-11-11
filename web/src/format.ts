/**
 * Light formatting for Calm's own answers: paragraphs (blank lines) and **bold**. Returns plain text segments that the
 * template renders as text, so nothing in an answer (which may quote a mail) can become HTML.
 */
export type Segment = { text: string; bold: boolean };

export function richText(s: string): Segment[][] {
  return s
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const out: Segment[] = [];
      const re = /\*\*([^*\n]+?)\*\*/g;
      let last = 0;
      for (let m = re.exec(p); m; m = re.exec(p)) {
        if (m.index > last) out.push({ text: p.slice(last, m.index), bold: false });
        out.push({ text: m[1], bold: true });
        last = m.index + m[0].length;
      }
      if (last < p.length) out.push({ text: p.slice(last), bold: false });
      return out;
    });
}
