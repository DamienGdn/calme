<p align="center">
  <img src="docs/assets/banner.png" alt="Calm — your Gmail, sorted by AI. Powered by Claude." width="100%" />
</p>

<p align="center">
  <a href="https://claude.com/product/claude-code"><img alt="Powered by Claude" src="https://img.shields.io/badge/powered%20by-Claude-C8F03C?style=flat-square&labelColor=0D0E11" /></a>
  <img alt="macOS · Windows · Linux · iPhone" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux%20%C2%B7%20iPhone-0D0E11?style=flat-square" />
  <img alt="Vue 3 + TypeScript" src="https://img.shields.io/badge/Vue%203-TypeScript-0D0E11?style=flat-square" />
  <img alt="English · Français" src="https://img.shields.io/badge/English%20%C2%B7%20Fran%C3%A7ais-0D0E11?style=flat-square" />
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0D0E11?style=flat-square" /></a>
</p>

# Calm

**Calm sorts your Gmail with Claude so you can stop living in your inbox.** It fetches your mail, sorts every message
(*to answer*, *to read*, *newsletters*, *to delete*), summarises it, drafts replies, spots appointments, suggests what
to delete and which newsletters to drop. You decide; Calm does it. **Nothing is sent, deleted or unsubscribed
without your click.**

It runs on your own computer and uses **your Claude Code subscription** (`claude -p`) — no API key, no cloud of ours.

![Calm](docs/assets/screenshot.jpg)

## Features

- **Smart triage** — every mail sorted into 4 categories with a short summary and a suggested action.
- **Ready replies** — up to 3 drafts per mail in the right tone; rewrite with one sentence ("shorter", "more formal").
- **Write with Calm** — describe what you want to say, Calm writes the mail; To/Cc autocomplete from your contacts.
- **Calendar** — appointments found in mail, clash detection, one-click "add to calendar", free-slot suggestions, list/week/month views.
- **Clean-up** — promotions, notifications and stale mail grouped for one-click trashing (Gmail trash, recoverable 30 days).
- **Newsletter advisor** — Calm reads your reading habits and tells you which newsletters to unsubscribe from; optional automatic mode.
- **AI search** — ask a question in plain language; Calm searches a local full-text copy of your mail and Gmail, then answers.
- **Local mail base** — your received and sent mail mirrored on your computer (SQLite FTS5), synced at every fetch.
- **Everywhere** — desktop app for macOS, Windows and Linux (menu bar icon, notifications, starts at login) and an
  iPhone home-screen app with push notifications.
- **English and French** — switch in *Admin*; Calm's own texts (summaries, replies, notifications) follow.
- **Gmail quota-aware** — a live gauge and a throttle that keeps you under Google's per-minute limit.

## How it works

```
 iPhone (PWA) ──┐                         ┌── Gmail API / Google Calendar API
 Desktop app ───┼── Calm server ─────────┤
 Browser ───────┘   127.0.0.1:4747        └── claude -p  (your Claude Code subscription,
                    SQLite in ~/.calme                    no tools, JSON-schema answers)
```

- **Server** (`server/`) — Node 24 + TypeScript, Hono, `node:sqlite` (with FTS5), Gmail & Calendar APIs, Web Push.
- **UI** (`web/`) — Vue 3 + TypeScript + vue-i18n, built with Vite; also a PWA.
- **Desktop** (`desktop/`) — Electron; embeds the server and runs it permanently.

## Install

### 1. Requirements

- [Claude Code](https://claude.com/product/claude-code) installed and signed in (`claude` works in a terminal).
  On Windows, use the native installer (`claude.exe`).
- For development: Node.js 24+ and pnpm.

### 2. Desktop app (recommended)

Download the installer for your system from the [latest release](../../releases/latest):
`.dmg` (macOS — `arm64` for Apple silicon, the other one for Intel), `.exe` (Windows) or `.AppImage` (Linux).

The installers are **not code-signed** (signing costs a yearly fee that this side project does not pay), so macOS and
Windows warn you the first time. This is expected; you only do it once.

**macOS** (Sequoia 15 and later)
1. Open the `.dmg` and drag **Calm** onto **Applications**.
2. Open Calm from Applications. macOS says it *could not verify* Calm: click **Done** (not *Move to Bin*).
3. Open **System Settings › Privacy & Security**, scroll to *Security*: next to *“Calm” was blocked…*, click
   **Open Anyway**, confirm with your password or Touch ID, then **Open**.
4. From now on Calm opens normally.

On macOS 14 or earlier, right-click Calm in Applications › **Open** › **Open** is enough. If macOS ever says Calm
*is damaged and can't be opened* (the quarantine flag of the download), run once in Terminal:
`xattr -dr com.apple.quarantine /Applications/Calm.app`.

**Windows** (10 and 11)
1. If your browser flags the download, keep it (Edge: *…* › *Keep* › *Show more* › *Keep anyway*).
2. Run `Calm.Setup.x.y.z.exe`. On the blue *Windows protected your PC* screen, click **More info**, then
   **Run anyway**.
3. The installer sets Calm up for your user and opens it.

If Windows 11 *Smart App Control* is on, it blocks unsigned apps with no way around it; run Calm from source instead
(below) — turning Smart App Control off cannot be undone without reinstalling Windows.

**Linux** — `chmod +x Calm-*.AppImage` and run it.

The app runs the Calm server in the background, starts at login (toggle in the menu bar icon menu), shows the number
of mails to answer in the menu bar and notifies you of every new mail. Logs: `~/.calme/server.log`.

### 3. Connect Gmail (once, ~10 minutes)

On first launch, a **setup assistant** checks Claude Code, guides you through the Google steps below, lets you drop
the downloaded client file into the app and authorises Gmail and Calendar. You can run it again from *Admin*.

Google requires every app to have its own OAuth client. It is free.

1. Open <https://console.cloud.google.com>, create a project.
2. *APIs & Services › Library*: enable **Gmail API** and **Google Calendar API**.
3. *Google Auth Platform › Branding*: app type **External**, name it, add your address as support and developer contact.
4. *Audience*: add your Gmail address as a **test user**.
5. *Clients › Create client*: type **Desktop app**. Download the JSON.
6. Drop the JSON into the setup assistant (or save it as `~/.calme/credentials.json`;
   Windows: `C:\Users\<you>\.calme\credentials.json`), then click **Connect Gmail**: your browser opens Google's
   consent page, and Calm moves on by itself once you accept.

**Stay connected for good.** While the app is in *Testing*, Google signs you out every 7 days. To avoid that, publish
it: in *Branding*, fill *Application home page* (e.g. `https://github.com/DamienGdn/calme`) and *Privacy policy*
(e.g. this repository's [`PRIVACY.md`](PRIVACY.md)), save, then *Audience › Publish app*. You don't need Google's
verification for your own use: the consent page shows *Google hasn't verified this app* — click *Advanced* ›
*Go to Calm (unsafe)* — and the app is limited to 100 users. Reconnect once after publishing (*Admin*).

Calm asks for three permissions: read and organise mail (`gmail.modify` — no permanent deletion possible), send mail
(`gmail.send`) and read/create calendar events (`calendar.events`). Tokens stay in `~/.calme/`, readable by you only.

### 4. iPhone

1. Install [Tailscale](https://tailscale.com) on the computer and the iPhone (same account); enable MagicDNS and HTTPS.
2. In Calm on the computer: *Admin › iPhone › Share Calm with my iPhone*. Calm becomes reachable at
   `https://<computer>.<tailnet>.ts.net`, **only from your own devices**, and shows a QR code.
3. Scan it with the iPhone camera: Safari opens Calm already paired. *Share* › *Add to Home Screen*.
4. Open Calm from the icon, then *Enable notifications* (choose what to receive in *Admin › Notifications*).

## Run from source

```bash
git clone https://github.com/DamienGdn/calme.git && cd calme
pnpm install
pnpm build            # builds the Vue UI
pnpm start            # server on http://127.0.0.1:4747
pnpm calme pair       # prints the pairing token
```

Desktop app from source: `pnpm -C desktop start`. Installers: `pnpm -C desktop dist`, or push a `v*` tag — GitHub
Actions builds macOS, Windows and Linux installers and attaches them to a release.

| Variable | Default | Purpose |
|---|---|---|
| `CALME_HOME` | `~/.calme` | data, tokens, database |
| `CALME_PORT` | `4747` | local port |
| `CALME_MODEL` | `sonnet` | default model (also in *Admin*) |
| `CALME_INTERVAL_MIN` | `5` | minutes between fetches (also in *Admin*) |
| `CALME_CLAUDE_BIN` | `claude` | path to Claude Code if not on `PATH` |

### With Claude Code

This repository is set up for Claude Code (`CLAUDE.md`). Two slash commands drive Calm from your terminal:
`/tri` (fetch, sort and summarise what needs an answer) and `/menage` (prepare the clean-up). CLI:
`pnpm calme status | list [reply|read|news|trash] | sync | triage | cycle | pair`.

## Security & privacy

- Mail never leaves your computer except to Google (Gmail/Calendar) and Anthropic (Claude, through your own Claude Code).
- During triage Claude has **no tools** (`claude -p --tools ""`, no MCP servers, no user settings) and can only answer
  schema-validated JSON — a booby-trapped email cannot make it act on your machine. Mail content is fenced as untrusted data.
- The server listens on `127.0.0.1` only; every `/api` call needs the pairing token. Remote access goes through your
  private Tailscale network. Gmail authorisation is only accepted from the computer itself.
- "Delete" means the Gmail trash (recoverable for 30 days). Unsubscribing uses the sender's official link.

## Development

```bash
pnpm test                 # server (Vitest) and web (node:test) tests
pnpm -C web dev           # UI dev server (proxies /api to :4747)
pnpm -C server typecheck
```

---

## License

[MIT](LICENSE). Contributions are welcome through pull requests — see [CONTRIBUTING.md](CONTRIBUTING.md).
Privacy policy: [PRIVACY.md](PRIVACY.md).

---

<p align="center"><sub>Built with Claude Code · Powered by Claude</sub></p>
