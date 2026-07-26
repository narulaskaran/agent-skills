---
name: tts-configuration
description: Configure Hermes TTS — switch providers, tune Piper voices, set speed/length_scale, discover voices.
---

# TTS Configuration

Configure and tune Hermes text-to-speech: provider selection, voice discovery, speed/length tuning, and platform delivery.

## Trigger

- User asks about TTS voices, speed, or quality
- User wants to switch TTS providers
- User asks "how do I make the voice faster/slower/different"

## Providers

| Provider | Type | Key needed | Notes |
|---|---|---|---|
| `edge` | Cloud (free) | No | Microsoft Edge TTS, default |
| `piper` | Local (free) | No | Neural VITS, 44 languages |
| `elevenlabs` | Cloud (paid) | Yes | Premium quality |
| `openai` | Cloud (paid) | Yes | gpt-4o-mini-tts |
| `xai` | Cloud (paid) | Yes | eve voice |
| `mistral` | Cloud (paid) | Yes | voxtral-mini |
| `neutts` | Local (free) | No | Neuphonic GGUF |
| `piper` (command) | Local (free) | No | Shell command mode |

**Switch provider:** `hermes config set tts.provider <name>`

## Piper (local, free)

The go-to for zero-cost, zero-network TTS.

### Configuration keys

All under `tts.piper` in config.yaml:

| Key | Default | Purpose |
|---|---|---|
| `voice` | `en_US-lessac-medium` | Voice model name |
| `length_scale` | `1.0` | Speed: lower = faster (0.57 ≈ 1.75x) |
| `noise_scale` | `0.667` | Voice variation |
| `noise_w_scale` | `0.8` | Phoneme duration variation |
| `volume` | `1.0` | Output volume multiplier |
| `normalize_audio` | `true` | Peak normalization |
| `use_cuda` | `false` | GPU acceleration |
| `voices_dir` | `~/.hermes/cache/piper-voices/` | Model storage |

```bash
hermes config set tts.piper.voice en_US-ryan-high
hermes config set tts.piper.length_scale 0.57   # 1.75x speed
hermes config set tts.piper.volume 1.2
```

### Voice discovery

Piper voices live on HuggingFace: `rhasspy/piper-voices`

List all English voices:
```python
import urllib.request, json
url = 'https://huggingface.co/api/models/rhasspy/piper-voices'
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())
    siblings = data.get('siblings', [])
    en_voices = [s['rfilename'] for s in siblings
                 if s['rfilename'].startswith('en/en_US/')
                 and s['rfilename'].endswith('.onnx')]
    for v in sorted(en_voices):
        print(v)
```

Voice naming: `en_US-{name}-{quality}` where quality is `low`/`medium`/`high`.
Higher quality = larger model, slightly slower synthesis.

### Voice download and test

Models must be downloaded before use. Hermes auto-downloads via `piper.download_voices`, but manual download is faster for testing:

```python
import urllib.request, os

model_dir = os.path.expanduser('~/.hermes/cache/piper-voices')
voice = 'en_US-ryan-high'
parts = voice.split('-')  # ['en', 'US', 'ryan', 'high']
url = f'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/{parts[2]}/{parts[3]}/{voice}.onnx'

path = os.path.join(model_dir, f'{voice}.onnx')
urllib.request.urlretrieve(url, path)
urllib.request.urlretrieve(url + '.json', path + '.json')  # config required

# Test
from piper import PiperVoice, SynthesisConfig
voice = PiperVoice.load(path)
config = SynthesisConfig(length_scale=0.57)  # optional speed
chunks = list(voice.synthesize("Test text.", config))
audio = b''.join(c.audio_int16_bytes for c in chunks)
```

### Quick-adjust speed

Change speed without touching voice:
```bash
hermes config set tts.piper.length_scale 0.57   # 1.75x
hermes config set tts.piper.length_scale 1.0    # back to normal
```

Speed ratio: `length_scale = 1.0 / speed_multiplier`
- 1.25x → 0.8
- 1.5x → 0.667
- 1.75x → 0.57
- 2.0x → 0.5

## Pitfalls

- **Missing config JSON**: Piper requires both `.onnx` AND `.onnx.json` files. If `FileNotFoundError` for `.onnx.json`, download the config file from the same URL + `.json`.
- **Model load is slow (2-4s)**: First synthesis after gateway start pays a one-time model load cost. Hermes caches loaded voices in `_piper_voice_cache`.
- **Wrong voice path**: Hermes looks in `~/.hermes/cache/piper-voices/`, not `~/.hermes/piper_models/`. Use `hermes config set tts.piper.voices_dir` to override.
- **length_scale needs float**: `hermes config set tts.piper.length_scale 0.57` — Hermes casts to float, but ensure it's a number not a string.
- **Edge TTS needs network**: The default `edge` provider makes an HTTP request per synthesis. Piper eliminates this latency.

## Platform delivery

- **CLI/Discord text**: Audio sent as attachment (MP3 for cloud providers, WAV-converted for Piper)
- **Discord voice channel**: TTS spoken directly in VC (requires additional setup — see voice-mode docs)
- **Telegram**: Native voice messages when provider is compatible
