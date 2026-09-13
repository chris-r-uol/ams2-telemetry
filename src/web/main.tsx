import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { App } from './App.tsx';
import { connectLive } from './lib/live.ts';
import { applyDocumentSettings } from './lib/settings.ts';

applyDocumentSettings();
connectLive();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
