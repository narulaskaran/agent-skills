# Fusion vs Solo — Jun 18, 2026 Quick Test

## Test 1: Simple classification (local judge)

Panel: llama3.1:8b, llama3.2:3b
Judge: gemma4:12b (local)
Prompt: "Say hi in one word."

Results:
- llama3.1:8b → "Hello!" (4.5s)
- llama3.2:3b → "Hello." (7.2s)
- Gemma4 judge → "Hello!" (29.5s)

Both models agreed. Fused output was clean.

## Test 2: Classification with DeepSeek judge

Panel: llama3.1:8b, qwen2.5:14b
Judge: DeepSeek (API)
Prompt: "Classify this: 'my gateway keeps crashing'. Pick one: [system] [general] [food] [code]"

Results:
- llama3.1:8b → "[system]" (13.6s)
- qwen2.5:14b → "[system]" (10.4s)
- DeepSeek judge → correct classification with explanation of consensus (493 tok)

Synthesis correctly identified: complete consensus, no contradictions, well-structured final answer.

## Key Takeaways

- Both models agreed on simple classification — fusion was unnecessary
- For ambiguous tasks (decomposition, review, analysis), diversity pays off
- DeepSeek judge produces better synthesis than local judge (gemma4:12b)
- Local judge saves $0.0001 per call but takes 30s+ on gemma4
