# AI Documentation — SDK Repository

This folder holds AI-facing documentation for the **public** `messaging-platform-sdk`
repository. It is **self-contained**: nothing here depends on, or refers to, any
private repository.

## Start here

➡️ **[`skills/SKILLS.md`](skills/SKILLS.md)** — the skills index.

The skills set describes the SDK's real surface, grounded in the code:

- **messaging** — send/receive event messages, transport model
- **channels** — connect/disconnect, sessions, agent listing
- **offsets** — `PollSource` (AUTO/CACHE/DATABASE; KAFKA deprecated), offset counters
- **authentication** — API keys, `apiKeyScope`, channel passwords
- **agents-integrations** — JS/Java/Python/C++ clients and game integration

## Guidelines

1. Document **public SDK behavior only**. Do not add docs about private
   backend/services internals to this repo.
2. Keep each `SKILL.md` consistent with the code; update it in the same commit
   as the code it describes.
3. Avoid throwaway status/progress files (e.g. `*-COMPLETE-<DATE>.md`). Use
   commit messages and PRs for change history instead.
