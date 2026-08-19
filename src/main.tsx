import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import JarvisLabPage from './jarvis/ui/JarvisLabPage.tsx';
import './index.css';

const isJarvisLab = window.location.pathname.startsWith('/jarvis-lab');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isJarvisLab ? <JarvisLabPage /> : <App />}
  </StrictMode>,
);
