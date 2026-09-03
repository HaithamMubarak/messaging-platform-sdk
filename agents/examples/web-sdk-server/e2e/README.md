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

**Environment for `till-test.js`.** Till is licensing, so its suite talks to
messaging-service rather than a page, and it needs three values:

    export ADMIN_EMAIL=... ADMIN_PASSWORD=...        # to mint test licences
    export TILL_WEBHOOK_SECRET=...                   # the same one the service was started with
    # optional: TILL_API_BASE, default http://127.0.0.1:8082/messaging-platform/api/v1/messaging-service

Without the webhook secret the suite **fails** rather than skipping that
section. That is deliberate. A webhook section that quietly skips itself is how
an unsigned upgrade path ships: the endpoint that can hand somebody a paid
licence must have its accept path proven, not assumed.

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

**Load** — `load/room-scale-load.js` answers the question the browser suites
cannot: how many agents one channel actually holds at once. Every suite here
opens two or three clients; this one opens a hundred. It drives the SDK
directly rather than opening a hundred browsers, which is only possible
because the npm package can now be required from Node.

It takes the endpoint as an argument and refuses to run against anything that
looks like a shared deployment — a load test is the last thing that should
reach production by accident:

```
node load/room-scale-load.js http://127.0.0.1:8082/messaging-platform/api/v1/messaging-service 100
```

It fetches a short-lived developer key the same way the web app does, and it
fails unless 95% connect, 95% of those send, and 95% of what was sent reaches
the host. Two of those thresholds exist because earlier versions reported
success while every agent had been turned away, and again while nothing was
sent at all.

**Presence** — `ghost-departure.js` is not part of `npm test`; run it with
`npm test -- ghost`. It is opt in because it has to wait out a presence TTL,
not because it is allowed to fail.

It kills a client's network so no departure beacon can leave, then asks how
long the room keeps the ghost. This used to be an open gap — measured at over
five minutes with no drop, which mattered most for the host, because every
host-only action is gated on `isHost()` and host election only re-runs when
somebody is *seen* to leave. A crashed host left a room nobody could ever host.

`PresenceSweepService` in messaging-service closed it: the session TTL expires
the vanished agent and a sweep announces the DISCONNECT. Measured at 2.8-3.0
min over three runs, against a 180s TTL and a 30s sweep. The suite now asserts both halves —
the ghost leaves the roster, *and* somebody is host afterwards, since dropping
without promoting would leave exactly the unusable room this was written about.

The sweep is a backstop measured in minutes, which is why `migration-test.js`
still disconnects deliberately before closing the tab: roughly one abrupt close
in three fails to get its beacon out, and that suite is about whether host
election works, not about beacon luck or about waiting out a TTL.

## Writing another one

Keep the report shape — print `PASS (n)` then `FAIL (n)` — and the runner will
pick it up. `lib/harness.js` has the base URL, the screenshot directory, the
launch options and a small tally helper.

**Do not run a suite while `npm test` is going.** Each one drives two or three
browsers, and several at once starves the rest: a page that normally reaches its
connect button in under a second blows past a 25-second wait, and the failure
looks exactly like a broken app. Every flake chased in this suite so far has had
that shape. Run the full pass, or run one suite — not both.

Three habits worth keeping, all learned the hard way here:

- **Assert a non-zero precondition before asserting a change.** A test that
  reads an element that is always empty passes for nothing.
- **Suspect the harness before the code.** A large share of the failures these
  suites have produced were the test's fault: a control read from the wrong
  object, a log read from the wrong end, a synthetic touch that never landed.
  Confirm a red result is real before changing anything.

## Marketing homepage review

`homepages-test.js` is an opt-in, loopback-only suite for the SDK and Apps landing pages. It does not join channels or submit real API-key requests. Point `SDK_BASE_URL` and `APPS_BASE_URL` at the isolated sibling-worktree preview, then run `xvfb-run -a node suites/homepages-test.js`. `SDK_SHOT_DIR` receives the responsive captures and `homepages-report.json`. Preview setup is documented in the services repository under `docker/apps-service/review/README.md`. This suite is intentionally excluded from the full live-app runner.
