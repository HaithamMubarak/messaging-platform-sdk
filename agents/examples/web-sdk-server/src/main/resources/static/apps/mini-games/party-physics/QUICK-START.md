# 🚀 Party Physics - Quick Start Guide

## Prerequisites

1. **Messaging Platform Services** running at `http://localhost:8080`
2. **Web SDK Server** running at `http://localhost:8090`

## Starting the Game

### Step 1: Start Services

```bash
# Terminal 1: Start Messaging Platform Services
cd messaging-platform-services
./gradlew bootRun

# Terminal 2: Start Web SDK Server
cd messaging-platform-sdk/agents/examples/web-sdk-server
./gradlew bootRun
```

### Step 2: Open Game in Browser

```
http://localhost:8090/apps/mini-games/party-physics/
```

### Step 3: Connect

1. Enter your **username** (e.g., "Player1")
2. Enter a **room name** (e.g., "test-room")
3. Leave password blank (optional)
4. Click **"Connect"**

### Step 4: Select Character

Choose one of the 5 characters:
- 🐻 **Bear** - Tank (high HP, slow, strong)
- 🐰 **Bunny** - Speedster (fast, low HP)
- 🐂 **Bull** - Brawler (balanced, highest strength)
- 🐵 **Monkey** - Trickster (agile, double jump)
- 🐸 **Frog** - Chaos (random buffs)

### Step 5: Wait for Players

- **Minimum**: 2 players required
- **Maximum**: 8 players supported
- First player becomes **HOST**
- Only host can:
  - Change game mode
  - Start the game

### Step 6: Start Game (Host Only)

1. Click **"Start Battle!"** button
2. Game begins immediately
3. Arena loads with all players

## Controls

### Desktop
```
Movement:
  W / ↑  - Forward
  A / ←  - Left
  S / ↓  - Backward
  D / →  - Right

Actions:
  SPACE  - Jump
  SHIFT  - Dash (costs stamina)
  CTRL   - Punch (costs stamina)
  Q      - Special Ability (cooldown)
```

### Mobile
- **Virtual Joystick** (bottom-left) - Move character
- **Jump Button** (bottom-right) - Jump
- **Dash Button** (bottom-right) - Quick dash
- **Punch Button** (bottom-right) - Attack nearby players
- **Ability Button** (bottom-right) - Use special ability

## Gameplay Tips

### Combat
- **Punch** deals damage and knockback to nearby players
- **Dash** helps dodge attacks or chase enemies
- Combine **dash + punch** for aggressive combos
- Don't spam - manage your **stamina**!

### Special Abilities
- Each character has unique ability
- Watch the cooldown indicator
- Use abilities strategically

### Survival
- Stay on the platform! Falling = heavy damage or elimination
- Watch your HP bar (bottom center)
- Last player standing wins

### Win Condition
- Eliminate all other players
- Win by dealing damage OR pushing them off the arena
- Dead players shown with strikethrough in scoreboard

## Multiplayer Setup

### Host a Game
```
1. You connect first → You become HOST
2. Share room name with friends
3. Wait for them to join
4. Select game mode (Fight/Dodgeball/Race)
5. Click "Start Battle!"
```

### Join a Game
```
1. Get room name from host
2. Enter same room name
3. Select your character
4. Wait for host to start
```

### Example Session
```
Player1: Opens game, enters room "party123"
         → Becomes HOST
         → Sees "You are the host!" message

Player2: Opens game, enters room "party123"
         → Joins as client
         → Sees Player1 in lobby

Player3: Opens game, enters room "party123"
         → Joins as client
         → Sees Player1 and Player2

Player1: Clicks "Start Battle!"
         → All 3 players enter game simultaneously
```

## Game Modes

### ⚔️ Fight Mode (Available Now)
- Circular arena with outer ring
- Last one standing wins
- Falling deals heavy damage
- Full combat system active

### ⚽ Dodgeball Mode (Coming Soon)
- Rectangular arena with walls
- Pick up and throw balls at opponents
- Hit players deal damage + knockback
- Last one standing wins

### 🏁 Race Mode (Coming Soon)
- Obstacle course track
- First to finish wins
- Checkpoints along the way
- Falling resets to checkpoint

## Troubleshooting

### Cannot Connect
```
Error: "Failed to connect"
Fix: 
  1. Check Messaging Services running (port 8080)
  2. Check Web SDK Server running (port 8090)
  3. Check browser console for errors
```

### WebRTC Not Working
```
Info: Game automatically falls back to WebSocket
Fix: Not needed - game works either way
Note: WebRTC provides lower latency
```

### Game Feels Laggy
```
Possible causes:
  1. High network latency
  2. Slow client machine
  3. Too many players (>6)
  
Try:
  - Reduce player count
  - Play on local network
  - Close other browser tabs
```

### Host Left
```
Issue: Host disconnection ends game
Status: Host migration not yet implemented
Workaround: Everyone disconnects and rejoins
```

## Development & Testing

### Test Locally (Single Player)
```
1. Open game in browser
2. Connect to unique room
3. You become host automatically
4. Start game (even alone for testing)
5. Test controls and physics
```

### Test Multiplayer (Same Machine)
```
1. Open multiple browser windows/tabs
2. Each tab connects to SAME room name
3. Use different usernames
4. First tab becomes host
5. Host starts game
```

### Test on Network
```
1. Find your local IP: ipconfig (Windows) or ifconfig (Mac/Linux)
2. Share URL: http://YOUR_IP:8090/apps/mini-games/party-physics/
3. Friends connect from their devices
4. All must be on same network
```

## Performance Notes

- **Recommended**: 2-4 players for smooth experience
- **Maximum**: 8 players (may experience lag)
- **FPS**: Game targets 60fps rendering
- **Physics**: Host runs 60Hz simulation
- **Network**: 20Hz snapshot rate, 30Hz input rate

## Known Limitations

1. **Fight Mode Only**: Dodgeball and Race modes not yet implemented
2. **No Host Migration**: Game ends if host leaves
3. **No Reconnect**: Disconnected players cannot rejoin running game
4. **Abilities Placeholder**: Special abilities trigger but effects not fully implemented
5. **No Sound**: Sound effects not yet added

## Next Steps

After playing Fight Mode:
1. Check README.md for technical details
2. Explore the code modules
3. Try implementing Dodgeball or Race mode
4. Add your own character archetypes
5. Enhance abilities with visual effects

## Support

For issues or questions:
1. Check browser console for errors
2. Check server logs
3. Verify all services are running
4. Review README.md for architecture details

---

**Have fun and enjoy the chaos!** 🎉

Built with the Messaging Platform SDK

