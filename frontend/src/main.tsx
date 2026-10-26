import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App'; import './styles.css'; import './tailwind.css'; import './styles.polish.css'; createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Service worker registration failed', error));
  });
}
