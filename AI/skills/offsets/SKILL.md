---
name: offsets
description: Control where messages are read from and how history is tracked. Covers PollSource (AUTO/CACHE/DATABASE, and deprecated KAFKA) and ChannelOffsetInfo counters.
when_to_use: Use when fetching historical messages, tuning latency vs. completeness, debugging missing/duplicate messages, or interpreting offset counters.
---

# Offsets & Poll Source

## Concept

> **Changed 2026-07-14:** the broker layer was removed. Messages are delivered
> from Redis and persisted to PostgreSQL; there is no Kafka in the flow.

Message history is served from a **two-layer store** with fallback:

```
Layer 1: CACHE     — ultra-fast in-memory (Redis), where live messages land first
Layer 2: DATABASE  — permanent source of truth for historical data
```

`PollSource` selects which layers are eligible:

- `AUTO` — **the default, and what you almost always want.** Reads the cache
  first and falls back to the database for history. This is the only value that
  **long-polls**: the call parks until a message arrives or the timeout expires.
- `CACHE` — cache only. **Single-shot**: it returns immediately with whatever is
  there and *never* long-polls. Calling it in a tight loop is a busy-spin, not a
  live tail.
- `DATABASE` — durable history only (source of truth).
- `KAFKA` — **deprecated.** Still accepted so older clients keep working, but it
  now resolves to the database path. Do not use it in new code.

Reference enum: `agents/examples/web-sdk-server/src/main/java/com/hmdev/messaging/common/data/PollSource.java`
(`isCacheEnabled()`, `isDatabaseEnabled()` return true for the matching source
and for `AUTO`. `isKafkaEnabled()` is vestigial.)

## Offset tracking

`ChannelOffsetInfo` exposes the counters used to reason about position:
`agents/examples/web-sdk-server/src/main/java/com/hmdev/messaging/common/data/ChannelOffsetInfo.java`

- `cacheLocalCounter` — current cache counter (next allocated value)
- `dbLocalOffset` — local offset from DB metadata
- `dbGlobalOffset` — global offset from DB metadata. Since the broker removal
  this simply **mirrors `dbLocalOffset`** (it used to be the Kafka topic offset).
- `kafkaLastOffset` — **legacy**, retained for wire compatibility. There is no
  broker to observe, so do not build logic on it.

## Where it's set

`pollSource` is passed on `connect(...)` (see the **channels** skill) and/or per
receive via `ReceiveConfig`. Default is `AUTO` unless overridden.

## Notes for assistants

- Recommend `AUTO` unless the caller has a specific latency/completeness need.
- For "load all history" prefer `DATABASE`. **Do not recommend `CACHE` for a
  "live tail"** — it never blocks, so a receive loop over it spins the CPU and
  hammers the server instead of waiting. `AUTO` is the live tail.
- Never recommend `KAFKA`; it is deprecated and resolves to the database path.
- These four counters are the real fields — don't introduce others.
