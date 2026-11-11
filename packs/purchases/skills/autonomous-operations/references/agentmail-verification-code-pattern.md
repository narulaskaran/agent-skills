# AgentMail Email Verification — Code Extraction Pattern

This reference documents the reliable pattern for reading verification codes from incoming AgentMail emails during autonomous service signup.

## The Fragile Approach (avoid)

Nesting Python inside bash inside shell-quoted strings is fragile. This fails:

```bash
python3 -c "import os; from agentmail import AgentMail; ..."
```

Reason: Nested quotes (`'`, `"`, and `\`) collide unpredictably, especially with `message_id` values containing `