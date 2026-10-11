import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './ui/styles.css';

// StrictMode is deliberately not used: the WebGPU stage is created once per canvas.
createRoot(document.getElementById('root')).render(<App />);
