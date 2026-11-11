import { describe, expect, it } from 'vitest';
import { validateCredentials } from '../src/gmail.ts';

describe('validateCredentials', () => {
  it('accepts a Google desktop (installed) or web OAuth client', () => {
    expect(validateCredentials({ installed: { client_id: 'a.apps.googleusercontent.com', client_secret: 's' } })).toBe(true);
    expect(validateCredentials({ web: { client_id: 'a.apps.googleusercontent.com', client_secret: 's' } })).toBe(true);
  });
  it('rejects anything else', () => {
    expect(validateCredentials({ installed: { client_id: 'a' } })).toBe(false);
    expect(validateCredentials({ type: 'service_account', private_key: 'x' })).toBe(false);
    expect(validateCredentials('nope')).toBe(false);
  });
});
