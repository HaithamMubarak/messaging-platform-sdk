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

With the fixes, every viewer receives real frames and a late joiner is served.

The first measurements were worthless: the browsers driving the test shared six
cores with the SFU, so the same six-viewer run reported anywhere from 50% to
93% CPU. Pinning the SFU to two cores of its own (`docker update
--cpuset-cpus="4,5"`) and measuring **delivered frame rate** rather than "did a
frame arrive" made it legible. Frame rate matters because a saturating relay
does not stop delivering — it delivers a slideshow, and every liveness check in
this file would keep passing right through the point where the product stops
working.

One 640x480 publisher at 20 fps, SFU pinned to two cores:

| viewers | SFU CPU (of 200%) | frame rate delivered |
|--------:|------------------:|---------------------:|
| 1       | 38%               | 19.8 /s              |
| 3       | 52%               | 20.0 /s              |
| 6       | 72–88%            | 19.9–20.0 /s         |
| 10      | 130%              | 19.4 /s              |

Cost is **linear with a fixed base**: roughly 30% of a core to receive the
stream, then 7–11% of a core for each viewer it is sent to. That is a
forwarding profile — transcoding would cost far more per viewer and the frame
rate would fall away as viewers were added. It does not fall: ten viewers all
got the source's full rate.

**What can be claimed:** ten simultaneous viewers of one 640x480 20 fps stream,
measured, no frame loss, at about two thirds of two dedicated cores.
Extrapolating the measured marginal cost gives roughly **16–24 viewers per two
cores** before saturation.

**What cannot:** a bigger number, or this one at a higher resolution. The
per-viewer cost is per stream and a 720p camera is not a 640x480 one. Ten was
also the most viewers this box could drive as browsers — beyond that the test
would be measuring Chromium, not the relay — so the 16–24 figure is arithmetic
on a measured slope, not an observation. Watch SFU CPU alongside frame rate:
if CPU is well under its allocation while frame rate falls, the harness is the
bottleneck and the number is about the test, not the product.
