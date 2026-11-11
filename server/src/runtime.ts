import { join } from 'node:path';
import { createCalendarPort, formatAgenda, type CalendarPort } from './calendar.ts';
import { execFile } from 'node:child_process';
import { cliRunner, type ClaudeRunner } from './claude.ts';
import { autoUnsubscribe } from './newsletters.ts';
import { openArchive } from './archive.ts';
import { syncArchive } from './archiveSync.ts';
import { getSettings } from './settings.ts';
import { withLanguage } from './language.ts';
import { loadConfig } from './config.ts';
import { createGmailPort, createOAuth, GmailDisconnected, type GmailPort } from './gmail.ts';
import { createNotifier } from './notify.ts';
import { openStore } from './store.ts';
import { syncInbox } from './sync.ts';
import { runTriage } from './triage.ts';
import { CATEGORIES, CATEGORY_LABELS } from './types.ts';

/** Wires config, storage, Gmail and Claude together; shared by the server and the CLI. */
export function createRuntime() {
  const cfg = loadConfig();
  const store = openStore(join(cfg.home, 'calme.db'));
  const baseOAuth = createOAuth(cfg.home);
  const settings = () => getSettings(store, { model: cfg.model, intervalMin: cfg.intervalMin });
  // Model read at call time so a change in the admin page applies without restart.
  const runner: ClaudeRunner = withLanguage((i) => cliRunner(settings().model)(i), () => settings().language);
  const notifier = createNotifier(store, cfg.vapid);
  const archive = openArchive(store.db);

  let port: GmailPort | null = null;
  let bgPort: GmailPort | null = null;
  let cal: CalendarPort | null = null;
  let revoked = false;
  let running = false;
  let error: string | null = null;

  const oauth = {
    ...baseOAuth,
    async exchange(code: string, redirect: string) {
      await baseOAuth.exchange(code, redirect);
      port = null;
      bgPort = null;
      cal = null;
      revoked = false;
    },
  };

  function gmail(): GmailPort | null {
    if (revoked || !oauth.hasCredentials() || !oauth.isConnected()) return null;
    return (port ??= createGmailPort(oauth.client()));
  }

  /** Same mailbox, lower priority: used by the scheduled cycle so it never slows the UI down. */
  function gmailBackground(): GmailPort | null {
    if (revoked || !oauth.hasCredentials() || !oauth.isConnected()) return null;
    return (bgPort ??= createGmailPort(oauth.client(), true));
  }

  function calendar(): CalendarPort | null {
    if (revoked || !oauth.hasCredentials() || !oauth.isConnected()) return null;
    return (cal ??= createCalendarPort(oauth.client()));
  }

  async function agenda(log: (m: string) => void): Promise<string | undefined> {
    try {
      const c = calendar();
      return c ? formatAgenda(await c.upcoming(14)) : undefined;
    } catch (e) {
      log(`[agenda] indisponible : ${(e as Error).message}`);
      return undefined;
    }
  }

  async function runCycle(log: (m: string) => void = console.log): Promise<void> {
    if (running) return;
    const g = gmailBackground();
    if (!g) return;
    running = true;
    try {
      const { added } = await syncInbox(g, store);
      const analysed = store.countUnanalyzed() ? await runTriage(runner, store, log, await agenda(log)) : [];
      if (analysed.length) store.setMeta('lastTriage', String(Date.now()));
      await notifier.notifyReplies(analysed);
      const unsub = await autoUnsubscribe(g, store, analysed, await g.profileEmail());
      if (unsub.length) log(`[auto] désabonné de : ${unsub.join(', ')}`);
      // Local mail base: 60 full mails per cycle at most (3,600 quota units), so it never starves the rest.
      try {
        const arch = await syncArchive(g, store, archive, { months: settings().archiveMonths, batch: 60 });
        if (arch.added) log(`[base] +${arch.added} mails (${archive.count()} au total${arch.done ? '' : ', remplissage en cours'})`);
      } catch (e) {
        if (e instanceof GmailDisconnected) throw e;
        log(`[base] synchro interrompue : ${(e as Error).message}`);
      }
      error = null;
      if (added || analysed.length) log(`[cycle] ${added} nouveaux, ${analysed.length} triés`);
    } catch (e) {
      if (e instanceof GmailDisconnected) revoked = true;
      error = (e as Error).message;
      log(`[cycle] erreur : ${error}`);
    } finally {
      running = false;
    }
  }

  let versionCache: { at: number; v: { installed: boolean; version: string | null } } | null = null;
  function claudeInfo(): Promise<{ installed: boolean; version: string | null }> {
    if (versionCache && Date.now() - versionCache.at < 60_000) return Promise.resolve(versionCache.v);
    return new Promise((resolve) => {
      execFile(process.env.CALME_CLAUDE_BIN || 'claude', ['--version'], { timeout: 10_000 }, (err, stdout) => {
        const v = err ? { installed: false, version: null } : { installed: true, version: stdout.trim() };
        versionCache = { at: Date.now(), v };
        resolve(v);
      });
    });
  }

  async function claudeTest(): Promise<{ ok: boolean; ms: number; error?: string }> {
    const t0 = Date.now();
    try {
      const r = (await cliRunner('haiku', 60_000)({
        system: 'Réponds uniquement via le schéma.',
        prompt: 'Réponds ok.',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      })) as { ok?: boolean };
      return { ok: r?.ok === true, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 300) };
    }
  }

  const summary = () => {
    const c = store.counts();
    return CATEGORIES.map((k) => `${CATEGORY_LABELS[k]} ${c[k]}`).join(' · ');
  };

  return { cfg, store, archive, oauth, runner, notifier, gmail, calendar, agenda, settings, claudeInfo, claudeTest, runCycle, status: () => ({ running, error }), summary };
}
