# Piper Voice Catalog — en_US

Full listing from HuggingFace `rhasspy/piper-voices` as of June 2026.

Voice naming: `en_US-{name}-{quality}`
Quality levels: `low` (fastest, smallest), `medium` (balanced), `high` (best quality, larger model)

## Male voices

| Voice | Qualities | Character |
|---|---|---|
| lessac | low, medium, high | Natural, warm male (default) |
| ryan | low, medium, high | Deep, broadcast-style |
| danny | low | Young male |
| joe | medium | Casual male |
| bryce | medium | Male |
| john | medium | Male |
| sam | medium | Male |
| norman | medium | Older male |
| kusal | medium | Male |
| hfc_male | medium | Male |
| ljspeech | medium, high | Clean male |
| libritts | high | Multi-speaker male |
| reza_ibrahim | medium | Male |

## Female voices

| Voice | Qualities | Character |
|---|---|---|
| amy | low, medium | Female, warm |
| kristin | medium | Female, bright/clear |
| kathleen | low | Female |
| hfc_female | medium | Female, crisp/professional |
| arctic | medium | Female, softer/rounded |
| l2arctic | medium | Female, slightly accented |
| libritts_r | medium | Multi-speaker female |

## Model sizes (approximate)

| Quality | Size | Synth speed |
|---|---|---|
| low | ~60MB | ~0.3s |
| medium | ~63MB | ~0.3-0.4s |
| high | ~115MB | ~1.1s |

Example voice: `hfc_female-medium` at `length_scale=0.57` (1.75x speed)
