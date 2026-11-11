import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Finds the Tailscale CLI (macOS app bundle, or on PATH). */
function tailscaleBin(): string | null {
  const mac = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  if (existsSync(mac)) return mac;
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    const p = `${dir}/tailscale${process.platform === 'win32' ? '.exe' : ''}`;
    if (dir && existsSync(p)) return p;
  }
  return null;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(bin, args, { timeout: 15_000 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout))),
  );
}

/**
 * When Serve or HTTPS is not yet allowed on the tailnet, `tailscale serve` prints an approval link and waits.
 * Returns that link, only if it points to Tailscale's own console (the output is not trusted blindly).
 */
export function consentLink(output: string): string | null {
  for (const m of output.matchAll(/https:\/\/[^\s]+/g)) {
    try {
      const u = new URL(m[0]);
      if (u.protocol === 'https:' && u.hostname === 'login.tailscale.com') return u.href;
    } catch {
      /* not a URL */
    }
  }
  return null;
}

/** Runs `tailscale serve --bg`; stops early with the approval link if Tailscale is waiting for one. */
function serve(bin: string, port: number): Promise<{ consentUrl: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['serve', '--bg', String(port)]);
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(out.trim() || 'tailscale serve timed out'));
    }, 15_000);
    const done = (r: { consentUrl: string | null } | Error) => {
      clearTimeout(timer);
      if (r instanceof Error) reject(r);
      else resolve(r);
    };
    const onData = (d: Buffer) => {
      out += d.toString();
      const link = consentLink(out);
      if (link) {
        child.kill();
        done({ consentUrl: link });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', done);
    child.on('close', (code) => {
      if (consentLink(out)) return;
      done(code === 0 ? { consentUrl: null } : new Error(out.trim() || `tailscale serve exited with ${code}`));
    });
  });
}

/** Exposes Calm to the user's own devices with `tailscale serve` (HTTPS, tailnet only). */
export function createRemote(port: number) {
  async function hostUrl(bin: string): Promise<string | null> {
    const st = JSON.parse(await run(bin, ['status', '--json']));
    const dns = String(st?.Self?.DNSName ?? '').replace(/\.$/, '');
    return dns ? `https://${dns}` : null;
  }
  return {
    async status() {
      const bin = tailscaleBin();
      if (!bin) return { installed: false, serving: false, url: null };
      try {
        const serve = await run(bin, ['serve', 'status']);
        return { installed: true, serving: serve.includes(`:${port}`), url: await hostUrl(bin) };
      } catch {
        return { installed: true, serving: false, url: null };
      }
    },
    async enable() {
      const bin = tailscaleBin();
      if (!bin) throw new Error('Tailscale is not installed');
      const { consentUrl } = await serve(bin, port);
      return { url: await hostUrl(bin), consentUrl };
    },
  };
}
