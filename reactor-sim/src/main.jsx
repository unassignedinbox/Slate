import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/editor-base.css';
import './ui/app.css';
import App from './App.jsx';

createRoot(document.getElementById('Editor')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
