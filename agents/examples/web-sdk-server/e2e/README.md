# Browser suites for the web SDK site

These drive the site the way a person would: real Chromium, two or three
clients in the same room, and an assertion about what the *other* client sees.
Almost every real defect found in this site came from that shape — an app can
load cleanly, pass every static check, and still not work between two people.

## Running them

    cd agents/examples/web-sdk-server/e2e
    npm install
    npm run install-browser        # fetches Chromium for Playwright
    npm test                       # every suite, one summary table

One suite at a time, which is what you want while fixing something:

    xvfb-run -a node suites/chat-test.js

Filter the runner to a few:

    npm test -- chat pict mobile

### Two things that are not optional

**Headed, under a virtual display.** Headless Chromium cannot create a WebGL
context, and several apps here are 3D. The suites launch headed with
SwiftShader, which on a server means `xvfb-run`. `npm test` wraps each suite in
it already.

**A running site.** Default is `http://localhost:8084`, the local container:

    ./gradlew :agents:examples:web-sdk-server:bootJar          # from the SDK root
    cd ../../../../messaging-platform-services/docker
    docker compose build web-sdk-service && docker compose up -d web-sdk-service

Point them elsewhere with `SDK_BASE_URL`. Screenshots land in `shots/`
(git-ignored); override with `SDK_SHOT_DIR`.

## What is here

**Site sweeps** — every page, cheaply.

| suite | asks |
|---|---|
| `health.js` | loads, no console errors, no 404ing assets, design tokens present |
| `links.js` | no broken links |
| `mobile.js` | no horizontal overflow, no small tap targets, no sub-11px text |
| `contrast.js` | body text is readable in dark mode — a page that paints its background but leaves the text colour to the browser is white-on-white for anyone whose OS is dark |
| `token-check.js` | `design-tokens.css` actually reaches the page; shared component CSS is written against those variables and silently renders unstyled without them |
| `a11y.js` | every control has an accessible name, every field a label, every image an alt, every page a `lang` |
| `focus.js` | tabbing shows a visible ring at each stop |
| `icon-blank-test.js` | every sprite `<use>` resolves, none renders at zero size or at the unsized 300x150 replaced-element default, no visible control is blank |

**Self-checks** — `a11y-selfcheck.js` and `focus-selfcheck.js` inject a
deliberately broken control and confirm the sweep goes red. A green sweep that
has never been shown failing proves nothing; this project has been burned by
exactly that before.

**Apps and games** — two or three clients, doing the thing the app is for:
messages arriving after a clear, a drawing syncing, a file crossing in forty
chunks byte-for-byte, both quiz players seeing the same question.

**Platform** — `migration-test.js` closes the host's tab and asks whether the
room survives *and still works*; `reconnect-test.js` takes a client offline and
back; `smoke-all.js` is the cheap does-it-connect pass.

**Mobile** — `mobile-play-test.js` runs a phone viewport with real touch and
presses the on-screen controls. Those only exist below 768px, so no desktop
run reaches them.

**Known gaps** — `ghost-departure.js` is not part of `npm test`; run it with
`npm test -- ghost`. It measures a real platform limitation rather than gating
on it:

> Departure is announced by a pagehide beacon from the leaving tab. A crash, a
> killed process or a dead battery sends nothing, and there is no server-side
> presence timeout behind it — so the vanished agent stays in the roster. It
> matters most for the host: host election only re-runs when somebody is *seen*
> to leave, and every host-only action is gated on `isHost()`, so a host that
> crashes leaves a room nobody can ever host again. Measured at over five
> minutes with no drop. The fix belongs in messaging-service — a heartbeat and
> a short TTL on agent presence.

That gap is also why `migration-test.js` disconnects deliberately before
closing the tab: roughly one abrupt close in three fails to get its beacon out,
and that suite is about whether host election works, not about beacon luck.

## Writing another one

Keep the report shape — print `PASS (n)` then `FAIL (n)` — and the runner will
pick it up. `lib/harness.js` has the base URL, the screenshot directory, the
launch options and a small tally helper.

Two habits worth keeping, both learned the hard way here:

- **Assert a non-zero precondition before asserting a change.** A test that
  reads an element that is always empty passes for nothing.
- **Suspect the harness before the code.** A large share of the failures these
  suites have produced were the test's fault: a control read from the wrong
  object, a log read from the wrong end, a synthetic touch that never landed.
  Confirm a red result is real before changing anything.
