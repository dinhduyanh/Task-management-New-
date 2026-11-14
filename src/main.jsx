import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, getInitialTheme } from './theme/theme';
import './index.css';
import './theme/palette.css';
import './theme.css';

// Apply the saved theme before the first render so the page never flashes light.
applyTheme(getInitialTheme());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
