---
name: food-tracking
description: Log what the owner eats or drinks (calories, protein, fiber) to the food diary, correct entries, and report daily totals. Use for any message that says they ate, drank or are having something, any food photo or menu, and any question about today's intake.
---

# Food tracking

The diary is a SQLite database that a web page and possibly another assistant also use. Read and write it only through the `food` command. Never claim something is logged unless `food log` printed `Logged #<id>`.

## Commands

```
food log "Greek yogurt, 1 cup" --cal 150 --protein 20 --fiber 0 [--at 13:30] [--source text] [--raw "owner's words"]
food day [YYYY-MM-DD]        entries, totals, target and what is left
food prior "yogurt"          how this food was logged before
food edit 412 --cal 180      change fields of one entry
food delete 412
food weight [185.5]          show recent weights; with a number, log one
food now                     current local time and timezone
```

`food log` prints the day's totals after writing, so one call both logs and gives you what to report.

## Logging

1. Check `$NANO_DATA_DIR/food/USUALS.md` if it exists. It holds the owner's own shorthands and standing portions, and it wins over everything else.
2. Run `food prior "<food>"`. If the same item was logged before, reuse those numbers unless the portion differs.
3. Otherwise find real numbers:
   - Packaged food: look the product up (OpenFoodFacts at `world.openfoodfacts.org`, or the brand's site) and match the actual product and serving size.
   - Restaurant or chain food: search for the published nutrition first. See `references/restaurant-menu-research.md`.
   - Home cooking, produce, or anything with no published numbers: estimate from the ingredients and portion, and use `--source estimate`.
   - Photo: identify the items and portions from the image, then follow the same steps. Use `--source image`.
4. Time: with no time mentioned, omit `--at` (now). "For lunch", "this morning", "at 2" → pass `--at`. The command works in the owner's timezone; never compute offsets yourself. If it rejects a time as being in the future, ask which day they meant.
5. One `food log` call per distinct item, so each can be corrected separately. A combined dish is one item.
6. Reply in one or two lines: what was logged with its numbers, and what is left today. Mention when numbers are an estimate.

Do not ask about details that barely change the total. Ask only when the portion is unknown and matters (a "bowl of pasta" could be 300 or 900 calories).

## Corrections

Find the entry with `food day`, then `food edit` or `food delete`. Report the new totals from the command output.

If `food log` says the item is already on that day, it may be a duplicate message. Check with the owner unless they clearly said it was a second serving, then use `--force`.

## Learning the owner's usuals

When the owner establishes a standing meaning ("when I say coffee I mean with oat milk", "my usual protein bar is X"), add a line to `$NANO_DATA_DIR/food/USUALS.md` with the food, the portion and the numbers, so it is applied next time without asking.

## Targets and weight

Daily targets are read from the diary. Do not invent or change them. If none is set, report totals only.

For digestion or symptom questions, see `references/gut-health-troubleshooting.md` and do not diagnose.
