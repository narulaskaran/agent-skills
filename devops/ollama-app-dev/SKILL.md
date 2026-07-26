---
name: ollama-app-dev
description: "Build local apps that use Ollama for inference. Model selection, warm-up, timeout handling, date hallucination fixes, and fallback patterns."
---

# Ollama Local App Development

Patterns for building local apps (FastAPI, scripts, tools) that call Ollama for text/image inference.

## Model Selection

| Model | Size | Speed | Best For | Notes |
|---|---|---|---|---|
| `phi4-mini-16k` | 3.8B | ~35 tok/s, ~2s first response | JSON extraction, classification, simple parsing | Cold start: near-instant |
| `qwen3.6-35b-a3b-64k` | 35B MoE | ~27 tok/s, ~3-5m first response | Complex reasoning, vision, tool-calling | Cold start: minutes to load into GPU |

**Rule: phi4-mini first for structured extraction.** For tasks like JSON parsing, classification, food entry extraction, and simple NLP — phi4-mini is fast and accurate enough. Use qwen only when the task genuinely needs reasoning or vision.

**phi4-mini quality caveat:** phi4-mini underestimates multi-item entries ("2 beers and a slice of pizza" → 220 cal vs realistic ~520). Single-item parsing is reliable; multi-item descriptions produce inconsistent estimates. For calorie-sensitive apps, accept this as a tradeoff for speed, or route multi-item entries to qwen.

### phi4-mini Prompt Engineering

phi4-mini (3.8B) is fast but literal — it has distinct failure modes requiring specific prompt patterns:

**1. Template placeholder copying.** If the prompt's example JSON contains descriptive placeholders like `"calories": estimated_calories_as_int` or `"food_name": "what was eaten"`, phi4-mini copies those strings verbatim into output instead of replacing them. It treats placeholders as literal values, not instructions.

Fix: use numeric `0` placeholders, then instruct "replace EVERY 0 with a real number":
```
Bad:  {"calories": estimated_calories_as_int, "food_name": "what was eaten"}
Good: {"calories":0, "meal_time":"2026-07-04T00:00"}
      + "Replace 0 with your estimate. Replace T00:00 with actual time."
```

**2. Returns arrays for multi-item `food_name`.** For "tortellini bolognese and rigatoni with bread", phi4-mini returns `["tortellini bolognese", "rigatoni", "bread"]` despite being told "ONE string." Fix in validation:
```python
fn = result["food_name"]
if isinstance(fn, list):
    fn = ", ".join(str(x) for x in fn)
```

**3. Returns `null` for uncertain fields.** phi4-mini outputs `null` (not `0`) for fields it's unsure about — especially fiber. `int(None)` → TypeError. Fix with None-safe coercion:
```python
def _int(v):
    if v is None:
        return 0
    return int(v)
```
Apply to ALL numeric fields from phi4-mini output.

## Warm-Up Pattern

Always preload the model on server startup to avoid cold-start latency on first user request:

```python
async def warm_up() -> None:
    """Send a minimal request to preload the model. Best-effort."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.post(
                f"{OLLAMA_URL}/v1/chat/completions",
                json={
                    "model": MODEL,
                    "messages": [{"role": "user", "content": "."}],
                    "max_tokens": 1,
                    "temperature": 0,
                },
            )
        logger.info("Warm-up sent to %s", MODEL)
    except Exception as e:
        logger.warning("Warm-up skipped (model may load on first request): %s", e)
```

**Critical:** warm-up timeout must be generous (30s+) for qwen. phi4-mini can use 10s. If warm-up times out, the model loads on first user request — warn the user about potential delay.

## Date Hallucination Fix

ALL Ollama models hallucinate wrong years (2023, 2024) because their training cutoff predates the current date. Even when the prompt explicitly states today's date, the model may override it with a stale year.

**Always post-process dates from LLM output:**

```python
import re
from datetime import datetime

def fix_year(date_str: str) -> str:
    """Replace stale years with current year."""
    now = datetime.now()
    m = re.search(r'(\d{4})-\d{2}-\d{2}', date_str)
    if m:
        yr = int(m.group(1))
        if yr < 2024:  # training cutoff zone
            date_str = date_str.replace(m.group(1), str(now.year), 1)
    return date_str
```

Call this on EVERY date field returned by the model — meal_time, created_at, etc.

### Time Format Normalization

Models produce multiple time format variants that silently break SQLite `date()` and `datetime()`. Normalize in `_validate()` before storing:

```python
import re

def normalize_time(date_str: str) -> str:
    """Fix common LLM time format errors before DB storage."""
    # 1. Strip timezone suffix (+02:00, -05:00, Z)
    s = re.sub(r'[+-]\d{2}:\d{2}$', '', date_str).rstrip('Z')
    # 2. Insert missing colon: T0900 → T09:00, T1730 → T17:30
    s = re.sub(r'T(\d{2})(\d{2})$', r'T\1:\2', s)
    return s
```

Three failure modes this catches:

| Input | Problem | SQLite `date()` result |
|---|---|---|
| `2026-07-05T0900` | phi4-mini drops colon | **NULL** — WHERE silently fails |
| `2026-07-05T09:00+02:00` | model appends TZ | NULL |
| `2024-06-15T09:30` | stale year (handled by `fix_year()`) | wrong date matches |

**The colon case is the sneakiest:** POST succeeds (INSERT stores the string as-is), but GET returns `[]` because `WHERE date(meal_time) = '2026-07-05'` never matches NULL. The entry exists in the DB but is invisible to queries. Always test GET after POST when debugging submission failures — if POST returns 201 but GET returns empty array, this is the cause.

Apply `normalize_time()` + `fix_year()` to EVERY datetime field returned by the model before storing in DB.

## Timeout Handling

Layer timeouts at both the httpx client AND the app level:

```python
# httpx timeout: how long to wait for the model to respond
async with httpx.AsyncClient(timeout=120.0) as client:
    resp = await client.post(url, json=payload)
    resp.raise_for_status()

# App-level: catch timeout and surface a useful message
except httpx.TimeoutException:
    raise Exception("Ollama timed out. Model may still be loading — retry in a moment.")
```

**Timeout values:**
- phi4-mini: 30s (generous, rarely needed)
- qwen (warm): 60s
- qwen (cold start): 180s+ — better to preload with warm-up

## Fallback Pattern

When the primary model fails (timeout, 404, OOM), degrade gracefully:

```python
async def parse_text(text: str) -> dict:
    try:
        return await _call_model(PRIMARY_MODEL, text, timeout=120)
    except (httpx.TimeoutException, httpx.HTTPStatusError) as e:
        logger.warning("Primary model %s failed: %s. Falling back.", PRIMARY_MODEL, e)
        try:
            return await _call_model(FALLBACK_MODEL, text, timeout=30)
        except Exception:
            raise
```

## Vision Parsing

For food photo analysis or any image→text task, pass base64-encoded images:

```python
import base64

b64 = base64.b64encode(image_bytes).decode()
messages = [{
    "role": "user",
    "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        {"type": "text", "text": "Describe this image..."},
    ],
}]
```

Requires a vision-capable model (qwen3.6-35b-a3b-64k). phi4-mini does NOT support vision.

## JSON Extraction from LLM Output

Models often wrap JSON in markdown fences or add explanatory text. Always strip and extract:

```python
def extract_json(content: str) -> dict:
    content = content.strip()
    # Strip markdown fences
    if content.startswith("```"):
        lines = content.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()
    # Try direct parse
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    # Try regex extraction
    match = re.search(r"\{[^{}]*\}", content, re.DOTALL)
    if match:
        return json.loads(match.group())
    raise ValueError(f"Could not extract JSON: {content[:300]}")
```

## Pitfalls

1. **Cold start can take minutes.** qwen3.6-35b is a 24GB model. First load into GPU memory takes 3-5 minutes. The Ollama `/v1/chat/completions` endpoint blocks until the model is loaded. Always warm up on server start; set realistic HTTP timeouts.

2. **phi4-mini doesn't do vision.** If your app needs image analysis, you MUST use qwen (or another vision model). phi4-mini silently ignores image content in messages.

3. **Training cutoff years are injected into output.** Even with explicit date instructions, models produce 2023/2024 dates. Always post-process with `fix_year()`.

4. **Warm-up timeout vs actual load time.** A 15s warm-up timeout is too short for qwen (needs 3-5 min). Set warm-up timeout to 30s for send-only (non-blocking preload), then accept that first real request may take 2-3 min.

5. **Kanban coder interference in shared dirs.** If the app lives in a directory with open kanban coder tasks, the coder will overwrite files with incompatible code. Archive coder tasks before manual development, or use isolated worktree workspaces. See `kanban-workflow` pitfall #20.

6. **PEP 668 on modern Python.** `pip install` outside a venv is blocked. Always create a venv: `python3 -m venv .venv && .venv/bin/pip install ...`

7. **`fastapi run` vs `uvicorn`.** Use `uvicorn.run(app, host="0.0.0.0", port=XXXX)` in `__main__` for explicit control. The `fastapi run` CLI has different defaults.

8. **FastAPI `app.mount("/", StaticFiles(...))` must go AFTER all API routes.** FastAPI matches routes in registration order. If static mount is registered before `/api/entries`, all requests get routed to static files and API endpoints return 404. Always define API routes first, mount static last.

9. **Docker `network_mode: host` gives access to the host's Tailscale interface.** When running inside a Docker container with `network_mode: host`, the container shares the host's network namespace — including `tailscale0`. Bind your app to `0.0.0.0` and it's reachable on the host's Tailscale IP/hostname (e.g., `http://<tailscale-hostname>:8084`). No need to install Tailscale inside the container. Use `hostname` to find the machine's Tailscale name for the URL. Public IP is usually firewalled; Tailscale is the path.

10. **phi4-mini returns zeros for unfamiliar food items.** For restaurant names, food trucks, and branded items phi4-mini doesn't recognize, it returns `calories: 0, protein: 0, fiber: 0` rather than attempting an estimate. This is different from underestimation — it's a complete failure to engage. Validation must detect zero-all-macros and either (a) estimate manually using known reference values, or (b) route to qwen for a second attempt. Do NOT store 0/0/0 entries — they silently corrupt daily totals. Detection pattern:

```python
if result["calories"] == 0 and result["protein"] == 0:
    # phi4-mini didn't recognize the food — estimate manually or escalate
    logger.warning("phi4-mini returned zeros for: %s", text)
```

Known zero-return triggers: "3 tacos from Birria Landia truck", niche restaurant chains, regional/specialty food items, food truck names. Single-ingredient/common items parse fine.

11. **phi4-mini drops colon in timestamps (T0900 not T09:00).** When the prompt template includes a time like `T00:00`, phi4-mini may return `T0900` (no colon). SQLite `date('2026-07-05T0900')` returns NULL — the WHERE clause silently returns no rows. This is different from a 404 or error: the entry IS stored, but queries can't find it. Detection: POST returns 201, but GET returns `[]`. Fix with `normalize_time()` regex (see Time Format Normalization above). Also affects other small models — validate time format on all Ollama output regardless of model.
