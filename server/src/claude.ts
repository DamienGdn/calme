import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { usageFrom, type Usage } from './usage.ts';

export type ClaudeRunner = (i: { system: string; prompt: string; schema: object }) => Promise<unknown>;

/**
 * Runs Claude Code headless on the user's own subscription.
 * No tools, no MCP servers, no user settings or hooks: the model can only answer with schema-validated JSON,
 * so a malicious email cannot make it act on the machine.
 */
export function cliRunner(model: string, timeoutMs = 180_000, onUsage?: (u: Usage, schema: object) => void): ClaudeRunner {
  return ({ system, prompt, schema }) =>
    new Promise((resolve, reject) => {
      const args = [
        '-p',
        '--tools', '',
        '--strict-mcp-config',
        '--setting-sources', '',
        '--no-session-persistence',
        '--output-format', 'json',
        '--model', model,
        '--json-schema', JSON.stringify(schema),
        '--system-prompt', system,
      ];
      const child = spawn(process.env.CALME_CLAUDE_BIN || 'claude', args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`claude: délai dépassé (${timeoutMs} ms)`));
      }, timeoutMs);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`claude introuvable : ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const res = JSON.parse(out);
          onUsage?.(usageFrom(res), schema);
          if (res.is_error || res.structured_output == null) throw new Error(String(res.result ?? 'réponse vide'));
          resolve(res.structured_output);
        } catch (e) {
          reject(new Error(`claude a échoué (code ${code}) : ${(e as Error).message} ${err.slice(0, 300)}`));
        }
      });
      child.stdin.end(prompt);
    });
}
