---
name: offsets
description: Control where messages are read from and how history is tracked. Covers PollSource (CACHE/KAFKA/DATABASE/AUTO) three-layer fallback and ChannelOffsetInfo counters.
when_to_use: Use when fetching historical messages, tuning latency vs. completeness, debugging missing/duplicate messages, or interpreting offset counters.
---

# Offsets & Poll Source

## Concept

Message history is served from a **three-layer store** with fallback:

```
Layer 1: CACHE     — ultra-fast in-memory (Redis)
Layer 2: KAFKA     — broker with retention limits
Layer 3: DATABASE  — permanent source of truth for historical data
```

`PollSource` selects which layers are eligible:

- `AUTO`   — all layers enabled, fallback Cache → Kafka → Database (default)
- `CACHE`  — cache only (fastest, may miss old messages)
- `KAFKA`  — broker only
- `DATABASE` — durable history only (source of truth)

Reference enum: `agents/examples/web-sdk-server/src/main/java/com/hmdev/messaging/common/data/PollSource.java`
(`isCacheEnabled()`, `isKafkaEnabled()`, `isDatabaseEnabled()` return true for the
matching source and for `AUTO`.)

## Offset tracking

`ChannelOffsetInfo` exposes the counters used to reason about position:
`agents/examples/web-sdk-server/src/main/java/com/hmdev/messaging/common/data/ChannelOffsetInfo.java`

- `cacheLocalCounter` — current cache counter (next allocated value)
- `dbLocalOffset` — local offset from DB metadata
- `dbGlobalOffset` — global offset from DB metadata
- `kafkaLastOffset` — last offset observed from Kafka (end − 1)

## Where it's set

`pollSource` is passed on `connect(...)` (see the **channels** skill) and/or per
receive via `ReceiveConfig`. Default is `AUTO` unless overridden.

## Notes for assistants

- Recommend `AUTO` unless the caller has a specific latency/completeness need.
- For "load all history" prefer `DATABASE`; for "live tail only" `CACHE` is
  cheapest. Explain the trade-off rather than guessing.
- These four counters are the real fields — don't introduce others.
