# Fieldstamp — runbook

A remote inspection: the inspector stays put, the other person points a camera,
and the session produces an evidence log that can be added to but not quietly
rewritten.

## Running one

1. Inspector opens `inspect.html` and connects. **Name the session after the
   claim or the job** — that name is the storage key the log is written under,
   so reopening the same name restores the same log.
2. Send the link (Invite → QR or link) and the password, separately.
3. The other person opens `capture.html`, allows the camera, and their picture
   appears on the console. It goes browser to browser; no server sees it.
4. Pick a template, then **Ask** for a shot or **Capture** it directly. Capture
   sends the prompt and takes the photo in one go.
5. **Verify the chain** whenever you like. **Export report** saves one
   self-contained HTML file — open it and print to PDF.

## What is stored where, and why it matters commercially

| | where it lives |
|---|---|
| the live video | peer-to-peer only. Never recorded, never uploaded. |
| full-resolution photos | the inspector's browser, and the exported report |
| stamp, hashes, thumbnail | platform storage, appended with `storageAdd` |

That split is the sale. The footage of a stranger's home never becomes our
problem, so the data-protection review is a conversation rather than a project.
Say it that way, because it is the difference between this and a Zoom call plus
a folder.

## The chain

```
chain₀ = SHA-256( "fieldstamp:<session>" | imageHash₀ | canonicalStamp₀ )
chainₙ = SHA-256(        chainₙ₋₁        | imageHashₙ | canonicalStampₙ )
```

Stamps are serialised with sorted keys, so the same entry hashes to the same
value on any browser, next year. Remove an entry, reorder two, or change one
character of a stamp and every hash after it stops matching — **Verify the
chain** re-derives the whole thing and names the first entry that breaks.

Two rules the code keeps and you must not relax:

- **A photo that did not survive the wire is not evidence.** The console
  re-hashes what arrived and rejects the capture outright if it disagrees with
  the hash the phone published.
- **Annotations never touch the pixels.** Notes are stored beside the photo. An
  annotation drawn into the image would change the bytes, and then the hash no
  longer describes what the camera saw.

## What to say to a buyer, and what not to

Meter it **per completed inspection** — that is the unit they already cost
internally, so they can do the arithmetic in their head. A seat floor keeps
small teams worth serving.

Do not oversell the chain. It proves the log has not been altered *since it was
made*. It says nothing about whether the person pointed the camera at the right
car. If a legal team is going to lean on it, the honest next step is a signature
over the final chain hash from something they already trust, not more hashing.

## The gap that loses claimants

Both people must be online at once. There is no record-now-send-later mode, and
that is the single biggest reason a claimant drops out of a scheduled video
call. Unattended capture — guided prompts, recorded on their own time, uploaded
after — is the first thing to build if this goes past a pilot.

## Storage read-back, the thing that cost an hour

`storageGetList` returns `res.data.data.versions[]`, and each version's
`content` is **base64-encoded JSON**, not the object that was put in. Unwrap
both or the log reads back empty — which looks exactly like "nothing was
stored". `Fieldstamp.storedVersions()` and `Fieldstamp.decodeStored()` do it;
use them rather than reaching into the response.

## Test

`fs-test.js` — two clients against the real backend, chromium's fake capture
device standing in for a phone. It drives the whole flow and then **proves the
chain check can fail**: it edits a stamp and asserts the verifier catches it at
the right entry, deletes an entry and asserts the same, and feeds the console
bytes that do not match their published hash to assert the capture is rejected.
A verification that has never been seen to fail is not a verification.
