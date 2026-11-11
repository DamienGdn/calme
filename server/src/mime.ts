import { randomBytes } from 'node:crypto';
import type { gmail_v1 } from '@googleapis/gmail';
import type { MailMessage, Unsub } from './types.ts';

type Part = gmail_v1.Schema$MessagePart;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à',
  acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë', rsquo: '’',
  lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–', euro: '€', laquo: '«', raquo: '»',
  Eacute: 'É', Agrave: 'À', copy: '©', reg: '®', middot: '·', bull: '•', zwnj: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code] ?? all;
  });
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function header(part: Part | undefined, name: string): string {
  const h = part?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function decodeBody(part: Part): string {
  const data = part.body?.data;
  if (!data) return '';
  const charset = /charset="?([\w-]+)/i.exec(header(part, 'Content-Type'))?.[1] ?? 'utf-8';
  const bytes = Buffer.from(data, 'base64url');
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function walk(part: Part | undefined, out: Part[] = []): Part[] {
  if (!part) return out;
  out.push(part);
  for (const p of part.parts ?? []) walk(p, out);
  return out;
}

export function parseAddress(raw: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  const email = raw.trim().toLowerCase();
  return { name: email, email };
}

/** Splits a To/Cc header into addresses, keeping commas inside quoted display names. */
export function parseAddressList(raw: string): { name: string; email: string }[] {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  for (const ch of raw ?? '') {
    if (ch === '"') quoted = !quoted;
    if (ch === '<') angle = true;
    if (ch === '>') angle = false;
    if (ch === ',' && !quoted && !angle) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.includes('@')).map(parseAddress);
}

export function parseListUnsubscribe(value?: string, post?: string): Unsub | null {
  if (!value) return null;
  const items = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const out: Unsub = {};
  for (const it of items) {
    if (/^mailto:/i.test(it)) out.mailto ??= it.slice(7);
    else if (/^https?:/i.test(it)) {
      if (post && /One-Click/i.test(post)) out.oneClickUrl ??= it;
      else out.httpUrl ??= it;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Images a mail embeds and references from its HTML as cid:… (signatures, pasted pictures). */
export function inlineImages(msg: gmail_v1.Schema$Message): { cid: string; mimeType: string; data: string | null; attachmentId: string | null }[] {
  return walk(msg.payload ?? undefined)
    .filter((p) => p.mimeType?.startsWith('image/') && header(p, 'Content-ID'))
    .map((p) => ({
      cid: header(p, 'Content-ID').trim().replace(/^<|>$/g, ''),
      mimeType: p.mimeType as string,
      data: p.body?.data ?? null,
      attachmentId: p.body?.attachmentId ?? null,
    }));
}

/** Very large HTML (heavy newsletters) is not kept: the text version is shown instead. */
const keepHtml = (h: string) => (h.length <= 1_500_000 ? h : undefined);

export function parseGmailMessage(msg: gmail_v1.Schema$Message): MailMessage {
  const root = msg.payload ?? undefined;
  const parts = walk(root);
  const isAttachment = (p: Part) => Boolean(p.filename);
  const plain = parts.find((p) => p.mimeType === 'text/plain' && !isAttachment(p));
  const html = parts.find((p) => p.mimeType === 'text/html' && !isAttachment(p));
  const text = plain ? decodeBody(plain).trim() : html ? htmlToText(decodeBody(html)) : '';
  const from = parseAddress(header(root, 'From'));
  return {
    id: msg.id ?? '',
    threadId: msg.threadId ?? '',
    fromName: from.name,
    fromEmail: from.email,
    to: header(root, 'To'),
    cc: header(root, 'Cc'),
    subject: header(root, 'Subject'),
    date: Number(msg.internalDate ?? 0),
    snippet: decodeEntities(msg.snippet ?? ''),
    text: text.replace(/\r\n/g, '\n'),
    html: html ? keepHtml(decodeBody(html)) : undefined,
    messageIdHeader: header(root, 'Message-ID') || header(root, 'Message-Id'),
    references: header(root, 'References'),
    unsub: parseListUnsubscribe(header(root, 'List-Unsubscribe') || undefined, header(root, 'List-Unsubscribe-Post') || undefined),
    labelIds: msg.labelIds ?? [],
    attachmentNames: parts.filter(isAttachment).map((p) => p.filename as string),
  };
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface OutgoingMail {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments: OutgoingAttachment[];
}

const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');

function safe(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Invalid header value');
  return value;
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BOLD = /\*\*([^*\n]+?)\*\*/g;

/**
 * Calm's light markup (paragraphs separated by a blank line, **bold**, bare links) as the two versions of a mail:
 * plain text without the stars, and HTML where every character of the text is escaped first.
 */
export function formatBody(src: string): { text: string; html: string } {
  const body = src.replace(/\r\n/g, '\n');
  const text = body.replace(BOLD, '$1');
  const inline = (p: string) =>
    escHtml(p)
      .replace(BOLD, '<strong>$1</strong>')
      .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) => `<a href="${u}">${u}</a>`)
      .replace(/\n/g, '<br>');
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1b1b1f">${paras.map((p) => `<p>${inline(p)}</p>`).join('')}</div>`;
  return { text, html };
}

export function buildMime(o: OutgoingMail): string {
  const boundary = 'calme-' + randomBytes(12).toString('hex');
  const alt = 'calme-alt-' + randomBytes(12).toString('hex');
  const { text, html } = formatBody(o.body);
  const headers = [
    `From: ${safe(o.from)}`,
    `To: ${safe(o.to)}`,
    ...(o.cc?.trim() ? [`Cc: ${safe(o.cc)}`] : []),
    `Subject: ${encodeWord(safe(o.subject))}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${safe(o.inReplyTo)}`] : []),
    ...(o.references ? [`References: ${safe(o.references)}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const lines = [
    ...headers,
    '',
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text).toString('base64')),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html).toString('base64')),
    `--${alt}--`,
  ];
  for (const a of o.attachments) {
    const name = encodeURIComponent(safe(a.filename));
    const ascii = a.filename.replace(/[^\x20-\x7e]|"/g, '_');
    lines.push(
      `--${boundary}`,
      `Content-Type: ${safe(a.mimeType || 'application/octet-stream')}; name="${ascii}"`,
      `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${name}`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(a.data.toString('base64')),
    );
  }
  lines.push(`--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}
