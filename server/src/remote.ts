import { execFile } from 'node:child_process';
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

/** Exposes Calme to the user's own devices with `tailscale serve` (HTTPS, tailnet only). */
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
      await run(bin, ['serve', '--bg', String(port)]);
      return { url: await hostUrl(bin) };
    },
  };
}
