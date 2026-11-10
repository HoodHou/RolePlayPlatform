import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/story.css';
import './styles/world.css';
import './styles/dialogs.css';
import './styles/library.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
