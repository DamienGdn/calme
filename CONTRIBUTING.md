# Contributing to Calm

Thanks for helping! Calm is developed in this repository: improvements land here, through pull requests,
so that everyone gets them in the official releases.

## How to contribute

1. **Open an issue first** for anything bigger than a small fix, to agree on the approach.
2. Fork the repository, create a branch from `main`, make your change.
3. Run the checks:
   ```bash
   pnpm install
   pnpm test                  # server (Vitest) and web (node:test) tests
   pnpm -C server typecheck
   pnpm build                 # Vue UI (vue-tsc + vite)
   ```
4. Open a pull request against `main` describing the problem and the change.

## Ground rules

- **Safety first**: Calm never sends, deletes or unsubscribes without an explicit user action. Never weaken the
  guards around Claude (`claude -p` with no tools, JSON schemas, mail content treated as untrusted data).
- Every user-facing string goes through `web/src/i18n.ts`, in **English and French**.
- Server code is TypeScript run natively by Node 24: relative imports with the `.ts` extension, no enums or namespaces.
- New behaviour comes with tests (Vitest in `server/test`, `node:test` in `web/test`).
- No personal data, tokens or `credentials.json` in commits.

## Licensing of contributions

Calm is released under the [MIT License](LICENSE). By submitting a contribution, you agree that it is licensed under
the same terms.
