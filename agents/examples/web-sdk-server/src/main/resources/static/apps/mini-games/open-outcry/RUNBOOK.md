# Open Outcry — runbook

A trading-floor party game. The room trades a claim instead of answering it;
one player has been dealt the truth and has to make money without the tape
giving them away.

## Running a night

1. Put the host page on the big screen and connect. The first person to join a
   room is the **floor manager** — they own the matching engine, so it should be
   whoever's laptop is not going to sleep.
2. Everyone else joins the same room from their phone. Invite → QR.
3. Floor manager picks a pack, a round count and how long the market stays open,
   then **Open the floor**.

Three or more players is the real game: naming the insider needs a room. With
two, you each know it is the other; with one, it drops into practice — facts
only, no insider, no vote.

## How a round runs

| phase | what happens |
|---|---|
| sealed answer | only for a claim about somebody here: that person answers privately, and is the insider by construction |
| market open | everyone buys YES or NO; every fill moves the price and prints anonymously on the tape |
| name the insider | the market closes and everyone names who they think was trading on the truth |
| settling | shares pay 100 or 0, the insider is revealed, the standings redraw |

Money: everyone starts with 1000 for the whole match, not per round. A share
costs whatever its side is trading at and pays 100 if it settles that way. A
caught insider pays 50 to every trader who called it; one who gets away takes
100 for the trouble.

## The transport rule

The host is the matching engine and the only thing that broadcasts. Orders are
**addressed to the host** — `sendData(msg, hostName)` — never broadcast, because
`UserConnectionBase` auto-relays a broadcast to every other client before this
app ever sees it, and a broadcast order would leak the insider's hand the
instant they traded. Clients accept host traffic only when `peerId` really is
the host; the `_fromHost` flag alone is not enough, since a peer can forge it.

If you change `hostOrder`, `broadcastState` or `toPlayer`, rerun the E2E — its
privacy check asserts that no guest ever receives an `order` message.

## The commercial model this is built for

The shape is Jackbox's, and it is the reason the game is built host-authoritative
with phone controllers rather than as a lobby everyone pays into:

- **Base game** — the host buys once, three to twelve phones join free. Nobody
  but the host needs an account, which is what this platform is best at.
- **Packs** — `packs.js` is the product surface. `house` ships; `work` and `bar`
  carry `locked: true`, which is presentation only in this showcase build. Four
  to six packs a year is the treadmill; budget a writer, not a one-off build.
- **Venue tier** — a pub running a weekly night: their branding, their own
  questions, a leaderboard that persists across weeks. The branding rig in
  [SponsorPulse](../../sponsorpulse/) does most of that already.
- **Streamer mode** — guests play the real market while the audience trades a
  free-for-all version of the same round. Unbuilt, and it is the distribution
  strategy rather than a feature: a browser game has no shelf.

## Two things that will bite

**The host's browser is the exchange.** Close it and the game dies. A phone that
locks and rejoins is handled — it asks for a snapshot and gets one — but the
host is not. Snapshot-and-resume for the host is the next thing to build.

**Never show a bid-ask spread.** Two buttons, one moving line. A casual player
who sees an order book leaves, and this game only works if the whole room plays.

## Test

`oo-test.js` — three clients, a full match, run per the E2E rules
(xvfb + headed chromium). It asserts the privacy property, that exactly one
player holds a secret each round, that every client agrees on the price and
sees each print exactly once, and that the match settles and pays out.
