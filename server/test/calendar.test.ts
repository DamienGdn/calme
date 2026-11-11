import { describe, expect, it } from 'vitest';
import { formatAgenda } from '../src/calendar.ts';
import { SCOPES } from '../src/gmail.ts';
import type { ClaudeRunner } from '../src/claude.ts';
import { triageBatch } from '../src/triage.ts';
import { mail } from './fixtures.ts';

describe('calendar', () => {
  it('requests calendar.events alongside gmail scopes', () => {
    expect(SCOPES).toContain('https://www.googleapis.com/auth/calendar.events');
  });

  it('formats upcoming events for the prompt', () => {
    const txt = formatAgenda([
      { title: 'Dentiste', start: '2026-11-14T10:00:00+01:00', end: '2026-11-14T11:00:00+01:00', allDay: false },
      { title: 'Week-end Corse', start: '2026-11-21', end: '2026-11-23', allDay: true },
    ]);
    expect(txt).toContain('Dentiste');
    expect(txt).toContain('Week-end Corse');
    expect(formatAgenda([])).toMatch(/aucun/i);
  });
});

describe('triage with agenda', () => {
  const capture = () => {
    const calls: { system: string; prompt: string }[] = [];
    const r: ClaudeRunner = async (i) => {
      calls.push(i);
      return {
        items: [
          {
            id: 'a', category: 'reply', summary: ['x'], action: 'répondre', replies: [], group: null,
            event: { title: 'Dîner chez Sophie', start: '2026-11-14T20:00:00+01:00', end: '2026-11-14T23:00:00+01:00', location: 'Chez Sophie' },
          },
        ],
      };
    };
    return { r, calls };
  };

  it('passes the agenda and today to Claude', async () => {
    const { r, calls } = capture();
    await triageBatch(r, [mail('a')], 'Samedi 14 : Dentiste 10h');
    expect(calls[0].prompt).toContain('Samedi 14 : Dentiste 10h');
    expect(calls[0].prompt).toMatch(/Aujourd’hui/);
  });

  it('keeps a valid proposed event', async () => {
    const { r } = capture();
    const [a] = await triageBatch(r, [mail('a')]);
    expect(a.event).toEqual({ title: 'Dîner chez Sophie', start: '2026-11-14T20:00:00+01:00', end: '2026-11-14T23:00:00+01:00', location: 'Chez Sophie' });
  });

  it('drops an event with invalid dates', async () => {
    const r: ClaudeRunner = async () => ({
      items: [{ id: 'a', category: 'read', summary: [], action: '', replies: [], group: null, event: { title: 'X', start: 'demain', end: 'plus tard', location: null } }],
    });
    const [a] = await triageBatch(r, [mail('a')]);
    expect(a.event).toBeNull();
  });
});
