/** Phone numbers in a mail's text, to make them callable (tel: links). Dates, amounts and references are left alone. */
export interface Phone {
  start: number;
  end: number;
  raw: string;
  tel: string;
}

const SEP = '[ .\\-\\u00a0]?';
// French: 0X XX XX XX XX (any of space, dot, dash or nothing between pairs), or +33 / 0033 then 9 digits, maybe "(0)".
const FR = `(?:(?:\\+|00)33${SEP}(?:\\(0\\)${SEP})?[1-9]|0[1-9])(?:${SEP}\\d{2}){4}`;
// Elsewhere: a + and 8 to 14 more digits in groups.
const INTL = `\\+(?!33)[1-9]\\d{0,2}(?:${SEP}\\(?\\d{1,4}\\)?){2,5}`;
const RE = new RegExp(`(?<![\\w+/.,-])(${FR}|${INTL})(?![\\w/]|[.,]\\d)`, 'g');

export function findPhones(text: string): Phone[] {
  const out: Phone[] = [];
  for (const m of text.matchAll(RE)) {
    const raw = m[1];
    const digits = raw.replace(/\(0\)/, '').replace(/[^\d+]/g, '').replace(/^00/, '+');
    const n = digits.replace(/\D/g, '').length;
    if (n < 9 || n > 15) continue;
    out.push({ start: m.index!, end: m.index! + raw.length, raw, tel: `tel:${digits}` });
  }
  return out;
}
