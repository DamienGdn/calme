import { describe, expect, it } from 'vitest';
import { safeMailHtml } from '../src/mailHtml.ts';

describe('safeMailHtml', () => {
  it('keeps the layout: tables, inline styles, style blocks, images and links', () => {
    const html = '<style>.x{color:red}</style><table style="width:600px"><tr><td class="x"><a href="https://a.fr">A</a><img src="https://img.fr/a.png" alt=""></td></tr></table>';
    expect(safeMailHtml(html)).toBe(html);
  });

  it('removes scripts, frames, embeds and SVG with their content', () => {
    const out = safeMailHtml('<p>a</p><script>alert(1)</script><iframe src="https://x"></iframe><object data="x"></object><embed src="x"><svg><script>1</script></svg><p>b</p>');
    expect(out).toBe('<p>a</p><p>b</p>');
  });

  it('removes event handlers, whatever their quoting', () => {
    const out = safeMailHtml(`<img src="https://i.fr/a.png" onerror="steal()"><div onclick='x()' onMouseOver=y()>t</div>`);
    expect(out).not.toMatch(/on(error|click|mouseover)/i);
    expect(out).toContain('src="https://i.fr/a.png"');
  });

  it('neutralises javascript:, vbscript: and data:text/html links', () => {
    const out = safeMailHtml('<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:x">b</a><a href="vbscript:x">c</a><a href="data:text/html,<b>">d</a>');
    expect(out).not.toMatch(/javascript:|vbscript:|data:text\/html/i);
  });

  it('removes redirects, base, remote stylesheets and form controls but keeps their text', () => {
    const out = safeMailHtml('<meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/"><link rel="stylesheet" href="https://x.css"><form action="https://evil"><p>Note</p><input name="pw"><button>Envoyer</button></form>');
    expect(out).not.toMatch(/<meta|<base|<link|<form|<input|<\/form/i);
    expect(out).toContain('<p>Note</p>');
    expect(out).toContain('Envoyer');
  });
});
