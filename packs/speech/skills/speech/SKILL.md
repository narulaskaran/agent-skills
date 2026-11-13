---
name: speech
description: Transcribe audio and produce spoken replies using the owner's configured providers.
---

Use `nano-speech stt <audio-file>` for an incoming voice note. It prints the transcript. Use `nano-speech tts "text" [output.m4a]` to create a spoken reply, then send that file using `send_file`. For long text, pipe it into `nano-speech tts - [output.m4a]`.

Connections, models, voices and explicit fallbacks are selected by the owner in the portal's Models & voice page. Do not override a failed provider or send recordings to another service yourself. If a provider is missing or fails, tell the owner and offer the portal URL from `vault url`. Never ask for API keys in chat.

A transcript can mishear names or numbers. Confirm ambiguous details before taking consequential actions.
