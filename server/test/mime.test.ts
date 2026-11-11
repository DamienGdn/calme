import { describe, expect, it } from 'vitest';
import { buildMime, htmlToText, parseGmailMessage, parseListUnsubscribe } from '../src/mime.ts';

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');

function gmailMsg(parts: object, headers: Record<string, string> = {}) {
  return {
    id: 'm1',
    threadId: 't1',
    snippet: 'snip',
    internalDate: '1762851600000',
    labelIds: ['INBOX', 'UNREAD'],
    payload: {
      headers: Object.entries({ From: '"Sophie Martin" <s@x.fr>', To: 'moi@x.fr', Subject: 'Dîner', 'Message-ID': '<abc@x.fr>', ...headers }).map(
        ([name, value]) => ({ name, value }),
      ),
      ...parts,
    },
  };
}

describe('parseGmailMessage', () => {
  it('decodes a text/plain body and sender', () => {
    const m = parseGmailMessage(gmailMsg({ mimeType: 'text/plain', body: { data: b64u('Salut, ça va ?') } }));
    expect(m.text).toBe('Salut, ça va ?');
    expect(m.fromName).toBe('Sophie Martin');
    expect(m.fromEmail).toBe('s@x.fr');
    expect(m.subject).toBe('Dîner');
    expect(m.messageIdHeader).toBe('<abc@x.fr>');
    expect(m.date).toBe(1762851600000);
  });

  it('prefers text/plain inside multipart/alternative', () => {
    const m = parseGmailMessage(
      gmailMsg({
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64u('texte') } },
          { mimeType: 'text/html', body: { data: b64u('<p>html</p>') } },
        ],
      }),
    );
    expect(m.text).toBe('texte');
  });

  it('falls back to html converted to text', () => {
    const m = parseGmailMessage(
      gmailMsg({ mimeType: 'text/html', body: { data: b64u('<style>p{}</style><p>Caf&eacute;<br>ouvert</p><script>x()</script>') } }),
    );
    expect(m.text).toBe('Café\nouvert');
  });

  it('decodes the declared charset (iso-8859-1)', () => {
    const latin1 = Buffer.from('Réunion à 18h', 'latin1');
    const m = parseGmailMessage(
      gmailMsg({ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }], body: { data: b64u(latin1) } }),
    );
    expect(m.text).toBe('Réunion à 18h');
  });

  it('lists attachment names', () => {
    const m = parseGmailMessage(
      gmailMsg({
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: b64u('voir pj') } },
          { mimeType: 'application/pdf', filename: 'AG.pdf', body: { attachmentId: 'x' } },
        ],
      }),
    );
    expect(m.attachmentNames).toEqual(['AG.pdf']);
  });

  it('handles a sender without display name', () => {
    const m = parseGmailMessage(gmailMsg({ mimeType: 'text/plain', body: { data: b64u('x') } }, { From: 'news@x.fr' }));
    expect(m.fromName).toBe('news@x.fr');
    expect(m.fromEmail).toBe('news@x.fr');
  });
});

describe('htmlToText', () => {
  it('decodes entities and collapses blank lines', () => {
    expect(htmlToText('<div>A&nbsp;&amp;&#233;</div>\n\n\n\n<div>B</div>')).toBe('A &é\n\nB');
  });
});

describe('parseListUnsubscribe', () => {
  it('detects one-click and mailto', () => {
    expect(parseListUnsubscribe('<mailto:u@x.fr>, <https://x.fr/u>', 'List-Unsubscribe=One-Click')).toEqual({
      oneClickUrl: 'https://x.fr/u',
      mailto: 'u@x.fr',
    });
  });
  it('returns plain http url without post header', () => {
    expect(parseListUnsubscribe('<https://x.fr/u>')).toEqual({ httpUrl: 'https://x.fr/u' });
  });
  it('returns null when absent', () => {
    expect(parseListUnsubscribe(undefined)).toBeNull();
  });
});

describe('buildMime', () => {
  const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

  it('encodes accented subject and attachment names, threads the reply', () => {
    const raw = decode(
      buildMime({
        from: 'moi@x.fr',
        to: 's@x.fr',
        subject: 'Re: Dîner',
        body: 'Avec plaisir',
        inReplyTo: '<abc@x.fr>',
        references: '<abc@x.fr>',
        attachments: [{ filename: 'récap.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF') }],
      }),
    );
    expect(raw).toContain('Subject: =?UTF-8?B?' + Buffer.from('Re: Dîner').toString('base64') + '?=');
    expect(raw).toContain("filename*=UTF-8''r%C3%A9cap.pdf");
    expect(raw).toContain('In-Reply-To: <abc@x.fr>');
    expect(raw).toContain('References: <abc@x.fr>');
    expect(raw).toContain(Buffer.from('Avec plaisir').toString('base64'));
    expect(raw).toContain(Buffer.from('%PDF').toString('base64'));
  });

  it('omits cc when empty and rejects header injection', () => {
    const raw = decode(buildMime({ from: 'a@x.fr', to: 'b@x.fr', subject: 'x', body: 'y', attachments: [] }));
    expect(raw).not.toContain('Cc:');
    expect(() => buildMime({ from: 'a@x.fr', to: 'b@x.fr\r\nBcc: c@x.fr', subject: 'x', body: 'y', attachments: [] })).toThrow();
  });
});

describe('parseGmailMessage html', () => {
  it('keeps the HTML part next to the text one', () => {
    const m = parseGmailMessage({
      id: 'h1',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [{ name: 'From', value: 'A <a@x.fr>' }],
        parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from('plain').toString('base64url') } },
          { mimeType: 'text/html', body: { data: Buffer.from('<p>riche</p>').toString('base64url') } },
        ],
      },
    });
    expect(m.text).toBe('plain');
    expect(m.html).toBe('<p>riche</p>');
  });

  it('has no html for a plain-text mail', () => {
    const m = parseGmailMessage({ id: 'p1', payload: { mimeType: 'text/plain', headers: [], body: { data: Buffer.from('x').toString('base64url') } } });
    expect(m.html).toBeUndefined();
  });
});

