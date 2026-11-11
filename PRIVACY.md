# Calme — Privacy policy

*Last updated: November 11, 2026*

Calme is an open-source email assistant that **runs entirely on your own computer**. It has no server, no account
system and no analytics operated by its authors. The authors of Calme never receive, store or see your data.

## What Calme accesses

When you connect your Google account, Calme asks for:

| Permission | Why |
|---|---|
| `gmail.modify` | read your mail to sort and summarise it; archive, label or move to the trash **when you click** (no permanent deletion) |
| `gmail.send` | send a reply or a new message **when you click Send** |
| `calendar.events` | read your upcoming events to spot conflicts; create an event **when you click Add** |

## Where your data goes

- **Your computer.** Mail metadata, summaries, a local search index, settings and the Google tokens are stored in
  `~/.calme/` on the computer running Calme, readable only by your user account. Optional daily backups are written to
  a folder you control (iCloud Drive › Calme on a Mac when available, otherwise `~/.calme/backups`).
- **Google.** Calme talks to the Gmail and Google Calendar APIs directly from your computer.
- **Anthropic (Claude).** To sort and summarise mail, Calme sends the relevant message content to Claude through
  **your own Claude Code installation and subscription**. This is governed by your agreement with Anthropic.
- **Your devices.** If you enable it, your iPhone reaches Calme through your private Tailscale network, and push
  notifications go through your browser vendor's push service (e.g. Apple) with a short title only.

Nothing is sent anywhere else. Calme has no telemetry.

## Google user data

Calme's use and transfer of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Google user data is used only to provide the features you see in Calme, is
never sold, never used for advertising, and never transferred to anyone except as described above to provide those
features.

## Removing your data

- Revoke Calme's access at any time: <https://myaccount.google.com/permissions>.
- Delete the `~/.calme/` folder (and any backup folder) to erase everything Calme stored.

## Contact

Questions: open an issue at <https://github.com/DamienGdn/calme/issues>.
