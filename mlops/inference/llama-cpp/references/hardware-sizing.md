# Local LLM Hardware Sizing

Quick reference for matching models to hardware budgets. Answers the recurring question: "I want to run model X locally — what do I need?"

## VRAM Formula

```
VRAM_GB ≈ (params × bits_per_weight / 8) + 2GB overhead

bits_per_weight by quant:
  Q8_0:     8.0  |  IQ4_NL:    4.2
  Q6_K:     6.6  |  Q4_K_M:    4.5
  Q5_K_M:   5.5  |  IQ3_XXS:   3.1
  IQ4_XS:   4.7  |  IQ2_XXS:   2.1
```

For MoE models: use TOTAL params (all experts must be stored), not active params.

## Common Models vs Hardware

| Model | Total Params | Q4_K_M GB | IQ3_XXS GB | Fits 24GB | Fits 48GB |
|---|---|---|---|---|---|
| Gemma 4 31B | 31B | 18 | — | ✅ | ✅ |
| Qwen3.5-35B-A3B MoE | 35B | 20 | 14 | ✅ | ✅ |
| Qwen3.5-27B dense | 27B | 15 | — | ✅ | ✅ |
| Qwen3.5-122B-A10B MoE | 122B | 69 | 47 | ❌ | ✅ |
| MiniMax-M2.7 | ~114B | 64 | 44 | ❌ | ✅ |
| Llama 3 70B | 70B | 39 | — | ❌ | ✅ |
| Qwen3.5-397B-A17B MoE | 397B | 223 | 154 | ❌ | ❌ |
| DeepSeek-V3 | 671B | — | — | ❌ | ❌ |

## Hardware Price Ranges (2026)

| Build | VRAM/RAM | Approx Cost | Max Model |
|---|---|---|---|
| RTX 3060 12GB | 12GB | ~$200 | Qwen3.5-27B Q4 |
| RTX 3090 24GB | 24GB | ~$700 | Gemma 4 31B Q4, 35B-A3B Q4 |
| Mac Mini M4 24GB | 24GB unified | ~$799 | Same as 3090 (slower tok/s) |
| Mac Mini M4 Pro 48GB | 48GB unified | ~$2,000 | Qwen3.5-122B-A10B IQ3, MiniMax-M2.7 IQ3 |
| Dual 3090 48GB | 48GB VRAM | ~$2,000 | Same as M4 Pro 48GB (faster but louder) |
| Mac Studio M4 Max 128GB | 128GB unified | ~$4,000 | Mixtral 8x22B Q4, Llama 3 70B comfortable |

## Budget Tier Guide

### $1,000 tier — RTX 3090 24GB build
- Best model: Gemma 4 31B at Q4_K_M (~18GB)
- Also runs: Qwen3.5-35B-A3B, Qwen3.5-27B, Llama 3 8B
- Tok/sec: 40-60 t/s on 7B, 15-25 t/s on 30B
- Best value for raw GPU compute

### $2,000 tier — Mac Mini M4 Pro 48GB or dual 3090
- Best models: Qwen3.5-122B-A10B, MiniMax-M2.7 (both at IQ3_XXS)
- Mac advantage: silent, power-efficient, largest single pool
- Dual 3090 advantage: faster tok/sec, more GPU grunt
- Mac handles 70B+ models, dual 3090 handles parallel loads

### Cloud vs Local Break-Even
- Mac Mini M4 Pro 48GB ($2,000) vs Ollama Pro ($20/mo) = 100 months raw
- Factor in VPS savings ($5/mo): break-even ~80 months
- With resale value (~$1,000 after 3y): real break-even ~4 years
- Tiebreaker: travel lifestyle (cloud follows you, local doesn't)

## Pitfalls

- **MoE models store ALL experts.** Qwen3.5-397B-A17B has 397B total params — at IQ2_XXS it's still ~104GB, won't fit consumer hardware.
- **Unified memory vs dedicated VRAM.** Mac's 48GB unified is one pool; dual 24GB GPUs are two separate pools. For single large models, unified wins. For parallel inference, dual GPU wins.
- **FP8/NVFP4 variants exist** but need NVIDIA hardware — not useful for Mac.
- **Don't confuse active params with total.** Qwen3.5-122B-A10B has 10B active but stores 122B total — VRAM based on total.
