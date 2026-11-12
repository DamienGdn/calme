/** Read state, as Gmail keeps it: a mail is unread while it carries the UNREAD label. */

export const isUnread = (m: { labelIds?: string[] }) => Boolean(m.labelIds?.includes('UNREAD'));

export function withUnread(labels: string[] | undefined, unread: boolean): string[] {
  const rest = (labels ?? []).filter((l) => l !== 'UNREAD');
  return unread ? [...rest, 'UNREAD'] : rest;
}
