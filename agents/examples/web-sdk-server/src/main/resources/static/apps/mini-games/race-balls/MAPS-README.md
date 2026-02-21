# Race Balls maps (JSON)

This folder uses a JSON-driven map config.

## Add a new map
1. Copy `map-default.json` to a new file, e.g. `maps/track-02.json`.
2. Update `metadata.id`, `metadata.name`, `spawns`, `track.groundSegments`, `checkpoints`, and `finishLine`.
3. Launch the map by opening:
   - `.../race-balls/?map=maps/track-02.json`

No core game logic changes required.

## Schema (v1) overview
Top-level:
- `schemaVersion` (number, required, currently `1`)
- `metadata` (required): `{ id, name, mode:"race", maxPlayers }`
- `physicsDefaults` (optional): `{ gravity, friction, restitution, linearDamping, angularDamping, maxNormalSpeed, maxBoostSpeed }`
- `spawns` (required):
  - Legacy: `[{x,y,z}]`
  - New: `[{ position:{x,y,z}, rotation:{x,y,z} }]`
- `frictionTypes` (optional): mapping of `frictionType -> { friction, restitution, color }`
- `track.groundSegments` (optional): `[{ id, position, size, rotation, frictionType }]`
- `walls` (optional): `[{ id, position, size, rotation, color, physics? }]`
- `obstacles` (optional): same shape as walls
- `bounceElements` (optional): `[{ id, position, size, rotation, restitution, color }]`
  - Back-compat: `bouncers` is also accepted
- `dizzyObstacles` (optional): `[{ id, position, size, rotation, dizzyDurationSeconds, color, physics? }]`
  - Special obstacles that temporarily disable player control on touch
  - `dizzyDurationSeconds` (default: 3): how long the player loses control
  - Color defaults to purple (#a855f7)
- `pickups` (optional): `[{ id, position, radius, staminaRestoreAmount, respawnSeconds? }]`
  - Back-compat: `restoreAmount` is also accepted
- `checkpoints` (required): `[{ id, position, radius, order }]` (order must be unique)
- `finishLine` (required): `{ position, radius, requiredCheckpoints }`

## Validation behavior
- Required fields must exist, otherwise map load fails.
- Unknown `frictionType` keys are treated as validation errors.
- Most numeric values are clamped to safe ranges.

If you want a lenient mode (unknown friction types fall back to `normal`), we can add that as a flag.
