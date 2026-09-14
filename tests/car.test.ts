/**
 * Which car you're driving. AMS2 names every AI car by its index but sends no
 * index for the player, so the car usually comes from you and is remembered.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalysisService } from '../src/server/analysis-service.ts';
import { DemoSimulator } from '../src/server/demo/simulator.ts';
import { SessionManager } from '../src/server/session-manager.ts';
import { SessionStore } from '../src/server/storage.ts';
import { TelemetryHub } from '../src/server/telemetry/hub.ts';
import { PacketType } from '../src/shared/protocol/constants.ts';
import { encodeTimings, encodeVehicleNames, packParticipantInfo } from '../src/shared/protocol/encode.ts';

const header = { packetNumber: 1, categoryPacketNumber: 1 };

function timingsFor(carIndex: number, isHuman: boolean): Uint8Array {
  return encodeTimings(header, {
    numParticipants: 1,
    participantsChangedTimestamp: 1,
    eventTimeRemaining: 0,
    splitTimeAhead: -1,
    splitTimeBehind: -1,
    localParticipantIndex: 0,
    participants: [
      packParticipantInfo({
        worldPosition: [0, 0, 0],
        currentLapDistance: 10,
        racePosition: 1,
        sector: 1,
        raceStateIndex: 2,
        currentLap: 1,
        currentTime: 1,
        currentSectorTime: 1,
        carIndex,
        isHuman,
      }),
    ],
    tickCount: 1,
  });
}

describe('which car', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-car-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("names a car from its index, and lists the session's cars when the player has none", () => {
    const hub = new TelemetryHub();
    hub.ingest(
      encodeVehicleNames(header, [
        { index: 356, classIndex: 1, name: 'Oreca 07' },
        { index: 364, classIndex: 1, name: 'Ligier JS P217' },
      ]),
    );
    hub.ingest(timingsFor(0x7fff, true));
    expect(hub.context.car).toBe('');
    expect(hub.context.vehicles).toEqual(['Ligier JS P217', 'Oreca 07']);
    hub.ingest(timingsFor(356, false));
    expect(hub.context.car).toBe('Oreca 07');
  });

  it('keeps the car you choose, and assumes it for new sessions where the game says nothing', () => {
    const store = new SessionStore(dir);
    const drive = (withCarNames: boolean) => {
      const hub = new TelemetryHub();
      const manager = new SessionManager(hub, store, new AnalysisService(store), 'demo');
      const demo = new DemoSimulator(
        (bytes) => {
          if (withCarNames || bytes[10] !== PacketType.ParticipantVehicleNames) hub.ingest(bytes);
        },
        { seed: 3 },
      );
      demo.runLaps(1);
      return { manager, demo };
    };

    const first = drive(false);
    const session = first.manager.session!;
    expect(session.car).toBe('');
    expect(first.manager.chooseCar(session.id, 'Oreca 07')).toMatchObject({ car: 'Oreca 07', carSource: 'chosen' });
    first.demo.runLaps(1);
    expect(first.manager.session).toMatchObject({ id: session.id, car: 'Oreca 07', carSource: 'chosen' });
    expect(store.get(session.id)?.car).toBe('Oreca 07');

    const second = drive(false);
    expect(second.manager.session).toMatchObject({ car: 'Oreca 07', carSource: 'remembered' });

    const named = drive(true);
    expect(named.manager.session).toMatchObject({ car: 'Demo GT3', carSource: 'game' });

    expect(first.manager.chooseCar('no-such-session', 'Oreca 07')).toBeNull();
  });
});
