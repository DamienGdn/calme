// Calm desktop: runs the Calm server in the background (inside the app), shows a menu bar icon
// with the number of mails awaiting a reply, and notifies every new mail.
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, powerSaveBlocker, shell } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agent = require('./agent.cjs');

// The app was called "Calme" before: its settings (pairing, notifications) stay in that folder.
app.setPath('userData', path.join(app.getPath('appData'), 'Calme'));

const POLL_MS = 30_000;
const CALME_HOME = process.env.CALME_HOME || path.join(os.homedir(), '.calme');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

/** Opens a link outside the app; Apple Plans links go straight to the Plans app on a Mac. */
function openOutside(url) {
  const plans = 'https://maps.apple.com/';
  if (process.platform === 'darwin' && url.startsWith(plans)) shell.openExternal(`maps://${url.slice(plans.length)}`);
  else shell.openExternal(url);
}

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    /* first run */
  }
  return {
    serverUrl: process.env.CALME_SERVER_URL || s.serverUrl || 'http://127.0.0.1:4747',
    token: s.token || null,
    loginItemConfigured: Boolean(s.loginItemConfigured),
    notify: s.notify || 'all', // 'all' | 'reply' | 'off'
    keepAwake: s.keepAwake !== false, // the computer must stay awake to fetch mail and serve the iPhone
    background: s.background === true, // macOS: the server runs as a LaunchAgent, even with the app quit (agent.cjs)
  };
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), { mode: 0o600 });
}

let settings;
let win = null;
let tray = null;
let quitting = false;
let seen = null; // ids already notified; null until the first successful poll
let counts = { reply: 0, total: 0 };
let server = null;
let serverRestarts = 0;
/** True while the app's own server is stopped on purpose (handed to the background service, or restarted). */
let handingOver = false;
let awakeId = null;

/** Keeps the computer from sleeping while Calm runs (the display may still turn off). */
function applyKeepAwake() {
  if (settings.keepAwake && awakeId === null) awakeId = powerSaveBlocker.start('prevent-app-suspension');
  if (!settings.keepAwake && awakeId !== null) {
    powerSaveBlocker.stop(awakeId);
    awakeId = null;
  }
}
let lastError = null;

const isLocal = () => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(new URL(settings.serverUrl).origin);
const origin = () => new URL(settings.serverUrl).origin;

/** Apps started from the Dock get a minimal PATH; borrow the login shell's so `claude` is found. */
function loginShellPath() {
  if (process.platform === 'win32') return process.env.PATH;
  try {
    const shellBin = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(shellBin, ['-ilc', 'printf "__PATH__%s" "$PATH"'], { timeout: 8000, encoding: 'utf8' });
    const p = out.split('__PATH__').pop().trim();
    if (p) return p;
  } catch {
    /* fall back below */
  }
  const h = os.homedir();
  return [`${h}/.local/bin`, `${h}/.claude/local`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH].filter(Boolean).join(path.delimiter);
}

/** The pairing token lives in ~/.calme/config.json on this Mac: no need to pair the local app. */
function localToken() {
  try {
    return JSON.parse(fs.readFileSync(path.join(CALME_HOME, 'config.json'), 'utf8')).pairingToken || null;
  } catch {
    return null;
  }
}

async function serverUp() {
  try {
    await fetch(new URL('/api/quota', settings.serverUrl), { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

const resourcesDir = () => (app.isPackaged ? process.resourcesPath : path.join(__dirname));
const canBackground = () => process.platform === 'darwin' && isLocal();
let pathEnv = null;
const shellPath = () => (pathEnv ??= loginShellPath());

/** The background service's settings: this app's binary and bundled server, so an update reloads it. */
const agentOptions = () => ({
  execPath: process.execPath,
  entry: path.join(resourcesDir(), 'app', 'server.cjs'),
  webDist: path.join(resourcesDir(), 'app', 'web'),
  port: new URL(settings.serverUrl).port || '4747',
  pathEnv: shellPath(),
  logFile: path.join(CALME_HOME, 'server.log'),
  keepAwake: settings.keepAwake,
  version: app.getVersion(),
  ...(process.env.CALME_HOME ? { home: CALME_HOME } : {}),
});

const waitFor = async (want) => {
  for (let i = 0; i < 60; i++) {
    if ((await serverUp()) === want) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

/** Stops the server this app started itself (not the background one), without restarting it. */
async function stopOwnServer() {
  if (!server) return;
  const child = server;
  handingOver = true;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 5000);
  });
  handingOver = false;
}

/** Where the server runs and whether it answers: for Admin › Background server and the menu. */
async function serverStatus() {
  const a = canBackground() ? await agent.agentStatus() : { installed: false, loaded: false, pid: null };
  return {
    available: canBackground(),
    background: settings.background,
    up: await serverUp(),
    mode: a.loaded ? 'background' : server ? 'app' : 'other',
    pid: a.loaded ? a.pid : (server?.pid ?? null),
    log: path.join(CALME_HOME, 'server.log'),
  };
}

/** Turns the background server on or off; the server moves between the app and launchd without changing port. */
async function setBackground(on) {
  if (!canBackground()) throw new Error('Only on a Mac with a local server');
  settings.background = Boolean(on);
  saveSettings();
  if (on) {
    await stopOwnServer();
    await waitFor(false);
    await agent.installAgent(agentOptions());
    await waitFor(true);
  } else {
    await agent.uninstallAgent();
    await waitFor(false);
    await ensureServer();
  }
  lastError = (await serverUp()) ? null : lastError;
  refreshTray();
  return serverStatus();
}

/** Restarts the server wherever it runs (launchd, or the app's own child). */
async function restartServer() {
  if (settings.background && canBackground()) {
    await agent.restartAgent();
    await waitFor(true);
  } else {
    await stopOwnServer();
    await waitFor(false);
    await ensureServer();
  }
  refreshTray();
  return serverStatus();
}

/** Starts the bundled server with Electron's own Node, restarting it if it stops (or the background service). */
async function ensureServer() {
  if (!isLocal()) return;
  if (canBackground()) {
    if (settings.background) {
      // Written again at each start: an updated app reloads the service with its new server.
      try {
        await agent.installAgent(agentOptions());
      } catch (e) {
        lastError = `Serveur de fond : ${e.message}`;
      }
      if (!(await waitFor(true))) lastError = 'Le serveur de fond ne répond pas (voir le journal du serveur).';
      return;
    }
    if (fs.existsSync(agent.plistPath())) {
      await agent.uninstallAgent();
      await waitFor(false);
    }
  }
  if (await serverUp()) return;
  const resources = resourcesDir();
  const entry = path.join(resources, 'app', 'server.cjs');
  if (!fs.existsSync(entry)) {
    lastError = 'Serveur introuvable dans l’app (lance « pnpm -C desktop bundle »).';
    return;
  }
  fs.mkdirSync(CALME_HOME, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(CALME_HOME, 'server.log'), 'a');
  server = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_NO_WARNINGS: '1',
      PATH: shellPath(),
      CALME_PORT: new URL(settings.serverUrl).port || '4747',
      CALME_WEB_DIST: path.join(resources, 'app', 'web'),
    },
    stdio: ['ignore', log, log],
  });
  server.on('exit', (code) => {
    server = null;
    if (quitting || handingOver) return;
    lastError = `Le serveur s’est arrêté (code ${code}). Redémarrage…`;
    refreshTray();
    const delay = Math.min(60_000, 2000 * 2 ** serverRestarts++);
    setTimeout(() => void ensureServer(), delay);
  });
  for (let i = 0; i < 40 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 250));
  if (await serverUp()) {
    serverRestarts = 0;
    lastError = null;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    title: 'Calm',
    show: false,
    backgroundColor: '#0D0E11',
    icon: path.join(__dirname, 'build/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadURL(settings.serverUrl);
  win.once('ready-to-show', () => {
    if (!app.getLoginItemSettings().wasOpenedAsHidden) win.show();
  });
  // Sign the local app in automatically with the token from ~/.calme.
  win.webContents.on('did-finish-load', () => {
    const token = isLocal() ? localToken() : settings.token;
    if (!token || win.webContents.getURL().startsWith('data:')) return;
    win.webContents.executeJavaScript(
      `try { if (!localStorage.getItem('calme.token')) { localStorage.setItem('calme.token', ${JSON.stringify(token)}); location.reload(); } } catch (e) {}`,
    );
  });
  win.webContents.on('did-fail-load', (_e, _code, desc, url) => {
    if (url.startsWith('data:')) return;
    win.loadURL(errorPage(`Le serveur ne répond pas (${desc}).`));
    setTimeout(() => ensureServer().then(() => win && win.loadURL(settings.serverUrl)), 3000);
  });
  // Google refuses sign-in inside embedded windows: the Gmail authorisation always opens in the default browser.
  const isGoogleAuth = (url) => /^https?:/i.test(url) && new URL(url).pathname.startsWith('/auth/google');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isGoogleAuth(url)) {
      e.preventDefault();
      shell.openExternal(url);
      return;
    }
    if (url.startsWith('data:') || new URL(url).origin === origin()) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) openOutside(url);
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function errorPage(message) {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0D0E11;color:#EDEBE5;font:15px system-ui">
  <div style="max-width:440px;padding:24px"><h1 style="font:italic 400 44px Georgia,serif;margin:0 0 16px">Calm démarre…</h1>
  <p style="color:#9C9BA3;line-height:1.6">${message} Nouvelle tentative dans quelques secondes. Journal : ~/.calme/server.log</p></div></body>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function show(hash) {
  if (!win) createWindow();
  if (hash) win.loadURL(`${settings.serverUrl}/${hash}`);
  win.show();
  win.focus();
}

async function apiFetch(p, init = {}) {
  const token = isLocal() ? localToken() : settings.token;
  if (!token) return null;
  const res = await fetch(new URL(p, settings.serverUrl), { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  return res.ok ? res.json() : null;
}

// Menu bar and notification texts follow the language chosen in the app (sent by the server in /api/state).
let lang = 'fr';
const TEXT = {
  fr: {
    cat: { reply: 'À répondre', read: 'À lire', news: 'Newsletter', trash: 'À supprimer' },
    toAnswer: (n) => `${n} à répondre`, none: 'Rien à répondre', many: (n) => `${n} nouveaux mails`,
    open: 'Ouvrir Calm', compose: 'Nouveau message', sync: 'Relever maintenant', notifications: 'Notifications',
    notifyAll: 'Chaque nouveau mail', notifyReply: 'Seulement « À répondre »', notifyOff: 'Désactivées',
    pairAsk: (n) => `${n} demande l’accès à Calm`, pairBody: 'Ouvre Calm pour autoriser ou refuser.', login: 'Lancer au démarrage du Mac', awake: 'Garder l’ordinateur éveillé', background: 'Serveur en arrière-plan (même app quittée)', log: 'Journal du serveur', quit: 'Quitter Calm',
  },
  en: {
    cat: { reply: 'To answer', read: 'To read', news: 'Newsletter', trash: 'To delete' },
    toAnswer: (n) => `${n} to answer`, none: 'Nothing to answer', many: (n) => `${n} new mails`,
    open: 'Open Calm', compose: 'New message', sync: 'Fetch mail now', notifications: 'Notifications',
    notifyAll: 'Every new mail', notifyReply: 'Only “To answer”', notifyOff: 'Off',
    pairAsk: (n) => `${n} is asking for access to Calm`, pairBody: 'Open Calm to allow or refuse.', login: 'Open at login', awake: 'Keep the computer awake', background: 'Background server (even with the app quit)', log: 'Server log', quit: 'Quit Calm',
  },
};
const tx = () => TEXT[lang] ?? TEXT.en;

/** Notifies each new mail (skipping those Calm files under "À supprimer"); more than 3 at once are grouped. */
/** Reminder alerts older than this were shown already (or before the app started, a few minutes of margin). */
let lastAlertAt = Date.now() - 10 * 60_000;
async function poll() {
  try {
    const state = await apiFetch('/api/state');
    if (!state) return;
    if (state.language && TEXT[state.language]) lang = state.language;
    const emails = state.emails || [];
    counts = { reply: state.counts?.reply ?? 0, total: emails.length };
    // Mails to answer on the Dock icon (macOS), like the badge on the iPhone home screen.
    try {
      app.setBadgeCount(counts.reply);
    } catch {
      /* no badge on this system */
    }
    // Wait for Calm's triage so the notification can say what the mail is about.
    const ready = emails.filter((m) => m.analysis);
    if (seen && Notification.isSupported() && settings.notify !== 'off') {
      const fresh = ready.filter((m) => !seen.has(m.id) && m.analysis.category !== 'trash' && (settings.notify === 'all' || m.analysis.category === 'reply'));
      const items =
        fresh.length > 3
          ? [{ title: tx().many(fresh.length), body: fresh.map((m) => m.fromName).slice(0, 4).join(', '), id: null }]
          : fresh.map((m) => ({ title: `${m.fromName} · ${tx().cat[m.analysis.category]}`, body: m.analysis.summary?.[0] || m.subject, id: m.id }));
      for (const it of items) {
        const n = new Notification({ title: it.title, body: it.body, silent: false });
        n.on('click', () => show(it.id ? `?mail=${encodeURIComponent(it.id)}#/tri` : '#/tri'));
        n.show();
      }
    }
    // Reminders that fell due (or warn ahead): one native notification each, opening the reminders.
    if (Notification.isSupported()) {
      for (const al of state.alerts || []) {
        if (al.at <= lastAlertAt) continue;
        const n = new Notification({ title: al.title, body: al.body, silent: false });
        n.on('click', () => show('#/rappels'));
        n.show();
      }
      lastAlertAt = Math.max(lastAlertAt, ...(state.alerts || []).map((al) => al.at));
    }
    seen = new Set([...(seen ?? []), ...ready.map((m) => m.id)]);
    lastError = null;
  } catch (e) {
    if (isLocal()) void ensureServer();
  }
  refreshTray();
}

/** A screen (e.g. the iPhone home-screen app) asks for access: tell the user, who approves in the window. */
let pairSeen = new Set();
async function pollPairs() {
  if (!isLocal() || !Notification.isSupported()) return;
  try {
    const pending = (await apiFetch('/api/pair/requests')) || [];
    for (const r of pending) {
      if (pairSeen.has(r.id)) continue;
      const n = new Notification({ title: tx().pairAsk(r.name), body: tx().pairBody, silent: false });
      n.on('click', () => show());
      n.show();
    }
    pairSeen = new Set(pending.map((r) => r.id));
  } catch {
    /* server restarting */
  }
}

function refreshTray() {
  if (!tray) return;
  const label = counts.reply ? tx().toAnswer(counts.reply) : tx().none;
  tray.setToolTip(`Calm · ${label}`);
  if (process.platform === 'darwin') tray.setTitle(counts.reply ? ` ${counts.reply}` : '');
  app.setBadgeCount?.(counts.reply);
  const login = app.getLoginItemSettings().openAtLogin;
  const setNotify = (v) => () => {
    settings.notify = v;
    saveSettings();
    refreshTray();
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      ...(lastError ? [{ label: lastError, enabled: false }] : []),
      { type: 'separator' },
      { label: tx().open, click: () => show() },
      { label: tx().compose, click: () => show('#/ecrire') },
      { label: tx().sync, click: () => apiFetch('/api/sync', { method: 'POST' }).then(() => setTimeout(poll, 8000)) },
      { type: 'separator' },
      {
        label: tx().notifications,
        submenu: [
          { label: tx().notifyAll, type: 'radio', checked: settings.notify === 'all', click: setNotify('all') },
          { label: tx().notifyReply, type: 'radio', checked: settings.notify === 'reply', click: setNotify('reply') },
          { label: tx().notifyOff, type: 'radio', checked: settings.notify === 'off', click: setNotify('off') },
        ],
      },
      { label: tx().login, type: 'checkbox', checked: login, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, openAsHidden: true }) },
      {
        label: tx().awake,
        type: 'checkbox',
        checked: settings.keepAwake,
        click: (i) => {
          settings.keepAwake = i.checked;
          saveSettings();
          applyKeepAwake();
          if (settings.background && canBackground()) void agent.installAgent(agentOptions()).catch(() => {});
        },
      },
      ...(canBackground()
        ? [{ label: tx().background, type: 'checkbox', checked: settings.background, click: (i) => void setBackground(i.checked).then(() => win?.reload()).catch(() => refreshTray()) }]
        : []),
      { label: tx().log, click: () => shell.openPath(path.join(CALME_HOME, 'server.log')) },
      { type: 'separator' },
      { label: tx().quit, click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => show());
  app.whenReady().then(async () => {
    app.setName('Calm');
    app.setAppUserModelId('app.calme.desktop');
    settings = loadSettings();
    // Runs permanently: start with the Mac (hidden, in the menu bar). Done once per app name (the app was "Calme"
    // before, a different bundle for macOS); the menu checkbox can undo it.
    if (settings.loginItemConfigured !== 'Calm' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
      settings.loginItemConfigured = 'Calm';
      saveSettings();
    }
    const icon = nativeImage.createFromPath(path.join(__dirname, 'build', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.on('click', () => tray.popUpContextMenu());
    const fromApp = (e) => new URL(e.senderFrame.url).origin === origin();
    ipcMain.handle('calme:server:status', (e) => (fromApp(e) ? serverStatus() : null));
    ipcMain.handle('calme:server:background', (e, on) => (fromApp(e) && typeof on === 'boolean' ? setBackground(on) : null));
    ipcMain.handle('calme:server:restart', (e) => (fromApp(e) ? restartServer() : null));
    ipcMain.on('calme:set-token', (e, token) => {
      if (new URL(e.senderFrame.url).origin !== origin()) return;
      settings.token = token;
      saveSettings();
      void poll();
    });
    applyKeepAwake();
    refreshTray();
    await ensureServer();
    createWindow();
    void poll();
    setInterval(poll, POLL_MS);
    setInterval(pollPairs, 3000);
    app.on('activate', () => show());
  });
  app.on('before-quit', () => {
    quitting = true;
    if (server) server.kill('SIGTERM');
  });
  app.on('window-all-closed', () => {
    /* stays alive in the menu bar */
  });
}
