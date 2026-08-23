import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import JarvisLabPage from './jarvis/ui/JarvisLabPage.tsx';
import JarvisPresencePage from './jarvis/ui/presence/JarvisPresencePage.tsx';
import JarvisSetupPage from './jarvis/ui/setup/JarvisSetupPage.tsx';
import { isControlCenterPath, isPresencePath, isSetupPath } from './jarvis/ui/presence/presenceRuntime';
import './index.css';

const pathname = window.location.pathname;
const isControlCenter = isControlCenterPath(pathname);
const isPresence = isPresencePath(pathname);
const isSetup = isSetupPath(pathname);

createRoot(document.getElementById('root')!).render(
    <StrictMode>
    {isSetup ? <JarvisSetupPage /> : isControlCenter ? <JarvisLabPage /> : isPresence ? <JarvisPresencePage /> : <App />}
    </StrictMode>,
);
