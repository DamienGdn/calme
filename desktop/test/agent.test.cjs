const assert = require('node:assert/strict');
const { test } = require('node:test');
const { agentPlist, LABEL } = require('../agent.cjs');

const base = {
  execPath: '/Applications/Calm.app/Contents/MacOS/Calm',
  entry: '/Applications/Calm.app/Contents/Resources/app/server.cjs',
  webDist: '/Applications/Calm.app/Contents/Resources/app/web',
  port: '4747',
  pathEnv: '/opt/homebrew/bin:/usr/bin:/bin',
  logFile: '/Users/me/.calme/server.log',
  version: '1.1.7',
};

test('the background service runs the bundled server with the app’s own Node, at login, restarted if it stops', () => {
  const xml = agentPlist({ ...base, keepAwake: false });
  assert.match(xml, new RegExp(`<key>Label</key>\\s*<string>${LABEL.replace(/\./g, '\\.')}</string>`));
  assert.match(xml, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/Applications\/Calm\.app\/Contents\/MacOS\/Calm<\/string>\s*<string>\/Applications\/Calm\.app\/Contents\/Resources\/app\/server\.cjs<\/string>\s*<\/array>/);
  assert.match(xml, /<key>ELECTRON_RUN_AS_NODE<\/key>\s*<string>1<\/string>/);
  assert.match(xml, /<key>CALME_APP_VERSION<\/key>\s*<string>1\.1\.7<\/string>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/me\/\.calme\/server\.log<\/string>/);
  assert.doesNotMatch(xml, /caffeinate/);
});

test('keeping the computer awake wraps the server in caffeinate', () => {
  const xml = agentPlist({ ...base, keepAwake: true });
  assert.match(xml, /<array>\s*<string>\/usr\/bin\/caffeinate<\/string>\s*<string>-i<\/string>\s*<string>\/Applications\/Calm\.app\/Contents\/MacOS\/Calm<\/string>/);
});

test('paths are escaped for XML', () => {
  assert.match(agentPlist({ ...base, keepAwake: false, logFile: '/Users/a&b/<x>.log' }), /\/Users\/a&amp;b\/&lt;x&gt;\.log/);
});
