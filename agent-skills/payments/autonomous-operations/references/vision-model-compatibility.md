# Vision Model Compatibility on OpenRouter

## The Problem

Not all models listed as "multimodal" on OpenRouter actually accept the OpenAI-format `image_url` messages that Hermes sends. When a vision model rejects the image format, the call fails silently and Hermes falls back to **"auto" vision backends** — which can route to any provider including models you explicitly wanted to avoid.

## The Footgun: Gemma 4 26B

**`google/gemma-4-26b-a4b-it`** — Listed on OpenRouter as `text+image+video->text` but **rejects OpenAI-format image messages**:

```
Error code: 400 — unknown variant `image_url`, expected `text`
```

Despite OpenRouter's modality claim, Gemma 4 on OpenRouter does NOT accept `image_url` type messages (it expects images via a different format). Every vision call fails, Hermes falls back to auto backends, and credits burn silently on the fallback path.

### How to Detect This

1. Check gateway logs: `grep -i 'image_url\|vision\|gemini' /tmp/hermes_gateway.log`
2. Look for `image_url` format errors — these indicate the model doesn't accept standard multimodal input
3. Check for fallback warnings: `grep 'falling back to auto' ~/.hermes/logs/errors.log`
4. **Session-file analysis for model leaks** — scan sessions for OpenRouter or Gemini references:
   ```python
   import json, os
   session_dir = os.path.expanduser("~/.hermes/sessions/")
   for f in os.listdir(session_dir):
       if not f.endswith('.json'): continue
       with open(os.path.join(session_dir, f)) as fh:
           data = json.load(fh)
       msgs_str = str(data.get("messages", []))
       has_or = "openrouter" in msgs_str.lower()
       has_gemini = "gemini" in msgs_str.lower()
       if has_gemini:
           print(f"GEMINI LEAK: {f}")
   ```
   Sessions with "gemini" in their message content indicate the fallback is active. Count them to estimate bleed rate.
5. Cross-reference with actual OpenRouter usage: if you see Gemini charges but your config says Gemma (or Qwen), the fallback is active.

## Known-Working Vision Models (OpenRouter, May 2026)

Cheapest models that accept OpenAI-format `image_url` messages.

**Confirmed working in our deployment:**
| Model ID | Price/M input | Context | Confirmed |
|---|---|---|---|
| `qwen/qwen3-vl-8b-instruct` | $0.08 | 131K | ✅ May 2026 — deployed and verified |

**Likely compatible (not yet confirmed in our deployment):**
| Model ID | Price/M input | Context | Notes |
|---|---|---|---|
| `google/gemma-3-12b-it` | $0.04 | 131K | Gemma 3 is a different API surface than Gemma 4 — may work |
| `google/gemma-3-27b-it` | $0.08 | 131K | Larger Gemma 3 |
| `meta-llama/llama-4-scout` | $0.08 | 327K | Largest context window |
| `mistralai/mistral-small-3.2-24b-instruct` | $0.075 | 128K | Solid generalist |

⚠️ **Unconfirmed models may have the same `image_url` format rejection as Gemma 4.** Always verify with the checklist below before trusting a model. Only the "Confirmed working" table represents models we've actually tested in production.

All prices as of May 2026. All cheaper than Gemini 2.5 Flash ($0.15/M).

## Verification Checklist

When switching vision models:

1. **Update config**: `hermes config set auxiliary.vision.model <model_id>`
2. **Verify it loads**: Send an image in chat and confirm `vision_analyze` succeeds
3. **Check gateway logs** for 400 errors — any `image_url` format errors mean the model is incompatible
4. **Check errors.log** for fallback warnings — "falling back to auto" means your new model isn't being used
5. **Monitor OpenRouter dashboard** for 24h to confirm the new model is generating charges (not some fallback model)

## The Fallback Chain

When `vision_analyze` is called:

1. Hermes tries the configured `auxiliary.vision.model` via `auxiliary.vision.provider`
2. **If that fails** (400, 403, timeout): Hermes logs "Vision provider <X> unavailable, falling back to auto vision backends"
3. Auto backends pick from available providers — this can be **any model** including ones you're actively trying to avoid
4. The failed call is still a billable API hit (the 400 error response is charged by OpenRouter)

**Key insight**: You're billed for the failed call AND the fallback call. A broken vision config doubles your vision costs while silently routing through unwanted models.
