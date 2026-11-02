# Installable PWA readiness

Fleck Home Hub can be installed as a standalone web application, but it is not
an offline application. The manifest, icons and Apple metadata make the
existing authenticated site installable; they do not add a service worker,
offline cache, background synchronization or a native application shell.

## Current capabilities

- The web app manifest describes Fleck Home Hub with the short name "Home Hub",
  standalone display, the warm cream background and teal theme colors.
- The installed start URL is `/dashboard`. Signed-in household members open the
  dashboard directly. Signed-out visitors are still redirected by the server to
  `/sign-in`; authentication is not bypassed by installation.
- The manifest provides SVG, 192px, 512px and maskable 512px icons. Apple devices
  use a dedicated 180px `apple-touch-icon.png`.
- `src/app.html` provides favicon links and the Apple standalone/title metadata
  used by iOS Home Screen web apps.
- No service worker is registered. There is no offline shell and no cached
  household data. The separate `/display` view keeps its existing privacy model
  and is not cached by this work.

## Install from desktop Chromium

1. Open the Home Hub over its configured HTTPS origin and sign in.
2. Use the install icon in the address bar, or open the browser menu and choose
   **Install page as app** / **Install Fleck Home Hub** (wording varies by
   browser version).
3. Launch the installed app. A valid session opens `/dashboard`; otherwise the
   server redirects to `/sign-in`.

The installed window uses the same origin, cookies and server-side authorization
as a browser tab. Installing it does not grant access to another household.

## Add to Home Screen on iPhone and iPad

1. Open the Home Hub in Safari over HTTPS and sign in.
2. Tap **Share**, then **Add to Home Screen**.
3. Confirm the name "Home Hub" and the teal house icon, then tap **Add**.
4. Launch it from the Home Screen. The expected result is a standalone window
   showing `/dashboard` when the session is valid, or the sign-in page when it
   is not.

Safari has partial and version-dependent support for web app manifests. The
Apple-specific icon and standalone metadata cover the Home Screen path, but they
do not make Safari behave exactly like Chromium. Custom iOS launch images are not
provided; iOS may use a generated splash screen or a previous screenshot.

## Browser installation versus a native app

An installed PWA is still the website running in a browser-provided application
window. It has no bundled database, no native notifications, no background
refresh and no guaranteed startup behavior across browser or operating-system
updates. Network access and the Home Hub server are still required for every
household view. Offline synchronization is not implemented.

The installation prompt is also intentionally not implemented. Household
members install from the browser's own menu when they choose to; no in-app prompt
interrupts ordinary use.

## Icon sources and regeneration

The editable sources are:

- `static/icon.svg`: rounded teal tile with the cream house, used as the scalable
  favicon and any-purpose manifest icon.
- `static/icon-maskable.svg`: full-bleed teal master with the house inside the
  maskable safe zone, used for the maskable and Apple touch icons.

The committed PNGs were rendered locally with `rsvg-convert` 2.60.2:

```sh
rsvg-convert -w 192 -h 192 static/icon.svg -o static/icon-192.png
rsvg-convert -w 512 -h 512 static/icon.svg -o static/icon-512.png
rsvg-convert -w 512 -h 512 static/icon-maskable.svg -o static/icon-maskable-512.png
rsvg-convert -w 180 -h 180 static/icon-maskable.svg -o static/apple-touch-icon.png
rsvg-convert -w 32 -h 32 static/icon.svg -o static/favicon-32.png
```

After changing either SVG master, rerun those commands and inspect the 192px and
32px results at actual size before committing. The unit tests verify PNG
signatures and dimensions, but they cannot judge visual legibility.

## Automated evidence

Focused verification completed in this branch:

- `mise exec -- pnpm exec vitest run tests/pwa-assets.test.ts` — four asset and
  manifest checks passed.
- `mise exec -- pnpm exec playwright test e2e/pwa.spec.ts` — two Chromium browser
  checks passed: manifest/icon delivery and signed-out/signed-in launch behavior.
- `mise run verify` — passed after rebasing onto the latest `origin/main`:
  parity, agent policy, lint, typecheck, 181 unit/integration tests, production
  build, recovery test, all 48 browser tests, workflow analysis, secret scan and
  the moderate-or-higher dependency audit gate. The audit reported the existing
  low-severity advisory documented in `docs/security.md`.

These are simulated Chromium checks. They do not prove real Safari, iPhone or
iPad installation, iOS icon rendering, standalone status-bar layout, or cookie
persistence after a device restart.

## Manual validation still required

- [ ] Install from Safari on a real iPhone and iPad over the production HTTPS
      origin, and confirm the teal house icon and "Home Hub" title.
- [ ] Launch while signed in and confirm the dashboard opens without browser
      chrome.
- [ ] Sign out, relaunch, and confirm the sign-in page appears; then verify both
      parent and child sign-in and authorization.
- [ ] Confirm overlap with the status bar and safe areas on a notched device.
- [ ] Enable airplane mode and confirm the app does not show cached household
      data or claim offline availability.
- [ ] Install in desktop Chromium and macOS Safari, checking launch, sign-out and
      session behavior in each.
- [ ] Confirm the shared display remains unaffected and is not cached by this
      PWA work.
