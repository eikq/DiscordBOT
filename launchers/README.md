# One-click JARVIS launchers

Repo copies live here. Desktop copies are created by `install-desktop-shortcuts.cmd`.

| Edition | Desktop folder | Start | Stop | URL |
|---|---|---|---|---|
| Owner | `Desktop\JARVIS\Owner Edition` | `1 Start Owner JARVIS.lnk` | `2 Stop Owner JARVIS.lnk` | http://127.0.0.1:3010/jarvis |
| Community | `Desktop\JARVIS\Community Edition` | `1 Start Community JARVIS.lnk` | `2 Stop Community JARVIS.lnk` | http://127.0.0.1:3012/jarvis |

Start will:

1. Check Node.js
2. Offer `npm ci` only if `node_modules` is missing (asks Y/N)
3. Start Qwen llama.cpp on `:8086` (`qwen38-cyber`) if it is not already up; only then fall back to Ollama `:11434`
4. Start that edition’s Jarvis in its own window
5. Open the browser

Stop only ends that edition’s Jarvis process. It does not stop Ollama or llama.cpp.

Owner uses `data\jarvis\`. Community uses `data\community\`. Do not mix the shortcuts.
