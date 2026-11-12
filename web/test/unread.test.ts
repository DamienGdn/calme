import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUnread, withUnread } from '../src/unread.ts';

test('a mail is unread while it carries the UNREAD label', () => {
  assert.equal(isUnread({ labelIds: ['INBOX', 'UNREAD'] }), true);
  assert.equal(isUnread({ labelIds: ['INBOX'] }), false);
  assert.equal(isUnread({}), false);
});

test('marking adds or removes UNREAD once, keeping the other labels', () => {
  assert.deepEqual(withUnread(['INBOX'], true), ['INBOX', 'UNREAD']);
  assert.deepEqual(withUnread(['INBOX', 'UNREAD'], true), ['INBOX', 'UNREAD']);
  assert.deepEqual(withUnread(['UNREAD', 'INBOX'], false), ['INBOX']);
  assert.deepEqual(withUnread(undefined, true), ['UNREAD']);
});
