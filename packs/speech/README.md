# speech

Enable with `NANO_PACKS=core,vault,speech` and rebuild. Configure speech connections and roles in the vault portal. The pack installs ffmpeg and provides `nano-speech stt <audio-file>` and `nano-speech tts "text" [output.m4a]`. Credentials stay in the vault; the client sends audio bytes or text over its Unix socket. Audio is converted to mono WAV for transcription and AAC for iMessage replies. The vault supports hosted compatible audio endpoints, local Bark/Woof, and custom JSON request/response mappings.

Fallbacks are owner-selected in Models & voice. With none configured, failures are reported without switching services. `NANO_FFMPEG` can name an existing ffmpeg binary. No personal service addresses are shipped with this pack.
