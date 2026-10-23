import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyTheme, loadThemePref } from './theme';

// Avant le premier rendu : pas de flash clair en mode sombre
applyTheme(loadThemePref());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
