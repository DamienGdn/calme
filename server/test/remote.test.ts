import { describe, expect, it } from 'vitest';
import { consentLink } from '../src/remote.ts';

describe('consentLink', () => {
  it('finds the Tailscale page that enables Serve on the tailnet', () => {
    const out = '\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=npza2Bpa1421CNTRL\n\n';
    expect(consentLink(out)).toBe('https://login.tailscale.com/f/serve?node=npza2Bpa1421CNTRL');
  });

  it('also finds the HTTPS certificate consent page', () => {
    expect(consentLink('HTTPS is not enabled. Visit https://login.tailscale.com/f/https?node=abc to enable')).toBe(
      'https://login.tailscale.com/f/https?node=abc',
    );
  });

  it('ignores links to any other site', () => {
    expect(consentLink('To enable, visit: https://evil.example/f/serve?node=x')).toBeNull();
    expect(consentLink('visit https://login.tailscale.com.evil.example/f/serve')).toBeNull();
  });

  it('returns null when there is nothing to approve', () => {
    expect(consentLink('Available within your tailnet:\nhttps://mac.tail1.ts.net/\n|-- proxy http://127.0.0.1:4747')).toBeNull();
  });
});
