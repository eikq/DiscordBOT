# Digital Me — Public Demo

Consent-safe public sandbox for the Digital Me Thai-English Discord AI companion.

The public build demonstrates the interaction loop—input, transcript, intent,
memory selection, response, and browser speech—without exposing Discord tokens,
raw recordings, private memories, RVC weights, or a training endpoint.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

On Windows PowerShell, run the equivalent directly because the deployment
scripts use POSIX-style environment assignment:

```powershell
$env:WRANGLER_LOG_PATH='.wrangler/wrangler.log'
npx vinext dev
```

## Checks

```bash
npm run lint
npm test
```

## Privacy boundary

- The microphone path uses the browser's speech recognition capability.
- The public site does not upload audio for model training.
- Speech playback uses a browser safety voice, not a real person's cloned voice.
- The private local application contains the GPU-backed STT, memory, JaiTTS,
  and RVC pipeline used in the recorded hackathon demo.
