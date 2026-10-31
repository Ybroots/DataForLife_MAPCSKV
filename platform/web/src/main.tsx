import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ScreenErrorBoundary } from './components/ScreenErrorBoundary';
import './styles.css';
import './product.css';
import './components/map-assistant.css';
import { initializeNativeApp } from './native-app';

initializeNativeApp();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ScreenErrorBoundary><App /></ScreenErrorBoundary>
  </StrictMode>,
);
