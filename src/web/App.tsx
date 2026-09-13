import { useEffect, useRef, useState } from 'react';
import { describeDelta, describeTip, formatLapTime } from '../shared/format.ts';
import { ConnectionBadge } from './components/ui.tsx';
import { getLive, useLive } from './lib/live.ts';
import { href, useRoute, type Route } from './lib/router.ts';
import { useSettings } from './lib/settings.ts';
import { CoachView } from './views/CoachView.tsx';
import { CompareView } from './views/CompareView.tsx';
import { LiveView } from './views/LiveView.tsx';
import { SessionsView } from './views/SessionsView.tsx';
import { SessionView } from './views/SessionView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { SetupView } from './views/SetupView.tsx';

type Section = 'live' | 'sessions' | 'compare' | 'coach' | 'setup' | 'settings';

const TITLES: Record<Section, string> = {
  live: 'Live',
  sessions: 'Sessions',
  compare: 'Compare laps',
  coach: 'Coach',
  setup: 'Car setup',
  settings: 'Settings',
};

function sectionOf(route: Route): Section {
  return route.name === 'session' ? 'sessions' : route.name;
}

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'live':
      return <LiveView />;
    case 'sessions':
      return <SessionsView />;
    case 'session':
      return <SessionView id={route.id} />;
    case 'compare':
      return <CompareView route={route} />;
    case 'coach':
      return <CoachView id={route.id} />;
    case 'setup':
      return <SetupView route={route} />;
    case 'settings':
      return <SettingsView />;
  }
}

/** Speaks completed laps to screen readers (politely, never per frame). */
function LapAnnouncer() {
  const lapSerial = useLive((s) => s.lapSerial);
  const { announceLaps, units } = useSettings();
  const [message, setMessage] = useState('');
  useEffect(() => {
    const feedback = getLive().feedback;
    if (!announceLaps || !feedback || lapSerial === 0) return;
    const parts = [`Lap ${feedback.lap} complete, ${formatLapTime(feedback.lapTime)}.`];
    if (feedback.personalBest) parts.push('New session best.');
    else if (feedback.deltaToReference !== null) parts.push(`${describeDelta(feedback.deltaToReference)} than best.`);
    if (!feedback.valid) parts.push('Lap invalidated.');
    if (feedback.tips[0]) parts.push(`Focus: ${describeTip(feedback.tips[0], units).title}.`);
    setMessage(parts.join(' '));
  }, [lapSerial, announceLaps, units]);
  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

export function App() {
  const route = useRoute();
  const section = sectionOf(route);
  const liveSessionId = useLive((s) => s.session?.id ?? null);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = `${TITLES[section]} · AMS2 Coach`;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Move focus to the new page so keyboard and screen reader users land in it.
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route, section]);

  const nav: { section: Section; to: Route }[] = [
    { section: 'live', to: { name: 'live' } },
    { section: 'sessions', to: { name: 'sessions' } },
    { section: 'compare', to: { name: 'compare', session: liveSessionId, lap: null, refSession: null, refLap: null } },
    { section: 'coach', to: { name: 'coach', id: liveSessionId } },
    { section: 'setup', to: { name: 'setup', session: liveSessionId, lap: null, compare: null } },
    { section: 'settings', to: { name: 'settings' } },
  ];

  return (
    <>
      <button type="button" className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>
      <header className="app-header">
        <a className="brand" href={href({ name: 'live' })}>
          <svg viewBox="0 0 64 64" aria-hidden="true" className="brand-mark">
            <path d="M8 46c9-20 18-26 27-19s13 2 21-9" fill="none" stroke="var(--reference)" strokeWidth="6" strokeLinecap="round" />
            <path d="M8 52c9-15 18-20 27-13s13 0 21-10" fill="none" stroke="var(--lap)" strokeWidth="6" strokeLinecap="round" />
          </svg>
          <span>AMS2 Coach</span>
        </a>
        <nav aria-label="Main">
          <ul className="nav">
            {nav.map((item) => (
              <li key={item.section}>
                <a href={href(item.to)} aria-current={section === item.section ? 'page' : undefined}>
                  {TITLES[item.section]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="header-status">
          <ConnectionBadge />
        </div>
      </header>
      <main ref={mainRef} tabIndex={-1} className="app-main" aria-label={TITLES[section]}>
        <View route={route} />
      </main>
      <LapAnnouncer />
    </>
  );
}
