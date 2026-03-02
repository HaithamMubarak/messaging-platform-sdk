# 🎉 Party Physics - Multiplayer Brawl Game

A multiplayer physics-based party game built with **Three.js**, **Rapier Physics**, and the **Messaging Platform SDK**.

## 🎮 Game Features

### Game Modes
- **⚔️ Fight Mode** (MVP Complete) - Last one standing wins! Battle in a circular arena with punches, dashes, and special abilities.
- **⚽ Dodgeball Mode** (TODO) - Hit opponents with balls to deal damage and knockback.
- **🏁 Race Mode** (TODO) - First to finish through obstacle course wins.

### Characters (Archetypes)
1. **🐻 Bear (Tank)**
   - HP: 140 | Speed: 0.85x | Mass: 1.5x | Strength: 1.3x
   - Ability: Ground Slam (AoE knockback, 8s cooldown)

2. **🐰 Bunny (Speedster)**
   - HP: 90 | Speed: 1.25x | Mass: 0.8x | Strength: 0.9x
   - Ability: Blink Dash (Long dash, 6s cooldown)

3. **🐂 Bull (Brawler)**
   - HP: 110 | Speed: 1.0x | Mass: 1.2x | Strength: 1.4x
   - Ability: Charge (Forward burst + stun, 9s cooldown)

4. **🐵 Monkey (Trickster)**
   - HP: 100 | Speed: 1.05x | Mass: 1.0x | Strength: 1.0x
   - Ability: Double Jump (Extra mid-air jump, 4s cooldown)

5. **🐸 Frog (Chaos)**
   - HP: 105 | Speed: 1.0x | Mass: 1.0x | Strength: 1.0x
   - Ability: Random Buff (Temporary random boost, 10s cooldown)

### Controls

#### Desktop
- **W A S D** or **Arrow Keys** - Move
- **Space** - Jump
- **Shift** - Dash
- **Ctrl** - Punch
- **Q** - Special Ability

#### Mobile
- **Virtual Joystick** - Move
- **Buttons** - Jump, Dash, Punch, Ability

### Combat System
- **Punch**: Short-range attack dealing damage based on strength
- **Dash**: Quick movement burst consuming stamina
- **Abilities**: Character-specific special moves
- **Fall Damage**: Going out of bounds eliminates player
- **HP System**: Take damage from attacks and falls

## 🏗️ Architecture

The game uses a **host-authoritative** architecture:

### Modules

1. **GameAuthority.js** (Host only)
   - Authoritative physics simulation using Rapier
   - Game logic, collision detection, damage calculation
   - Runs at 60Hz with fixed timestep
   - Sends snapshots at 20Hz

2. **GameClient.js** (All players)
   - Rendering with Three.js
   - Client-side interpolation for smooth visuals
   - No authoritative physics
   - Runs at 60fps

3. **NetAdapter.js** (Networking)
   - Control-plane: Messaging Platform (lobby, mode, start/end)
   - Data-plane: WebRTC DataChannel (inputs, snapshots)
   - Fallback to WebSocket if WebRTC unavailable

4. **InputHandler.js** (Input)
   - Keyboard input with proper debouncing
   - Generates input packets with sequence numbers

5. **MobileControls.js** (Mobile)
   - Virtual joystick for movement
   - Touch buttons for actions
   - Automatic detection and activation

6. **Archetypes.js** (Character stats)
   - Character definitions with stats and abilities

7. **Maps.js** (Arena definitions)
   - Different arenas for each game mode

### Network Protocol

**Control Plane** (Channel Messages):
```
HOST_ANNOUNCE    - Host election and announcement
MODE_SET         - Game mode selection
START_GAME       - Game start signal
END_GAME         - Game end with winner
PLAYER_JOIN      - Player joined with character
PLAYER_LEAVE     - Player left
RESYNC_REQUEST   - Client requests full state
FULL_STATE       - Host sends full state
```

**Data Plane** (WebRTC DataChannel):
```
INPUT packet (Client → Host):
{
  seq: number,
  t: timestamp,
  moveX: -1..1,
  moveY: -1..1,
  jump: boolean,
  dash: boolean,
  punch: boolean,
  ability: boolean
}

SNAPSHOT packet (Host → Clients):
{
  t: timestamp,
  entities: [
    {
      id: peerId,
      type: 'player',
      p: {x, y, z},      // position
      r: {x, y, z, w},   // rotation (quaternion)
      v: {x, y, z},      // velocity
      hp: number,
      stamina: number,
      alive: boolean
    }
  ],
  events: []
}
```

## 🚀 How to Run

### Prerequisites
1. Messaging Platform Services running on `http://localhost:8080`
2. Web SDK Server running on `http://localhost:8090`

### Start the Game
1. Open browser to: `http://localhost:8090/apps/mini-games/party-physics/`
2. Enter your name and room name
3. Click "Connect"
4. Select your character
5. Wait for other players to join
6. Host clicks "Start Battle!"

### Multiplayer
- Share the room name with friends
- 2-8 players supported
- First player to join becomes host
- Host can change game mode and start game

## 🎯 Game Flow

1. **Connection**
   - Player connects to channel
   - Host election (lowest peerId)
   - Player selects character

2. **Lobby**
   - Players join and choose characters
   - Host selects game mode
   - Host starts game when ready

3. **Game Running**
   - Host simulates authoritative physics
   - Clients send inputs to host
   - Host broadcasts snapshots
   - Clients interpolate for smooth rendering

4. **Game End**
   - Last player standing wins (Fight mode)
   - Results displayed
   - Host can restart

## 🔧 Technical Details

### Physics (Rapier)
- Gravity: -9.81 m/s²
- Player collider: Capsule (radius: 0.3m, height: 1.0m)
- Linear damping: 2.0 (for stability)
- Angular damping: 4.0 (keep upright)
- CCD enabled (prevent tunneling)

### Rendering (Three.js)
- 75° FOV perspective camera
- Dynamic lighting (ambient + directional + hemisphere)
- Shadow mapping enabled
- Fog for depth perception

### Interpolation
- Client maintains snapshot buffer
- 100ms interpolation delay
- Linear interpolation between snapshots
- Smooth camera follow

### Performance
- Host simulation: 60Hz
- Snapshot rate: 20Hz
- Input rate: 30Hz
- Render rate: 60fps

## 📝 TODO - Future Enhancements

### Dodgeball Mode
- [ ] Implement ball physics
- [ ] Ball pickup and throw mechanics
- [ ] Hit detection and scoring

### Race Mode
- [ ] Implement obstacle course
- [ ] Checkpoint system
- [ ] Finish line detection
- [ ] Race timer (optional)

### Abilities Implementation
- [ ] Bear: Ground Slam AoE
- [ ] Bunny: Blink Dash
- [ ] Bull: Charge with stun
- [ ] Monkey: Double Jump
- [ ] Frog: Random Buff system

### Polish
- [ ] Sound effects
- [ ] Particle effects (hits, abilities)
- [ ] Better character models
- [ ] Victory animations
- [ ] Replay system
- [ ] Spectator mode

### Network Improvements
- [ ] Host migration on disconnect
- [ ] Better lag compensation
- [ ] Client-side prediction
- [ ] Server reconciliation

## 🎨 Assets & Credits

- **Three.js**: 3D rendering library
- **Rapier3D**: Physics engine
- **Messaging Platform SDK**: Real-time networking
- **Character Icons**: Unicode emoji

## 📄 License

Part of the Messaging Platform SDK examples.

## 🤝 Contributing

This is an example game demonstrating the Messaging Platform SDK capabilities. Feel free to extend and modify for your own projects!

---

**Built with ❤️ using the Messaging Platform SDK**

