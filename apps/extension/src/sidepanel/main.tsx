import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/atkinson-hyperlegible-next';
import './styles.css';
import { App } from './App';
import { chromeApi } from './api';

const container = document.getElementById('root');
if (!container) throw new Error('#root introuvable dans sidepanel.html');

createRoot(container).render(
  <StrictMode>
    <App api={chromeApi} />
  </StrictMode>,
);
