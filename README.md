# TwitchUnblock — Web

Watch Twitch lives and VODs in your browser, no subscription needed, with the real chat.

**Website: https://test2-fawn-eta.vercel.app**

> 📱 **Also on iPhone and iPad** — [TwitchUnblock for iOS](https://github.com/MXFia19/TwitchUnblock) is the native app this website comes from: same backend, plus channel points, an immersive landscape player, a sleep timer and more. Install it through AltStore, SideStore or Feather.

---

## Features

### Home
- **Top streams**, France or worldwide — no login required
- **Followed channels** once logged in with Twitch, with profile pictures
- **Continue watching**: VODs you started, with their progress bar
- Live durations and viewer counts kept up to date

### Streamer
- Search with suggestions as you type
- Live status (title, game, viewers, uptime), or how long the channel has been offline
- Every past broadcast, filterable by keyword or date
- Recent streamers

### Player
- Custom controls built around the chat: fullscreen keeps both the video **and** the chat, laid over it
- Quality picker, including “Auto”, which shows the bitrate actually in use
- Playback speed, ±10 s, double-tap on mobile, keyboard shortcuts
- Picture in picture, “back to live” button, live latency
- VODs resume where you left off
- Mini player: playback keeps going while you browse
- “Open in…” VLC, Outplayer, Infuse, or copy the stream link

### Chat
- Connected straight to Twitch IRC — no iframe
- Twitch, **BTTV**, **FFZ** and **7TV** emotes, badges, username colours readable on a dark background
- Recent messages loaded on arrival: you never land in an empty chat
- **Pinned message** at the top of the chat — hide it, bring it back
- Chat once logged in: emote and username autocomplete, emote picker, replies
- Click someone to see their latest messages, mention them or reply
- Moderation honoured: deleted messages struck through or removed
- Scrolling pauses when you scroll up, with a “new messages” button
- **VOD chat**, replayed in sync with the video

### Everything else
- French, English, Spanish — follows your device language by default
- History and progress synced across devices when logged in
- Anonymous usage count, shown in the settings (see below)
- Mobile-first layout: bottom tab bar, settings sheet, landscape view

---

## Repository layout

```
public/              The website, served as-is by Vercel (no build step)
  index.html
  assets/
    styles.css
    js/
      main.js        Navigation, home, streamer page, settings
      player.js      Video player (hls.js)
      api.js         Worker, Helix and GQL access — configuration at the top
      usage.js       Anonymous usage count
      i18n.js        Translations
      store.js       History, progress, preferences (localStorage)
      util.js        Escaping, formatting, icons
      chat/          Chat: IRC, emotes, badges, pinned message, VOD replay
worker.js            Backend: Cloudflare Worker
wrangler.toml        Worker configuration
vercel.json          Website configuration on Vercel
```

The website is plain JavaScript (ES modules) — no framework, no build step.

---

## How it works

```
Browser ──► Cloudflare Worker ──► Twitch (playlists, video segments)
    │
    ├──► Twitch GQL     public data: streams, channels, VODs, VOD chat
    ├──► Twitch Helix   logged-in account: followed channels
    ├──► Twitch IRC     live chat (WebSocket)
    └──► BTTV / FFZ / 7TV / recent-messages   emotes and chat history
```

Video always goes through the Worker: Twitch's VOD CDN only accepts requests coming from `twitch.tv`, so a direct link would be blocked by the browser. The Worker also stores history backups and the usage count (Cloudflare KV).

The iOS app uses the same Worker.

### Security
- **History backups are private**: every read or write must carry the owner's Twitch token. The Worker has Twitch confirm it and checks it belongs to that account — knowing someone's (public) Twitch ID is no longer enough.
- **The proxy only relays Twitch and Luminous** (`ttvnw.net`, `jtvnw.net`, `twitch.tv`, `cloudfront.net`, `luminous.dev`), over HTTPS — it is not an open proxy.
- Usage pings only accept random UUIDs and store no IP address.

---

## Usage count

To know whether people actually use the website and the app, each browser (and each app install) sends a small signal to the Worker at most once an hour. The settings show distinct people today, over 7 days and over 30 days, split between website and iOS app.

| Sent | Never sent |
|---|---|
| A random ID generated in the browser | Twitch account, username |
| The website version | IP address (not stored by the Worker) |
| `web` or `ios` | Channels watched, history |

Keys expire on their own after 35 days. Anyone can turn it off in the settings, which also deletes their ID from the server.

Raw numbers: `GET https://test2.kurzmathis4.workers.dev/api/stats`

---

## Configuration

Everything lives at the top of `public/assets/js/api.js`:

| Constant | Purpose |
|---|---|
| `API_URL` | Worker address |
| `HELIX_CLIENT_ID` | Twitch application ID (login) |
| `REDIRECT_URI` | Where Twitch sends you back after login — must be registered exactly as-is in the Twitch developer console |
| `EXTERNAL_LINKS_VIA_PROXY` | Links handed to VLC / Outplayer / Infuse: through the Worker (`true`) or straight from Twitch (`false`) |

---

## Deployment

### Website (Vercel)
Every push to `main` is deployed automatically. `vercel.json` serves the `public/` folder with no build step.

### Worker (Cloudflare)
```bash
npx wrangler deploy
```
The `TWITCH_DATA` KV namespace (history backups and usage count) is declared in `wrangler.toml`.

### Locally
```bash
cd public
python3 -m http.server 8080
# then open http://localhost:8080
```
Twitch login only works at the address set in `REDIRECT_URI`.

---

## Credits

Made by [MXFia19](https://github.com/MXFia19).

Thanks to [hls.js](https://github.com/video-dev/hls.js), [BetterTTV](https://betterttv.com), [FrankerFaceZ](https://www.frankerfacez.com), [7TV](https://7tv.app), [recent-messages](https://recent-messages.robotty.de), [Lucide](https://lucide.dev) for the icons and [Inter](https://rsms.me/inter/) for the font.

Independent project, not affiliated with Twitch.
