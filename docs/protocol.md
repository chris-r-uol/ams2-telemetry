# Automobilista 2 telemetry protocol

AMS2 is built on the Madness engine and speaks the **Project CARS 2 UDP protocol**
(patch 5, "version 2"). With UDP enabled it broadcasts little-endian C structs to
port **5606** on your network.

In the game: **Options → System → UDP Frequency 1** (fastest, ~60 Hz) and
**UDP Protocol Version: Project CARS 2**.

UDP was chosen over shared memory because it needs no Windows-only native code,
works across machines (the game PC can broadcast to a laptop), and can be
recorded and replayed byte for byte on any OS.

## Packets

Every packet starts with a 12-byte header: `packetNumber u32`,
`categoryPacketNumber u32`, `partialPacketIndex u8`, `partialPacketNumber u8`,
`packetType u8`, `packetVersion u8`.

| Type | Name | Size (bytes) | Sent | Used for |
|---:|---|---:|---|---|
| 0 | Telemetry (car physics) | 556, or **559** with tick count | every UDP tick | inputs, speed, gear, RPM, tyres, fuel, position |
| 1 | Race definition | 308 | on change | track name, layout, length |
| 2 | Participants | 1136 | on change | driver names |
| 3 | Timings | 1059, or **1063** with tick count | every UDP tick | lap number, lap time, lap distance, sector, invalid lap, pit mode |
| 4 | Game state | 24 | every 5–10 s | menu / playing / paused / replay, session type, weather |
| 7 | Time stats | 1040 | on sector crossings | official last lap time |
| 8 | Vehicle names / class names | 1164 / 1452 | on change | car and class |

AMS2 appends a 4-byte `tickCount` to the telemetry and timings packets compared
with the original PC2 header; the decoder accepts both lengths.

The single source of truth for byte offsets is
[`src/shared/protocol/layouts.ts`](../src/shared/protocol/layouts.ts). The same
tables drive decoding and encoding (the demo simulator), and a test checks that no
two fields overlap and that every layout matches its documented size.

## Bit-packed fields

| Field | Decoding |
|---|---|
| `sGearNumGears` | gear = low nibble (`0xF` = reverse), number of gears = high nibble |
| `sRacePosition` | position = `& 0x7F`, active = bit 7 |
| `sRaceState` | race state = `& 0x7F`, **lap invalidated = bit 7** |
| `sSector` | sector = `& 0x07`; bits 4–5 and 6–7 add ¼ m precision to z and x |
| `sHighestFlag` | colour = `>> 2`, reason = `& 0x03` |
| `sPitModeSchedule` | pit mode = `& 0x07`, schedule = `>> 3` (checked in AMS2: leaving the garage reads 4, 5, 3, 0) |
| `sCarIndex` | vehicle index = `& 0x7FFF`, human = bit 15. AMS2 sends `0xFFFF` for the player, so the app asks you which car you're driving |
| `mGameState` | game state = `& 0x07`, session state = `>> 4` |
| `sLapsTimeInEvent` | timed session = bit 15; value = laps, or ×5 minutes when timed |

## Units and known unknowns

Decoded values are converted to SI units in
[`src/server/telemetry/hub.ts`](../src/server/telemetry/hub.ts). A few things are
inherited from PC2 documentation and haven't been verified against AMS2 on every
build yet:

- **Lap distance** arrives as whole metres. At racing speed the car covers more
  than a metre per tick, so the lap builder dead-reckons from speed and clamps the
  estimate inside the metre the game reported.
- **Sector numbering** (0- or 1-based) doesn't matter: splits are taken when the
  value changes.
- **Tyre pressure** (`sAirPressure`): AMS2's shared-memory header says PSI, while PC2-era data
  looks like kPa. Values under 70 are treated as PSI, larger ones as kPa.
- **Chassis channels** used by the [car setup analysis](car-setup.md): `sSuspensionTravel`
  (metres), `sSuspensionVelocity`, `sRideHeight` (AMS2 documents cm; recordings show metres), `sTyreRPS` (despite
  the name, AMS2 sends radians per second, negative going forwards),
  `sTyreFlags` (bit 2 = on the ground), `sAngularVelocity` (rad/s), `sLocalVelocity` (m/s)
  and `sOrientation`. Their directions and the ride-height unit are detected from the data
  rather than assumed; the page shows what was detected.
- **Lateral / longitudinal g** come from `sLocalAcceleration`. The sign convention
  isn't used by the coaching logic.
- **Terrain materials** are the PC2 list; off-track detection is best effort, and the
  game's own lap-invalidated flag is what marks a lap invalid.
- **Map orientation** may appear mirrored on some installs; there's a setting for it.

If you find a value that looks wrong, record a session (`npm start -- --record`) and
open an issue with the file attached. Recordings contain only telemetry.

## Recording format (`.ams2rec`)

Gzip-compressed stream:

```
"AMS2REC1"                 8-byte magic
repeat:
  u32 LE  milliseconds since the first packet
  u16 LE  payload length
  bytes   the UDP payload, unmodified
```

Replay from the Sessions page (the replay takes over the Live page and isn't saved), or with
`npm run replay -- recordings/<file>.ams2rec` (add `--speed 4` or `--loop`), which saves the
replayed laps as a session.

## Sources

- `SMS_UDP_Definitions.hpp`, Slightly Mad Studios (Project CARS 2 patch 5)
- [CrewChief V4](https://github.com/mrbelowski/CrewChiefV4) for the bit-field decoding used in practice
- AMS2 packet-size observations from [RangeyRover/Automobilista-2-Auto-Director](https://github.com/RangeyRover/Automobilista-2-Auto-Director)
