import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';              // <-- this must be here
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
