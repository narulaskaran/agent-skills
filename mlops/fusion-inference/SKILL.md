---
name: fusion-inference
description: "Quality boost via parallel model panels + judge synthesis. Run a prompt against multiple models, then fuse the best of each into one answer."
version: 2.0.0
---

# Fusion Inference (Parallel Panel + Judge Synthesis)

Run a prompt against multiple models in parallel, then have a judge model synthesize the responses into one final answer. The key insight: model diversity beats individual model quality — even running the same model with different temps can outperform a single run.

Works with **any OpenAI-compatible API** (Ollama, DeepSeek, OpenAI, Anthropic, Together, OpenRouter, etc.).

## When to Use

- Tasks where **quality > speed**: kanban decomposition, weekly synthesis, code review, architecture decisions, planning
- **Parallel-friendly** setups: multi-GPU, fast CPU, or API-based models
- **Do NOT use for**: triage, title gen, compression, real-time chat, simple classification

## Pipeline

```
                 ┌─────────────────┐
                 │     Prompt      │
                 └────────┬────────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ Model A  │  │ Model B  │  │ Model C  │  ← Panel (parallel)
     └────┬─────┘  └────┬─────┘  └────┬─────┘
          │             │             │
          └─────────────┼─────────────┘
                        ▼
               ┌────────────────┐
               │  Judge (fuse)  │  ← Any model
               └───────┬────────┘
                       ▼
              ┌────────────────┐
              │ Fused response │
              └────────────────┘
```

## Setup

Requires Python 3.10+. Only stdlib needed — `urllib.request` + `concurrent.futures`.

```bash
# No extra dependencies required
python3 fusion.py "your prompt"
```

Or install `aiohttp` for faster parallel requests on large panels:

```bash
pip install aiohttp
```

## Configuration

Edit the config section at the top of `fusion.py`:

```python
# --- Provider Config ---
# Each provider needs a base URL, API key, and model name.
# Models can all use the same provider or different ones.

# Panel models (run in parallel)
PANEL_BASE = "http://localhost:11434/v1"       # base URL for panel models
PANEL_API_KEY = "ollama"                        # API key

# Judge model (synthesizes panel responses)
JUDGE_BASE = "https://api.openai.com/v1"
JUDGE_API_KEY = os.environ.get("OPENAI_API_KEY", "")
JUDGE_MODEL = "gpt-4o-mini"

# Default panel — models run in parallel
DEFAULT_PANEL = [
    {"model": "model-name-1", "name": "label1"},
    {"model": "model-name-2", "name": "label2"},
]
```

## Usage

```bash
# Default panel + judge
python3 fusion.py "Write a Python script to analyze CSV files"

# Custom panel — comma-separated model:name pairs
python3 fusion.py "Explain quantum entanglement" --panel "gpt-4o:gpt4,claude-3-sonnet:sonnet"

# Local judge — uses first panel model to synthesize (no API key needed)
python3 fusion.py "Hello world" --local

# Raw JSON output
python3 fusion.py "Analyze this" --no-format
```

### Simple CLI Wrapper

Drop this at `/usr/local/bin/fusion` for convenience:

```bash
#!/bin/bash
python3 /path/to/fusion.py "$@"
```

```bash
chmod +x /usr/local/bin/fusion
fusion "your prompt" --panel "model1:name1,model2:name2"
```

## Flags

| Flag | Description |
|------|-------------|
| `--panel` | Comma-separated `model:name` pairs (e.g. `gpt-4o:gpt4,claude-sonnet:sonnet`) |
| `--local` | Skip external judge API, use first panel model as judge |
| `--no-format` | Output raw JSON (for piping into other tools) |

## How It Works

1. All panel models run in **parallel** via `asyncio` / `ThreadPoolExecutor`
2. Judge considers all responses, picks the strongest, synthesizes improvements
3. Returns a single final answer with a timing summary

## Choosing Panel + Judge

**Panel diversity > panel size.** 2 diverse models beat 3 similar ones.

| Panel Strategy | Example | Best For |
|---|---|---|
| Reasoning + Knowledge | R1-like + coder-like | Complex logic + factual answers |
| Language + Code | GPT + Claude | Mixed tasks |
| High + Low temp | Same model at 0.3 + 0.7 | Exploring solution space |
| Cheap + Capable | Small fast + large slow | Latency/quality tradeoff |

**Judge should be competent.** A weak judge can degrade panel output. Use your best model for the judge role. If using local models, pick the largest one.

## Pitfalls

- **Token cost**: Panel x judge uses ~3x the tokens of a single call. Worth it for important answers, wasteful for trivial ones.
- **Latency**: Total = slowest panel model + judge time. A fast model finishing first doesn't help you.
- **Diminishing returns**: 3+ panel models rarely beat 2 good ones. The judge handles synthesis well with just 2 diverse perspectives.
- **Small models add noise, not signal.** A tiny model in a fusion panel produces hallucinated facts. The judge may surface these as "unique insights" instead of filtering them. Stick to models that produce genuinely useful output.
- **Provider mismatch**: If panel and judge are on different providers, network latency to the slower one becomes the bottleneck.
- **Model diversity matters more than individual quality.** A panel of 3 budget models from different families often beats one frontier model. Pick models with different training data (Llama + Qwen + Gemma).
- **Self-fusion works**: If you only have one model, run it 3x at temperatures 0.3, 0.7, 1.0 and fuse — OpenRouter's data shows this outperforms single runs.
