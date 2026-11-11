import type { MailMessage } from '../src/types.ts';

export function mail(id: string, over: Partial<MailMessage> = {}): MailMessage {
  return {
    id,
    threadId: 't-' + id,
    fromName: 'Sophie Martin',
    fromEmail: 'sophie@exemple.fr',
    to: 'moi@exemple.fr',
    subject: 'Sujet ' + id,
    date: Date.parse('2026-11-11T09:00:00Z'),
    snippet: 'extrait',
    text: 'corps du mail ' + id,
    messageIdHeader: '<' + id + '@exemple.fr>',
    references: '',
    unsub: null,
    labelIds: ['INBOX'],
    attachmentNames: [],
    ...over,
  };
}
