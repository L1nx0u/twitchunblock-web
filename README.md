# TwitchUnblock — Web (fork L1nx0u)

Watch Twitch lives and VODs in your browser, no subscription needed, with the real chat.

Fork of [MXFia19/TwitchUnblock-Web](https://github.com/MXFia19/TwitchUnblock-Web), maintained by
[L1nx0u](https://github.com/L1nx0u). The feature list, the architecture and most of the code come from
the original project: see its [README](https://github.com/MXFia19/TwitchUnblock-Web#readme).

- Site: <https://twitchunblock-web.vercel.app>
- Source: <https://github.com/L1nx0u/twitchunblock-web>

## What this fork changes

- **Its own backend**: the site talks only to its Worker at `https://api.l1nx0u.me`, deployed from
  `worker.js` in this repository, with its own D1 database and its own Twitch application.
- **No fallback to the original project's infrastructure**: `public/config.js` sets the Worker, the
  Twitch client ID and the redirect URI. Without it the site talks to its own origin (the Docker case),
  never to the upstream Worker, relay or Twitch app.
- **No usage count**: the site sends no usage signal and there is no public `/stats` page.
- **No Discord links**: the site is independent.
- **Vercel security headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
  (see `vercel.json`), on top of the page's CSP.
- **Hardened Worker proxy**: `*.twitch.tv` is not a blanket proxy target; Twitch VOD hosts need a
  VOD path (`<hash>_…`), as CloudFront already did in the original project.

Everything else — player, chat, multi-live, themes, languages, extension support, downloads — is the
upstream code at the commit this fork was synced to.

## Deployment

### Website (Vercel)

Every push to `main` is deployed automatically. `vercel.json` serves `public/` with no build step.

### Worker (Cloudflare)

```bash
npx wrangler deploy --env=""
```

The Worker is declared in `wrangler.toml`:

- custom domain `api.l1nx0u.me` (zone `l1nx0u.me`);
- D1 binding `DB` (`twitchunblock`, id `9c479a4a-…`);
- `ADMIN_TWITCH_IDS`, `TWITCH_CLIENT_ID` and `SITE_ORIGINS` for this fork;
- a Cron Trigger for live notifications;
- a `fallback` environment without D1 (`npx wrangler deploy --env fallback`).

Deploy the Worker **before or with** the website update: the newer site calls routes the old Worker
does not have (`/api/poll`, `/api/feedback`, `/api/push`, `/api/spade`). Core playback still works
against the old Worker, but those features answer 404 until it is deployed.

Optional secrets (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
`FEEDBACK_WEBHOOK`, `REPORTS_KEY`, `ALERT_WEBHOOK`, `NTFY_TOKEN`. None is required for playback.
This fork does not use the upstream ntfy relay.

## Configuration

`public/config.js` is the only site configuration:

| Key | Value in this fork |
|---|---|
| `apiUrl` | `https://api.l1nx0u.me` |
| `twitchClientId` | the fork's Twitch application |
| `redirectUri` | `https://twitchunblock-web.vercel.app/` |
| `fallbackApiUrls` | `[]` |
| `relayUrl` | `''` |
| `defaultPrefs.shareUsage` | `false` |

The redirect URI must be registered exactly as-is in the Twitch developer console.

## Credits

Fork from [MXFia19](https://github.com/MXFia19). Thanks to [hls.js](https://github.com/video-dev/hls.js),
[BetterTTV](https://betterttv.com), [FrankerFaceZ](https://www.frankerfacez.com), [7TV](https://7tv.app),
[recent-messages](https://recent-messages.robotty.de), [Lucide](https://lucide.dev) for the icons and
[Inter](https://rsms.me/inter/) for the font.

Independent project, not affiliated with Twitch.
