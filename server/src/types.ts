export const CATEGORIES = ['reply', 'read', 'news', 'trash'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  reply: 'À répondre',
  read: 'À lire',
  news: 'Newsletters',
  trash: 'À supprimer',
};

export interface Unsub {
  oneClickUrl?: string;
  httpUrl?: string;
  mailto?: string;
}

export interface MailMessage {
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  to: string;
  cc?: string;
  subject: string;
  date: number;
  snippet: string;
  text: string;
  /** The mail's own HTML (not cleaned: see mailHtml.ts), when it has one. */
  html?: string;
  messageIdHeader: string;
  references: string;
  unsub: Unsub | null;
  labelIds: string[];
  attachmentNames: string[];
}

export interface Reply {
  label: string;
  text: string;
}

export interface ProposedEvent {
  title: string;
  start: string;
  end: string;
  location: string | null;
}

export interface Analysis {
  id: string;
  category: Category;
  summary: string[];
  action: string;
  replies: Reply[];
  group: string | null;
  event?: ProposedEvent | null;
}

export type MailView = MailMessage & { analysis: Analysis | null };

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  name?: string;
  addedAt?: number;
}
