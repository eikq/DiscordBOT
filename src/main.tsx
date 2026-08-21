import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import JarvisLabPage from './jarvis/ui/JarvisLabPage.tsx';
import JarvisPresencePage from './jarvis/ui/presence/JarvisPresencePage.tsx';
import { isControlCenterPath, isPresencePath } from './jarvis/ui/presence/presenceRuntime';
import './index.css';

const pathname = window.location.pathname;
const isControlCenter = isControlCenterPath(pathname);
const isPresence = isPresencePath(pathname);

createRoot(document.getElementById('root')!).render(
    <StrictMode>
    {isControlCenter ? <JarvisLabPage /> : isPresence ? <JarvisPresencePage /> : <App />}
    </StrictMode>,
);
