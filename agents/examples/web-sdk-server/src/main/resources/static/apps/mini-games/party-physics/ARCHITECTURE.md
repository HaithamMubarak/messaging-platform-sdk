# 🏗️ Party Physics - Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      PARTY PHYSICS GAME                          │
│                   Multiplayer Physics Brawler                    │
└─────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                          CLIENT SIDE                               │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              PartyPhysicsGame (Main Class)               │    │
│  │        extends UserConnectionBase (SDK Framework)        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                            │                                       │
│         ┌──────────────────┼──────────────────┐                  │
│         │                  │                  │                   │
│         ▼                  ▼                  ▼                   │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │ GameClient  │   │ NetAdapter  │   │InputHandler │           │
│  │  (Three.js) │   │ (Network)   │   │  (Input)    │           │
│  └─────────────┘   └─────────────┘   └─────────────┘           │
│         │                  │                  │                   │
│         │                  │                  ▼                   │
│         │                  │          ┌──────────────┐           │
│         │                  │          │MobileControls│           │
│         │                  │          │   (Touch)    │           │
│         │                  │          └──────────────┘           │
│         │                  │                                      │
│         ▼                  ▼                                      │
│   ┌──────────┐      ┌──────────┐                                │
│   │ Snapshot │      │  Input   │                                │
│   │  Buffer  │      │  Packets │                                │
│   └──────────┘      └──────────┘                                │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

                              │
                              │ WebRTC DataChannel
                              │ (or WebSocket Fallback)
                              │
                              ▼

┌────────────────────────────────────────────────────────────────────┐
│                          HOST SIDE                                  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │              GameAuthority (Host Only)                     │    │
│  │           Authoritative Physics Simulation                 │    │
│  └───────────────────────────────────────────────────────────┘    │
│                            │                                        │
│         ┌──────────────────┼──────────────────┐                   │
│         │                  │                  │                    │
│         ▼                  ▼                  ▼                    │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐            │
│  │Rapier World │   │  Game State │   │Input Buffer │            │
│  │  (Physics)  │   │   (Players) │   │ (Per Client)│            │
│  └─────────────┘   └─────────────┘   └─────────────┘            │
│         │                  │                                       │
│         │                  │                                       │
│         ▼                  ▼                                       │
│   ┌──────────┐      ┌──────────┐                                 │
│   │ Collision│      │ Snapshot │                                 │
│   │ Detection│      │Generator │                                 │
│   └──────────┘      └──────────┘                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

                              │
                              │ Broadcast Snapshots
                              │
                              ▼

                    ┌────────────────────┐
                    │   All Clients      │
                    │  (Interpolation)   │
                    └────────────────────┘
```

## Data Flow

### Input Flow (Client → Host)

```
┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────────┐
│ Player   │────▶│InputHandler  │────▶│NetAdapter│────▶│GameAuthority │
│ Keyboard │     │ (Collect)    │     │ (Send)   │     │ (Process)    │
└──────────┘     └──────────────┘     └──────────┘     └──────────────┘
                                            │
                                            │ 30Hz
                                            ▼
                                     ┌──────────────┐
                                     │INPUT Packet  │
                                     │{seq,t,move,  │
                                     │ jump,dash,...}│
                                     └──────────────┘
```

### Snapshot Flow (Host → Clients)

```
┌──────────────┐     ┌──────────┐     ┌────────────┐     ┌──────────┐
│GameAuthority │────▶│NetAdapter│────▶│GameClient  │────▶│ Screen   │
│ (Generate)   │     │(Broadcast)│     │(Interpolate)│     │(Render)  │
└──────────────┘     └──────────┘     └────────────┘     └──────────┘
      │                    │
      │ 20Hz               │ WebRTC/WS
      ▼                    ▼
┌──────────────┐     ┌────────────┐
│SNAPSHOT      │     │All Clients │
│{t,entities,  │     │(Buffer)    │
│ events}      │     └────────────┘
└──────────────┘
```

## Module Dependencies

```
party-physics.js (Main)
    │
    ├──▶ UserConnectionBase (SDK)
    │
    ├──▶ GameClient.js
    │      ├──▶ Three.js
    │      ├──▶ Archetypes.js
    │      └──▶ Maps.js
    │
    ├──▶ GameAuthority.js (Host only)
    │      ├──▶ Rapier3D
    │      ├──▶ Archetypes.js
    │      └──▶ Maps.js
    │
    ├──▶ NetAdapter.js
    │      └──▶ Messaging Platform SDK
    │
    ├──▶ InputHandler.js
    │
    └──▶ MobileControls.js
           └──▶ InputHandler.js
```

## Game Loop Timeline

### Host Simulation Loop (60Hz)

```
Time: 0ms         16ms        32ms        48ms        64ms
      │           │           │           │           │
      ▼           ▼           ▼           ▼           ▼
┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐
│ Process  ││ Process  ││ Process  ││ Process  ││ Process  │
│ Inputs   ││ Inputs   ││ Inputs   ││ Inputs   ││ Inputs   │
├──────────┤├──────────┤├──────────┤├──────────┤├──────────┤
│ Step     ││ Step     ││ Step     ││ Step     ││ Step     │
│ Physics  ││ Physics  ││ Physics  ││ Physics  ││ Physics  │
├──────────┤├──────────┤├──────────┤├──────────┤├──────────┤
│ Update   ││ Update   ││ Update   ││ Update   ││ Update   │
│ Game     ││ Game     ││ Game     ││ Game     ││ Game     │
└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘
      │           │           │           │           │
      └───────────┴───────────┼───────────┴───────────┘
                              ▼
                        Every 50ms (20Hz)
                        ┌──────────────┐
                        │   Generate   │
                        │   Snapshot   │
                        │   Broadcast  │
                        └──────────────┘
```

### Client Render Loop (60fps)

```
Time: 0ms         16ms        32ms        48ms        64ms
      │           │           │           │           │
      ▼           ▼           ▼           ▼           ▼
┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐
│ Collect  ││ Collect  ││ Collect  ││ Collect  ││ Collect  │
│ Input    ││ Input    ││ Input    ││ Input    ││ Input    │
├──────────┤├──────────┤├──────────┤├──────────┤├──────────┤
│ Interpolate│Interpolate│Interpolate│Interpolate│Interpolate
│ Snapshots││ Snapshots││ Snapshots││ Snapshots││ Snapshots│
├──────────┤├──────────┤├──────────┤├──────────┤├──────────┤
│ Update   ││ Update   ││ Update   ││ Update   ││ Update   │
│ Camera   ││ Camera   ││ Camera   ││ Camera   ││ Camera   │
├──────────┤├──────────┤├──────────┤├──────────┤├──────────┤
│ Render   ││ Render   ││ Render   ││ Render   ││ Render   │
│ Scene    ││ Scene    ││ Scene    ││ Scene    ││ Scene    │
└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘
```

## State Synchronization

### Player State (Authoritative on Host)

```
┌────────────────────────────────────────────────────────┐
│                    Player State                         │
├────────────────────────────────────────────────────────┤
│ peerId:        string                                   │
│ name:          string                                   │
│ archetype:     'bear'|'bunny'|'bull'|'monkey'|'frog'   │
│ hp:            number (current)                         │
│ hpMax:         number                                   │
│ stamina:       number (current)                         │
│ staminaMax:    number                                   │
│ isAlive:       boolean                                  │
│ position:      {x, y, z}                               │
│ rotation:      {x, y, z, w} (quaternion)               │
│ velocity:      {x, y, z}                               │
│ lastInputSeq:  number                                   │
│ abilityCooldown: number                                 │
│ stunned:       number                                   │
│ buffs:         array                                    │
│ score:         number                                   │
└────────────────────────────────────────────────────────┘
```

### Snapshot Buffer (Client)

```
┌─────────────────────────────────────────────┐
│         Snapshot Buffer (Circular)          │
├─────────────────────────────────────────────┤
│ [0] ← Oldest   {t: 1000, entities: [...]}  │
│ [1]            {t: 1050, entities: [...]}  │
│ [2]            {t: 1100, entities: [...]}  │
│ [3]            {t: 1150, entities: [...]}  │
│ [4] ← Newest   {t: 1200, entities: [...]}  │
└─────────────────────────────────────────────┘
              │
              │ Interpolate between
              ▼
    Render Time = Now - 100ms
    Find snapshots bracketing render time
    Lerp position, rotation, etc.
```

## Network Topology

### Mesh Topology (WebRTC)

```
         Client 1
            │
            │ DataChannel
            │
    ┌───────┼───────┐
    │       │       │
    │       ▼       │
    │     HOST      │
    │   (Client 0)  │
    │       ▲       │
    │       │       │
    └───────┼───────┘
            │
            │
        ┌───┴───┐
        │       │
    Client 2  Client 3
```

### Star Topology (Alternative)

```
    Client 1 ──┐
               │
    Client 2 ──┼──▶ HOST ◀── Data
               │
    Client 3 ──┘
         ▲
         │
    Snapshots
```

## Character Stats Comparison

```
┌──────────┬────┬──────┬──────┬─────────┬─────────┬──────────┐
│Character │ HP │Speed │ Mass │Strength │ Stamina │ Cooldown │
├──────────┼────┼──────┼──────┼─────────┼─────────┼──────────┤
│🐻 Bear   │140 │0.85x │1.5x  │  1.3x   │   80    │    8s    │
│🐰 Bunny  │ 90 │1.25x │0.8x  │  0.9x   │  120    │    6s    │
│🐂 Bull   │110 │1.0x  │1.2x  │  1.4x   │   90    │    9s    │
│🐵 Monkey │100 │1.05x │1.0x  │  1.0x   │  100    │    4s    │
│🐸 Frog   │105 │1.0x  │1.0x  │  1.0x   │  100    │   10s    │
└──────────┴────┴──────┴──────┴─────────┴─────────┴──────────┘
```

## Combat Damage Chart

```
┌────────────────┬────────┬──────────────────────────┐
│     Action     │ Damage │      Side Effects        │
├────────────────┼────────┼──────────────────────────┤
│ Punch          │  8-11  │ Knockback, 5 stamina     │
│ Dash Collision │   6    │ Knockback, 20 stamina    │
│ Ball Hit       │  12    │ Heavy knockback          │
│ Fall Damage    │  25    │ N/A                      │
│ Out of Bounds  │  ∞     │ Instant elimination      │
└────────────────┴────────┴──────────────────────────┘

Note: Punch damage scales with character strength
```

## Performance Budget

```
┌────────────────┬──────────┬─────────┐
│   Component    │  Target  │  Actual │
├────────────────┼──────────┼─────────┤
│ Host Physics   │  60 Hz   │  60 Hz  │
│ Host Snapshot  │  20 Hz   │  20 Hz  │
│ Client Input   │  30 Hz   │  30 Hz  │
│ Client Render  │  60 FPS  │  60 FPS │
│ Network Lag    │ <100ms   │  varies │
│ Interpolation  │  100ms   │  100ms  │
└────────────────┴──────────┴─────────┘
```

---

**This architecture diagram provides a comprehensive visual overview of the Party Physics game system!** 🎉

