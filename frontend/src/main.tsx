import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initProjects } from './lib/project';
import './index.css';

// Programa desktop: reabre o último projeto antes de montar a tela (camadas e mapa já no lugar).
void initProjects().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
