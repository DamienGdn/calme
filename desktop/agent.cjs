// Calm's background server on macOS: a LaunchAgent (per user, no admin rights) that runs the server bundled in the
// app with the app's own Node (ELECTRON_RUN_AS_NODE). It starts at login, restarts if it stops, and keeps running
// when the app is quit, so the iPhone keeps working. Turned on and off from Admin › Background server.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LABEL = 'app.calme.server';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const str = (s) => `<string>${xml(s)}</string>`;

/** The LaunchAgent's plist. `keepAwake` wraps the server in caffeinate -i, which keeps the Mac from idle sleep. */
function agentPlist({ execPath, entry, webDist, port, pathEnv, logFile, keepAwake, version, label = LABEL, home }) {
  const args = [...(keepAwake ? ['/usr/bin/caffeinate', '-i'] : []), execPath, entry];
  const env = {
    ELECTRON_RUN_AS_NODE: '1',
    NODE_NO_WARNINGS: '1',
    PATH: pathEnv,
    CALME_PORT: port,
    CALME_WEB_DIST: webDist,
    CALME_APP_VERSION: version,
    CALME_BACKGROUND: '1',
    ...(home ? { CALME_HOME: home } : {}),
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${str(label)}
  <key>ProgramArguments</key>
  <array>
    ${args.map(str).join('\n    ')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    ${Object.entries(env).map(([k, v]) => `<key>${xml(k)}</key>\n    ${str(v)}`).join('\n    ')}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Standard</string>
  <key>StandardOutPath</key>
  ${str(logFile)}
  <key>StandardErrorPath</key>
  ${str(logFile)}
</dict>
</plist>
`;
}

const plistPath = (label = LABEL) => path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const domain = () => `gui/${process.getuid()}`;

function launchctl(args) {
  return new Promise((resolve) => execFile('/bin/launchctl', args, { timeout: 15_000 }, (err, stdout) => resolve({ ok: !err, out: String(stdout) })));
}

/** Whether the agent is loaded, and the server's process id when it runs. */
async function agentStatus(label = LABEL) {
  const r = await launchctl(['print', `${domain()}/${label}`]);
  if (!r.ok) return { installed: fs.existsSync(plistPath(label)), loaded: false, pid: null };
  const pid = /\bpid = (\d+)/.exec(r.out);
  return { installed: true, loaded: true, pid: pid ? Number(pid[1]) : null };
}

/** Writes the plist and (re)loads the agent when it changed or is not loaded; true when it was (re)started. */
async function installAgent(opts) {
  const label = opts.label ?? LABEL;
  const file = plistPath(label);
  const content = agentPlist(opts);
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content;
  if (same && (await agentStatus(label)).loaded) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await launchctl(['bootout', `${domain()}/${label}`]);
  fs.writeFileSync(file, content, { mode: 0o644 });
  const r = await launchctl(['bootstrap', domain(), file]);
  if (!r.ok) throw new Error('launchctl bootstrap failed');
  return true;
}

async function uninstallAgent(label = LABEL) {
  await launchctl(['bootout', `${domain()}/${label}`]);
  fs.rmSync(plistPath(label), { force: true });
}

/** Restarts the server now (launchd starts it again at once). */
async function restartAgent(label = LABEL) {
  const r = await launchctl(['kickstart', '-k', `${domain()}/${label}`]);
  if (!r.ok) throw new Error('launchctl kickstart failed');
}

module.exports = { LABEL, agentPlist, agentStatus, installAgent, uninstallAgent, restartAgent, plistPath };
