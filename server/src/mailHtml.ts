/**
 * Cleans a mail's HTML before Calm shows it. Mail is untrusted: this is the first guard; the second is the client,
 * which renders it in a sandboxed frame with no scripts and a strict Content-Security-Policy.
 */

/** Elements dropped together with their content. */
const DROP_WITH_CONTENT = /<(script|iframe|frame|frameset|object|applet|svg|math|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;
/** Tags dropped, their text kept (a form's labels and button text stay readable). */
const DROP_TAG = /<\/?(?:script|iframe|frame|frameset|object|applet|embed|svg|math|meta|base|link|form|input|button|select|option|textarea|noscript|template)\b[^>]*>/gi;
const EVENT_HANDLER = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR = /(\s(?:href|src|action|formaction|background|xlink:href)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi;
const BAD_URL = /^\s*(?:javascript|vbscript|data:text\/html)/i;

export function safeMailHtml(html: string): string {
  return html
    .replace(DROP_WITH_CONTENT, '')
    .replace(DROP_TAG, '')
    .replace(EVENT_HANDLER, '')
    .replace(URL_ATTR, (all, attr: string, value: string) => (BAD_URL.test(value.replace(/^["']/, '')) ? `${attr}"#"` : all));
}
