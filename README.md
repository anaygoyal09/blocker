# Stillness

A Chrome extension that blocks websites you choose and replaces them with a reflective interruption page.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click `Load unpacked`.
4. Select this folder: `/Users/anaygoyal/Documents/GitHub/blocker`

## What it does

- Add blocked sites from the extension popup or settings page.
- Matches both the main hostname and subdomains.
- Redirects blocked visits to a custom page with a deeper message and reflection prompt.
- Auto-block categories like social media, games, adult content, shopping, and streaming.
- Uses a tiny local heuristic classifier that can inspect the opened page's URL, title, and visible text.
- Optionally checks Google search queries and blocks flagged searches such as 18+ or gaming-related queries.

## Main files

- `manifest.json`
- `background.js`
- `content.js`
- `options.html`
- `options.js`
- `blocked.html`
- `blocked.js`
- `popup.html`
- `popup.js`
