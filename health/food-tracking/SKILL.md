---
name: food-tracking
description: Track food intake with calories, protein, and fiber; use database-backed logging, source-first nutrition lookup, and timezone-safe meal times.
---

# Food tracking

Load before any food logging, correction, or daily-total request. Write entries to the configured food diary, then read totals back from the database.

## Targets and source policy

- Use current configured daily targets; never invent or silently change them.
- Packaged foods: query OpenFoodFacts first and use serving-level nutriments. Record source and serving assumptions.
- Restaurant or branded foods: search first. If no reliable result exists, label estimate and state portion assumptions.
- Never fabricate nutrition numbers from memory. Ask for missing serving size when it materially changes totals.

## Log workflow

1. Parse food, amount, meal time, and split/portion language. User-stated meal time wins; do not substitute current time.
2. Use the configured timezone resolver available in your environment. Store ISO-8601 timestamp with offset; never hard-code an offset.
3. Read existing schema and current totals before writing. Confirm database path and columns rather than assuming deployment layout.
4. Research nutrition, normalize units, and calculate the logged portion.
5. Insert one row with food name, calories, protein, fiber, meal time, source type, raw input, and status. `/queue` means schedule, not immediate insertion.
6. Read inserted row and recompute daily totals from the database. Conversational text alone is not a log.

Example:
```python
from datetime import datetime
from timezone_resolver import resolve_timezone
now = datetime.now(resolve_timezone().tz)
meal_time = now.strftime("%Y-%m-%dT%H:%M:%S%z")
meal_time = meal_time[:-2] + ":" + meal_time[-2:]
```

## Corrections and failures

- Identify row, preserve audit context, update only intended fields, then reread row and totals.
- Never reconcile a conversational list later. Each item must be written and verified.
- On partial failure, report confirmed and unconfirmed rows. Do not silently retry or duplicate.
- On context compaction, recover only from current handoff or database; mark unknown items instead of guessing.
- For gut-health symptoms, use a qualified reference and avoid diagnosis claims.

## Verification checklist

- [ ] Nutrition source and portion recorded.
- [ ] Meal time came from user words or explicitly marked current time, with resolved offset.
- [ ] Database write returned a row ID or equivalent confirmation.
- [ ] Daily totals were queried after the write.
- [ ] Estimates, unknowns, and queued items are clearly labeled.
