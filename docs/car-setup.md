# Car setup analysis

The **Car setup** page looks at how the car behaves rather than how you drive it:
balance (understeer and oversteer), sliding, lock-ups and wheelspin, suspension
travel, ride height, bottoming, bump stops, wheels lifting, damper movement, and
roll, dive and aero squat. It finishes with suggestions for what to change.

Automobilista 2 doesn't send values called "understeer" or "bottoming". Some
figures come straight from the game; the rest are worked out from several
channels together. This page explains which is which.

## What comes from the game, and what's calculated

| On the page | Source | How |
|---|---|---|
| Suspension compression | `sSuspensionTravel`, metres, per wheel | Direct. Which way is "compressed" is detected: braking must compress the front. |
| Damper speed | `sSuspensionVelocity`, per wheel | Direct. Its direction is checked against the change in travel. |
| Ride height | `sRideHeight`, per wheel | Direct. AMS2 documents centimetres; the unit (m, cm or mm) is detected from typical size. |
| Wheel off the ground | `sTyreFlags`, bit 2 | Direct. |
| Understeer / oversteer | steering, yaw rate, speed | Calculated, see below. |
| Slip angle | `sLocalVelocity` | Angle between where the car points and where it's going. |
| Lock-ups and wheelspin | `sTyreRPS`, speed | Wheel surface speed against car speed. |
| Bottoming | ride height | Ride height at or below 3 mm. |
| Bump stops | suspension travel | Travel repeatedly stopping at the same ceiling. |
| Roll, dive, aero squat | suspension travel | Compression against lateral g, braking g and speed². |

The **Data from the game** card at the top of the page shows which of these were
found in your session, and the units and directions that were detected.

## Understeer and oversteer

The line the car is actually following has a curvature of **yaw rate ÷ speed**. A
car that's neither understeering nor oversteering needs steering in two parts:

- a **geometric** part, proportional to that curvature and set by the steering ratio and wheelbase
- a part that grows with **cornering force** (speed × yaw rate), because the tyres run at
  bigger slip angles as they work harder. This is the car's understeer gradient.

Neither is in the telemetry, so both are learned from your own laps, by fitting that
two-part line through steady cornering (off the brakes, without hard acceleration).
Spins, contact and trips off the track are left out. The fit is then repeated without
samples far from the line, so a handful of corners or one wild moment can't bend it.

At every moment:

- **balance = steering used − steering needed**
- more steering than needed means the front isn't gripping: **understeer**
- less than needed, or opposite lock, means the rear is rotating the car: **oversteer**

Each corner is split into **entry** (up to 15 m before the slowest point),
**mid-corner** (±15 m) and **exit**. A phase is called understeer or oversteer when you
used more than 12% more, or 12% less, steering than needed.

Because it's calibrated against this car's own behaviour at the same cornering force,
the measure works for any car and doesn't mistake normal tyre slip at the limit for
understeer. It shows where the balance departs from how the car usually behaves: entry
against mid-corner, slow corners against fast ones, one setup against another. It can't
compare the car with a theoretical "perfectly neutral" car.

Moments where the steering already points the other way but the car isn't sliding are
left out. The car is changing direction faster than it can rotate, which says nothing
about balance. Without this, every chicane exit read as oversteer.

**Oversteer moments** are stretches of at least 0.15 s where steering fell more than
35% below what the car needed **and** the car was more sideways than it usually gets at
the limit (its 95th-percentile slip angle while cornering, measured per session). That
includes catching a slide with opposite lock, but not unwinding the wheel out of a corner.

## Sliding

**Slip angle** is the angle between the direction the car points and the direction it
travels, from the car's own sideways and forwards velocity. A few degrees is normal at
the limit; the corner table shows the typical peak for each corner.

## Lock-ups and wheelspin

Each wheel's **rolling radius** is measured on straights at speed, where tyres barely
slip. AMS2 sends wheel speed in radians per second, despite calling it `sTyreRPS`. The
unit is detected from the radius each reading would imply, since only one comes out
tyre-sized. In a corner the outside wheels travel further than the middle of the car, so
each wheel is compared with its own path. The track width that needs is measured from how
the front wheels' speeds differ in gentle corners, and the correction is skipped if it
doesn't come out car-sized. After that,
**slip = (wheel surface speed − speed along the wheel's path) ÷ that speed**:

- **lock-up**: below −15% while braking, for at least 50 ms
- **wheelspin**: above +12% on the throttle, for at least 80 ms

## Suspension, ride height and bump stops

- **Travel used** is the range each corner of the suspension covers, ignoring the most
  extreme 2% at each end.
- **Bottoming** is ride height at or below 3 mm. When the car also takes a sharp
  vertical jolt (1 g or more) at the same moment, it counts as a **kerb or bump strike**
  instead, which calls for different changes.
- **Bump stops** are suspected when an unusual share of samples (at least 0.2%) sits within
  a hair of the same maximum compression. Springs and dampers alone rarely pile samples up
  at one ceiling; a bump stop does.
- **Wheel lift** is a wheel reported off the ground for at least 0.1 s above 54 km/h.

Every event records the lap, the corner and whether you were braking. That's how the hints
can say "under braking into T5" rather than just "sometimes".

## Damper histograms

For each wheel, the time spent at each damper speed is counted in 10 mm/s bins from −250 to
+250 mm/s. Left of zero is **rebound** (extending), right is **bump** (compressing). Movement
faster than 25 mm/s counts as **fast**, the range controlled by fast bump and fast rebound.

A roughly symmetrical shape usually means bump and rebound are balanced. A damper that spends
noticeably more time compressing than extending is usually stiffer in bump than in rebound at
that corner, and vice versa.

AMS2 sends telemetry about 60 times a second at UDP Frequency 1. Dampers can move faster than
that over kerbs and bumps, so treat the fast-movement figures as approximate. They're most
useful for comparing one setup with another.

## Roll, dive and aero squat

- **Roll**: the difference between left and right compression, per g of cornering, for each axle.
- **Dive**: how much more the front compresses than the rear, per g of braking.
- **Aero squat**: extra compression on the straights between about 70 km/h and top speed.
- **Ride harshness**: vertical vibration on the straights.

Lines are fitted through the middle 98% of samples, and anything above 5 g is ignored, so kerb
strikes and contact don't skew the result. None of these have a "right" value; compare them
between setups. Stiffer springs or anti-roll bars make the matching number smaller.

## Spins, contact and trips off the track

Being hit, spinning or running onto the grass says nothing about the setup, so those
moments are left out of everything on the page: the steering and wheel calibration, the
distributions, the events and the hints. A moment counts when:

- horizontal acceleration goes beyond anything the car corners or brakes with (twice its
  usual peak, and at least 5 g), which only contact produces
- the car is more than 25° sideways
- two or more wheels are off the track

One second before and three seconds after each one are left out too. The **Data from the
game** card says what was left out.

## Setup hints

Hints appear when a pattern repeats: an event at least three times and on at least a
quarter of the laps (never from a single lap), or understeer in at least 40% of corners
in the same phase. The suggestions follow common setup practice:

| Pattern | Typical changes |
|---|---|
| Bottoming under braking | more ride height, stiffer front springs or slow bump, more packer range |
| Bottoming at high speed | more ride height, stiffer springs, less wing at that end |
| Kerb or bump strikes | softer fast bump, a little more ride height, less kerb |
| Running out of travel | stiffer springs or more ride height (or leave it, if the car is fast) |
| Wheel lifting | softer anti-roll bar or fast bump at that axle, less kerb |
| Front lock-ups | brake bias rearward, less brake pressure |
| Rear lock-ups | brake bias forward, softer rear rebound, less engine braking |
| Wheelspin | softer rear springs or anti-roll bar, more traction control, less diff power lock |
| Mid-corner understeer | softer front anti-roll bar or stiffer rear, more front wing |
| Mid-corner oversteer | stiffer front anti-roll bar or softer rear, more rear wing |
| Entry understeer | brake bias rearward, softer front bump or stiffer rear rebound |
| Entry oversteer | brake bias forward, stiffer front bump or softer rear rebound |
| Exit understeer | softer front rebound or stiffer rear bump, softer front anti-roll bar |
| Exit oversteer | softer rear bump or anti-roll bar, less diff power lock |

Every car responds differently. **Change one thing at a time**, drive a few laps, and use
**Compare with another setup** to see what actually moved.

## Checking it against your car

AMS2's UDP output doesn't document every unit and direction, which is why they're detected
from the data. If something looks wrong for your car (a ride height that can't be right, or
understeer everywhere on a car that feels loose), record a few laps with **Record telemetry**
on the Sessions page and share the file. The recording contains every packet exactly as the
game sent it, so the analysis can be checked and fixed against the real thing.
