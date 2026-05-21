import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Complete progress bar then fade out splash after React mounts
const bar = document.getElementById('splash-bar') as HTMLElement | null;
const splash = document.getElementById('splash') as HTMLElement | null;

if (bar) {
  bar.style.transition = 'width 0.3s ease';
  bar.style.width = '100%';
}

setTimeout(() => {
  if (splash) {
    splash.style.transition = 'opacity 0.45s ease';
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 450);
  }
}, 350);
