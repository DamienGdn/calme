import { describe, expect, it } from 'vitest';
import { orgDomain } from '../src/logos.ts';

describe('orgDomain', () => {
  it('keeps the organisation, drops the mail subdomains', () => {
    expect(orgDomain('e.linkedin.com')).toBe('linkedin.com');
    expect(orgDomain('Info.Ameli.FR')).toBe('ameli.fr');
    expect(orgDomain('mail.bbc.co.uk')).toBe('bbc.co.uk');
    expect(orgDomain('notif.impots.gouv.fr')).toBe('impots.gouv.fr');
  });
  it('has none for personal providers, addresses and local names', () => {
    for (const d of ['gmail.com', 'orange.fr', 'free.fr', '10.0.0.1', 'localhost', 'nas.local', 'bad_domain.com', '']) expect(orgDomain(d)).toBeNull();
  });
});
