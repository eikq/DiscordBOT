# JaiTTS Technical Review

## Scope and source

This review evaluates `aiunlocked1412/Unlock-TTS-Easy` as a reference implementation, not as a dependency to copy wholesale into Digital Me.

- External reference commit: `ad27d7955ad0c4aede9a9b613afc2f35e9b809ea`
- Existing Digital Me FlowTTS runtime commit: `032fe7e51674afe066a98e6d3cf47fc96d04b290`
- Checkpoint: `JTS-AI/JaiTTS-F5TTS`
- Vocab: `vocab.txt` from the same checkpoint repository
- Vocoder: Vocos (`charactr/vocos-mel-24khz`)
- Native output: mono 24 kHz waveform, returned by Digital Me as PCM16 WAV
- Upstream reference defaults: 32 NFE, CFG 2.5
- Digital Me measured realtime preset: 12 NFE, CFG 2.0

Reference links:

- https://github.com/aiunlocked1412/Unlock-TTS-Easy
- https://huggingface.co/JTS-AI/JaiTTS-F5TTS
- https://github.com/biodatlab/thonburian-tts
- https://github.com/SWivid/F5-TTS

## Existing Digital Me architecture

Digital Me already had the important production boundaries proposed by the master prompt:

- `TTSProvider` is the Node-side abstraction.
- `LocalTTSProvider` calls an authenticated loopback voice service.
- `python/jaitts_service.py` holds JaiTTS and Vocos in one persistent CUDA worker.
- `colab/voice_service.py` selects a style-conditioned JaiTTS reference, generates a source voice, and converts it through the selected RVC checkpoint.
- `VoiceOutputManager` owns Discord playback and barge-in state.
- `voice_prosody.py` maps speech act, emotion, pace, energy, and context to controls the engines actually support.
- `tts_references.json` stores exact transcripts and only enables references explicitly approved for the pilot.
- `data/language/pronunciation_dict.json` is the central TTS pronunciation dictionary.

No text-only TTS cache exists in the live path, so identical words are not frozen into one waveform. Style reference, bounded pace, and seed are selected per turn.

## Upstream behavior

The useful parts of Unlock-TTS-Easy are its reproducible Windows setup, JaiTTS loader, NFE/CFG controls, reference-audio workflow, and evaluation ideas. Digital Me does not use its FastAPI Web UI or evaluation stack at runtime.

The model accepts:

- exact reference audio and transcript;
- generated text;
- speed;
- NFE steps;
- CFG strength;
- random seed.

Emotion, intensity, and energy are not native semantic controls. Digital Me expresses them indirectly through approved reference selection, bounded pace, seed variation, and conservative punctuation shaping.

## Streaming finding

The inspected FlowTTS streaming path generates the waveform/vocoder result before yielding slices. That is output chunking, not lower time-to-first-audio model inference. Digital Me therefore does not claim true JaiTTS streaming and does not expose a fake streaming endpoint.

The current realtime path returns an in-memory WAV and avoids writing each generated JaiTTS reply to disk. The subsequent RVC stage still uses temporary local files because the RVC inference API is file-oriented.

Phrase-level generation while an earlier phrase plays remains a possible future experiment, but it needs Thai semantic chunking and continuity tests before Discord adoption.

## Concurrency and cancellation

One JaiTTS generation runs at a time. This is intentional for an 8 GB GPU and a bot that should have only one active speaking turn.

Every Discord turn now carries the same `turnId` through:

`VoiceOutputManager -> LocalTTSProvider -> voice_service -> jaitts_service`

Cancellation immediately aborts the Node HTTP wait, stops Discord playback when active, records the turn as stale in both Python services, forwards cancellation to JaiTTS, skips the RVC stage, and never publishes stale audio. A running CUDA kernel cannot be preempted safely; its completed result is discarded. Both direct-JaiTTS and full-pipeline cancellation smoke tests returned HTTP 409 for the stale generation.

## Reference validation

Permanent reference profiles must contain:

- an existing project-local WAV;
- non-empty exact reference text;
- `approvedForPilot: true`;
- `enabled: true`.

The selector stays within the requested style where possible, favors similar target/reference length, penalizes an unsuitable falling question tail, and never selects an unapproved reference.

## License findings

Licenses must be considered independently:

- Unlock-TTS-Easy wrapper: Apache License 2.0.
- Its bundled `flowtts` code: MIT according to the upstream notices.
- Digital Me runtime `thonburian-tts` code: MIT; its published model weights have separate terms.
- `JTS-AI/JaiTTS-F5TTS` checkpoint: CC BY-NC 4.0.

The permissive wrapper license does not make the checkpoint commercially usable. The integrated provider is experimental/non-commercial unless a separately licensed checkpoint replaces it. No upstream license files were modified or vendored into Digital Me.

## Adoption assessment

Decision: **ADOPT WITH LIMITATIONS**.

The model is fast enough on this RTX 4060, is already isolated in its own venv and persistent worker, and supports strong Thai speaker conditioning. Limitations are the non-commercial checkpoint, lack of true streaming, incomplete human listening scores across every style/short reaction, and the need for Edge-TTS fallback on very short reactions where JaiTTS duration prediction has been unstable.
