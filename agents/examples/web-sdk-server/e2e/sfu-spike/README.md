# SFU spike

Answers one question with evidence rather than architecture: **does the WebRTC
relay carry a frame, and what does each extra viewer cost?**

    NODE_PATH=../node_modules SPIKE_KEY=<a public keyId> \
      xvfb-run -a node spike.js [viewers]

It opens one publisher (Chromium's fake camera) and N viewers against the real
messaging service, asks the relay to be provisioned, and then checks that each
viewer's `<video>` contains **lit pixels** — not that an element exists, which
a black rectangle would satisfy. Then it samples the SFU container's CPU idle
and busy, and finally checks that a viewer arriving late still gets the stream.

## What it found (2026-08-29)

The relay had never carried media. `/api/stats` showed thirteen relay agents
alive for weeks with `sourceStreams: 0`. Four separate faults, each of which
alone was enough:

1. **`ICE server parse failed`.** The helper built its ICE list from
   `TURN_PASSWORD`; the deployment sets `TURN_CREDENTIAL`. A TURN URL with no
   credential is ignored by browsers but makes wrtc's `new RTCPeerConnection`
   *throw*, so the relay could not build a peer connection at all and every SDP
   offer died in the handler.
2. **Dropped ICE candidates.** `handleIceCandidate` said browsers queue
   candidates internally when there is no remote description. They do not — it
   rejects. Candidates trickled ahead of the answer were logged and thrown away.
3. **`Failed to get active agents`.** The relay read `response.data.agents`; the
   service returns `data` as the array. So the fan-out to everyone already in
   the channel rejected on every call.
4. **Offers with no media.** The helper emits
   `('remote-stream', streamId, stream, sourceAgent)`; the relay took the middle
   argument as a stream *id* and passed it to `createStreamOffer`, which looked
   it up in a string-keyed Map, found nothing, and built an offer with recvonly
   transceivers and no tracks. Viewers negotiated, connected, and received
   nothing. The tell was in the log: offers to a late joiner printed "Added
   media stream to offer" and offers from the fan-out did not.

Waiting for ICE gathering before sending SDP fixed the node side and **broke
the browser mesh** — 91 green to ten red and back. So that wait is applied in
node only, which is where candidates were actually going missing.

## The number, and how much to trust it

With the fixes, 1/3/6 viewers all receive real frames, first within 10–25s, and
a late joiner is served.

| viewers | SFU CPU above idle | marginal |
|--------:|-------------------:|---------:|
| 1       | ~40% of a core     | —        |
| 3       | ~50–93%            | ~26%/viewer |
| 6       | ~117%              | ~8%/viewer  |

Marginal cost FALLS as viewers are added, which argues for forwarding with a
fixed receive cost rather than per-viewer transcoding. But this box has six
cores and was also running every Chromium tab in the test, so the numbers are
contended and they move a lot between runs. **They are not a capacity claim.**
A real number needs viewers driven from another machine. Until then the honest
public statement stays "a working group, not a broadcast to hundreds".
