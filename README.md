<div align="center">

# AMS2 Coach

**Live telemetry and a driving coach for Automobilista 2, in your browser.**

Put it on your second monitor while you drive. It shows your live delta, where the last lap
lost time, and exactly what to try on the next one.

[![CI](https://github.com/chris-r-uol/ams2-telemetry/actions/workflows/ci.yml/badge.svg)](https://github.com/chris-r-uol/ams2-telemetry/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22.18+](https://img.shields.io/badge/node-22.18%2B-3c873a.svg)
![Windows · macOS · Linux](https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-555.svg)

<img src="docs/images/live-dark.png" alt="The Live page on lap 8 of a race at Monza, using the Optimisation preset. A full-size Last corner card shows T1 taken 0.14 seconds faster than the best run on lap 4: neutral on entry, understeer mid-corner and oversteer on exit, braking in the same place as the best run, with a speed trace against the best run and colour strips for balance, throttle and brake. Beside it a large green delta shows the lap is faster than the reference. Below, the Corner by corner card shows T1 in green and T2 next, and the Balance now meter reads oversteer." width="100%">

</div>

> Every screenshot in this README is real Automobilista 2 data: a GT3 race at Monza, replayed
> from its raw telemetry recording. `npm run screenshots` regenerates them from your own
> recordings.

## What it does

- **Live dashboard for a second monitor.** A grid of cards you arrange into presets: live delta,
  the corner you just drove and the one coming up, balance, grip used, line and steering, brake
  and throttle technique, the track map and more. Below the grid: lap times, gear, speed,
  pedals, tyres, fuel and live traces.
- **A coach after every lap.** The three corners that cost the most, each with a specific fix:
  *"Brake later into T11: you started braking 28 m earlier than lap 5 without carrying any
  extra speed."*
- **Lap-to-lap comparison.** Any two laps from any sessions on the same track: time difference,
  speed, throttle, brake, steering and gear by distance, with a map of where time was gained and
  lost and a corner-by-corner breakdown.
- **Session coaching.** Your ideal lap (your best run through every corner, combined), how far
  your best lap is from it, consistency, and **habits**: mistakes you repeat lap after lap.
- **Car setup analysis.** Understeer and oversteer through every corner, slip angle,
  lock-ups, wheelspin, suspension travel, ride height, bottoming, bump stops, wheels lifting,
  damper histograms and roll/dive figures, balance at each speed and with each pedal, gearing
  and shift points, and how much of the track you use, with suggestions for what to change and
  a side-by-side comparison with another setup. [How it's worked out](docs/car-setup.md).
- **Raw telemetry recording.** Press Record, drive, then download the file. Replay any recorded
  session on the Live page, with pause and 1×/2×/4× speed, or on any other computer, which
  makes it the best way to share a problem.
- **Every lap saved** automatically, with sectors, top speed, fuel and tyre data, and
  downloadable as JSON.
- **Live presets** for reading from the driving seat: arrange cards on a grid three wide and
  two high that fits one screen, and switch presets with <kbd>1</kbd>–<kbd>9</kbd>. Plus dark
  and light themes and text size up to 150%.
- **Built to be accessible.** Colour-blind-safe palette, and colour is never the only signal:
  deltas carry a sign, an arrow and the word *faster* or *slower*. Keyboard navigation, a table
  view for every chart, and optional screen-reader lap announcements.

## Quick start

On the Windows PC you race on:

1. Install **[Node.js LTS](https://nodejs.org)** (version 22.18 or newer).
2. Download this project: **Code → Download ZIP** and unzip it, or `git clone https://github.com/chris-r-uol/ams2-telemetry.git`.
3. Double-click **`start-windows.bat`**. The first run installs dependencies; after that it opens the dashboard at <http://localhost:8606>.
4. In Automobilista 2 go to **Options → System** and set:
   - **UDP Frequency**: `1`
   - **UDP Protocol Version**: `Project CARS 2`
5. Drag the dashboard to your second monitor and head out on track.

Prefer a terminal? `npm install` then `npm start`.

### Try it without the game

```bash
npm install
npm run demo
```

A simulated driver laps *Coachwood Park* with some very human habits (early braking, a lazy
throttle, a trip over the grass), so every feature has something to show. This is how the
project is developed on a Mac.

## Tour

### Compare any two laps

<img src="docs/images/compare.png" alt="Compare view at Monza: lap 10 (1:41.860) against the best lap 11 (1:41.460), 0.400 seconds slower, biggest loss at T4. Stacked charts show time difference, speed, throttle and brake by distance, with a crosshair readout in the braking zone for the first chicane. A track map colours each corner red for time lost or green for time gained, labelled with signed values such as T4 +0.38 and T5 −0.22." width="100%">

Pick any lap and any reference from the same track. Point at the charts to read every channel
at once, and the map marks the same spot. Drag to zoom; every chart also has a table view.

### Coaching for the whole session

<img src="docs/images/coach.png" alt="Coach view for the Monza race: best lap 1:41.460, ideal lap 1:40.119 with 1.34 seconds available from your own best corners, best sectors combined 1:40.679, and consistency of plus or minus 1.19 seconds over 9 laps. 'Where your best lap can improve' lists staying on the track at T4, not over-driving T6 and T5, finding time in T1 and improving the exit from T2, each with the time at stake and a link to compare laps. 'Habits' lists patterns such as being late on the throttle out of T4 on 5 of 10 laps, being slow through the apex of T1 on 8 of 10 laps and being late on the throttle out of T5 on 7 of 9 laps, with the laps where the car was hit left out." width="100%">

Every suggestion compares you with **yourself**: your best lap, or the lap where you took that
corner best. If you've done it once, you can do it again. Read
[how the coach works](docs/how-coaching-works.md).

### Live presets

The Live page is a grid of cards, three wide and two high, so a whole preset fits on one
screen. Every card comes in a **glance** size (one cell) and a **full** size (two cells wide):
the last corner with its speed, balance and throttle and brake strips, your line and steering
through it against your best run, a grip circle showing how much of the car's grip you used
through it, how you used the brake and throttle, the next corner, corner-by-corner time, live
balance, grip events, delta, lap trend, car status and the track map. Start from the Focus, Optimisation and Full presets,
then choose **Edit layout** to add, resize or swap cards and save your own. Press
<kbd>1</kbd>–<kbd>9</kbd> to switch between them. The **Card lab** page shows every card in
both sizes.

Between the Optimisation preset at the top of this page and the three below, every card appears.

<img src="docs/images/live-focus.png" alt="The Focus preset: glance-size cards for the delta (green, faster than the reference), the next corner (T2, with the distance to your best braking point and the cue 'Carry more speed'), the last corner (T1, 0.14 seconds faster, neutral on entry, understeer mid-corner, oversteer on exit), the one thing to focus on this lap (carry more speed at T2, worth about 1.15 seconds) and the car, with nothing needing attention." width="100%">

<img src="docs/images/live-full.png" alt="The Full preset: a full-size Last corner card for T1 with its speed trace and balance, throttle and brake strips, the Next corner card for T2, a Grip this lap card listing two moments of wheelspin, a Lap trend card saying the last lap was 1.23 seconds slower and the pace is dropping off, and the Car card with nothing needing attention." width="100%">

<img src="docs/images/live-technique.png" alt="A Technique preset built with Edit layout. Last corner steering draws your line through T1 over your best run's, with steering as blue-to-red strips. Last corner grip shows a friction circle with 86% of the available grip used against 84% on the best run, the most grip left off the pedals before the apex, and purple strips of unused grip along the corner. Brake and throttle plots both pedals through T1 against the best run and compares brake application, release, trail, pickup to flat out, backing off and throttle while adding lock, noting that you came off the brake more abruptly than on your best run. The Track map card marks the corners that cost the most time last lap in red." width="100%">

### Tune the car

<img src="docs/images/setup-hints.png" alt="Car setup page, 'What the data suggests' for the Monza race: Important hints that the front wheels lock under braking, mostly into T2 and T6, and that the rear wheels spin on exits, mostly at T1, T2 and T5, each with the evidence and things to try, such as moving brake bias rearward or softening the rear anti-roll bar. Further hints cover wheels leaving the ground at T5 and T2, mid-corner understeer, corner-exit oversteer, moments of sudden oversteer and kerb strikes knocking the front onto the ground." width="100%">

The setup page turns suspension, wheel-speed and yaw data into plain findings, each with the
evidence and a short list of things to try. Every figure is explained in
[docs/car-setup.md](docs/car-setup.md). Its **Grip used** card shows how much of the car's grip
you used in every corner across the session, where grip is usually left, the grip circle for
any lap against your best run, and the most grip the car showed at each speed. It also maps
balance at each speed and with each pedal (aero against mechanical balance, brake release
and traction), shows gearing, shift points, downshift over-revs and time on the rev limiter,
and measures how close to the kerbs you take each corner's turn-in, apex and exit.

<img src="docs/images/setup-balance.png" alt="Balance and grip card for lap 11 at Monza: a balance trace by distance, with slip angle and speed underneath and small triangles marking lock-ups, wheelspin and oversteer moments. Below it, a corner table gives an entry, mid-corner and exit verdict for each corner, such as 'Oversteer −86%' on the exit of T1 and 'Understeer +37%' mid-corner at T4, with peak slip angle and counts of oversteer moments, lock-ups and wheelspin." width="100%">

<img src="docs/images/setup-handling.png" alt="Handling by speed and pedal: a table of balance verdicts with speed bands across (under 120 km/h for T1 and T2, 120 to 180 km/h for T3 to T6, over 180 km/h) and pedal phases down (trailing the brake, off both pedals, part throttle, flat out, all cornering), for example understeer +24% off both pedals in the medium band and oversteer −47% flat out in the slow band. Below, rear wheel slip through corners: +1.3% inside and +0.7% outside on the power, −3.6% and −2.9% trailing the brake." width="100%">

<img src="docs/images/setup-grip.png" alt="Grip used card: a corner picker with T5 selected, a friction circle for lap 11 against the best run on lap 7, strips of unused grip along the corner, and grip used by phase (78% for the whole corner against 84%). A table gives each corner's grip used, best run, braking, off-the-pedals and part-throttle figures and where grip is usually left, such as 'Braking, 75–55 m before the apex (8 of 11 laps)' at T1. A last table lists the most grip shown at each speed, from 1.78 g cornering at 36 to 72 km/h up to 2.55 g above 144 km/h." width="100%">

<img src="docs/images/setup-track-use.png" alt="Track use card: for each corner, how often a wheel touched the kerb and how close the car stayed to the edge at turn-in, apex and exit, with the best run beside it. For example T1's inside kerb was used on 11 of 11 laps, while T6's exit kerb was used on 2 of 11 laps with the car typically 2.9 m in. Where no lap touched a kerb the edge is shown as not found yet." width="100%">

<img src="docs/images/setup-gearing.png" alt="Gearing and shifts card: for each of six gears, the speed per 1,000 rpm, the speed at the rev limit of about 8,593 rpm, the typical upshift at about 99% of the limit, the change in pull after the shift and a verdict of 'About right'. A downshift table lists how high the revs flare, with a few over the limit, and rear lock-ups straight after. The rev limiter section lists fifth gear held at the limit 11 times, mostly before T6, and sixth gear three times before T1. A last table lists the gears used in each corner with the median time for each choice." width="100%">

<img src="docs/images/setup-dampers.png" alt="Damper movement card with four histograms, one per wheel, showing the share of time at each damper speed from −250 to +250 mm/s, each labelled with its rebound and bump percentages and its fast-movement shares." width="100%">

### Every lap, saved

<img src="docs/images/session.png" alt="Session view for the Monza race, with Coach this session, Car setup, Replay session and Download lap data buttons. Best lap 1:41.460 on lap 11, ideal lap 1:40.119, consistency plus or minus 1.19 seconds across 9 laps, and 12 laps. A dot chart of lap times highlights the best lap and marks one lap off the scale, above a table of all laps with sector times, top speed, fuel used, average tyre temperature and status." width="100%">

### Light theme and phone layout

<table>
  <tr>
    <td width="72%"><img src="docs/images/live-light.png" alt="The Live page in the light theme, on the Full preset."></td>
    <td width="28%"><img src="docs/images/live-phone.png" alt="The Live page on a phone-sized screen, with the replay controls, lap facts, preset buttons and cards stacked in one column."></td>
  </tr>
</table>

To view the dashboard on a tablet or laptop, start it with `npm start -- --host 0.0.0.0` and open
the network address it prints.

## How it works

```mermaid
flowchart LR
  AMS2["Automobilista 2<br/>UDP broadcast · port 5606"] -->|packets ~60/s| DEC

  subgraph Server["Node.js server (runs on the gaming PC)"]
    DEC["Packet decoder"] --> LAPS["Lap builder<br/>laps, sectors, validity"]
    LAPS --> ANALYSIS["Analysis<br/>distance alignment · corners · tips"]
    LAPS --> STORE[("Sessions on disk<br/>data/sessions")]
    ANALYSIS --> API["REST API + WebSocket"]
    STORE --> API
  end

  API -->|live frames 20/s| UI["Browser dashboard<br/>React + uPlot"]
  DEMO["Demo simulator"] -.->|same packets| DEC
  REC[".ams2rec recording"] -.->|replay| DEC
```

1. **Decode.** AMS2 broadcasts the Project CARS 2 UDP protocol. Every packet layout is declared
   once and used both to decode the game's packets and to encode the simulator's
   ([protocol notes](docs/protocol.md)).
2. **Build laps.** Telemetry and timing packets are merged into ticks and cut into laps using
   the game's lap counter, official lap times, sector splits and its invalid-lap flag.
3. **Line laps up by distance.** Each lap is resampled every 2 m, so the same point on track
   lines up in every lap. That gives the live delta, the predicted lap and lap-to-lap traces.
4. **Find the corners and coach.** Corners are detected from speed on your best lap. Braking
   point, minimum speed, throttle pickup, exit speed and coasting are measured for every corner
   on every lap, then turned into ranked, specific advice.

### Why this stack

| Choice | Why |
|---|---|
| **Browser dashboard** | Runs on any screen: second monitor, tablet or laptop. Nothing to install per device. |
| **Node.js server, TypeScript end to end** | One language for the protocol, analysis and UI. Node runs the TypeScript directly (no server build step), and the analysis code is shared with the browser. |
| **UDP, not shared memory** | Works across operating systems and machines, needs no native Windows modules, and recordings replay identically on a Mac. |
| **uPlot** | Draws tens of thousands of points per chart quickly, which live telemetry needs. |
| **Files on disk** | Sessions are plain JSON and gzip in `data/`. No database to install. |

## Recording and sharing raw telemetry

Press **Record telemetry** on the Live or Sessions page before you head out, and press it again
when you're done. Or tick **Record every session automatically** to get one file per session.
Recordings appear on the Sessions page with **Replay** and **Download** buttons, and sessions you
recorded get a **Replay** button of their own.

A replay takes over the Live page, so every card behaves as it did while you drove. Pause it,
speed it up to 2× or 4×, and press **Stop replay** in the header to go back to listening for the
game. The game's packets are ignored while a replay plays, and the replayed laps aren't saved
again: they're thrown away when you stop.

<img src="docs/images/recordings.png" alt="Raw telemetry recordings card with a Record telemetry button, a checkbox to record every session automatically, and a table listing three Monza recordings with their start times and file sizes, each with Replay, Download and Delete buttons." width="100%">

A recording holds every packet exactly as the game sent it, so it replays identically anywhere,
including on a Mac with no game installed. To add a recording from another computer to your
saved sessions, replay it from the command line instead:

```bash
npm run replay -- recordings/2026-09-13-19-55-01_interlagos-gp.ams2rec
```

Add `--speed 4` to fast-forward or `--loop` to repeat. Recordings are the best way to report a
bug or check the analysis against a particular car. Each session page also has **Download lap
data**, which gives the processed laps as JSON.

## Options

`npm start -- [options]` (the `--` passes options through npm):

| Option | Default | |
|---|---|---|
| `--source udp\|demo\|replay` | `udp` | where telemetry comes from |
| `--port` | `8606` | dashboard port |
| `--host` | `127.0.0.1` | use `0.0.0.0` to allow other devices on your network |
| `--udp-port` | `5606` | port AMS2 sends to |
| `--record` | off | start recording raw packets straight away |
| `--recordings <dir>` | `./recordings` | where recordings are saved |
| `--file`, `--speed`, `--loop` | | replay controls |
| `--prefill <laps>` | `0` | demo: simulate laps instantly before going live |
| `--data <dir>` | `./data` | where sessions are stored |
| `--open` | off | open the dashboard in your browser |

Other tools such as SimHub or CrewChief can listen to the game at the same time.

## Accessibility

- Colours come from a palette validated for protanopia and deuteranopia, and all text meets
  WCAG AA contrast in both themes.
- Meaning never relies on colour alone: time differences have a sign, an arrow and words; lap
  status and tyre warnings are labelled.
- Every chart has a legend and a **Show as table** view.
- Full keyboard support with visible focus, a skip link, and landmarks.
- Screen readers get one polite announcement per completed lap, never per frame.
- Respects reduced motion, high contrast and forced colours, and scales to 150% text.

## Status and roadmap

The protocol decoder follows the published Project CARS 2 UDP definitions (which AMS2 uses) and
is tested end to end with a byte-accurate simulator. A few fields are
[not yet verified against every AMS2 build](docs/protocol.md#units-and-known-unknowns). If
something looks off, please open an issue with a recording.

- [ ] Verify every field against live AMS2 sessions
- [ ] Real corner names for known circuits
- [ ] Verify the chassis channels (units and directions) against more cars
- [ ] Tyre temperature across the tread (inside, middle, outside) for camber and pressure
- [x] Friction-circle (g-g) chart
- [ ] Import and export laps to compare with friends
- [ ] Optional shared-memory source on Windows for extra channels
- [ ] Packaged Windows app (no Node.js install)

## Contributing

Issues, recordings and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
setup (any OS, no game needed), the project layout and the accessibility checklist.

## Credits

- Packet definitions: `SMS_UDP_Definitions.hpp` by Slightly Mad Studios.
- Bit-field decoding cross-checked against [CrewChief V4](https://github.com/mrbelowski/CrewChiefV4).
- Charts by [uPlot](https://github.com/leeoniya/uPlot).

Not affiliated with or endorsed by Reiza Studios. Automobilista 2 is a trademark of its
respective owner.

## License

[MIT](LICENSE)
