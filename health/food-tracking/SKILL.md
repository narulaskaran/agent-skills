---
name: food-tracking
description: "Track daily food intake with calories, protein, and fiber. Supports photo-based and text-based entries. Maintains daily log files with running totals. Adaptable targets — defaults shown are examples."
---

## Trigger

**ANY mention of eating or drinking = log it.** Even casual — "drinking a cortado," "eating a donut," "having lunch." No explicit description needed. User shouldn't have to say "log this" or provide a detailed breakdown. If the user says they're consuming something, log it immediately. No exception for short/social mentions — those are the most common failure mode.

Also: food photos, daily total queries, calorie estimates, weight loss questions.

**ANY mention of eating or drinking is a log request.** "Drinking a cortado," "having a snack," "eating lunch" — these are NOT casual conversation. They are instructions to log. Log FIRST, then reply. Never respond to a food/drink mention without logging it. This is the #1 failure mode — agent chats about the food instead of doing its job.

## Log File
Daily files at `~/.agent/food-log/YYYY-MM-DD.md`. One entry per meal/snack.

### Log Format
```markdown
# Food Log — YYYY-MM-DD

## Daily Target: #### cal | ###g protein | ~##g fiber (see memory — targets may change)

| # | Time | Item | Cals | Protein | Fiber | Notes |
|---|------|------|------|---------|-------|-------|
| 1 |  ##:## | Item | ### | #g | #g | source/confidence |

## Running Totals
- Calories: **XXXX / XXXX** (XXXX left)
- Protein: **XXg / XXXg** (XXg left)
- Fiber: **XXg / ~XXg** (~XXg left)

## Calorie Estimation Approach

### Text entries (user describes what they ate)
- Look up standard calorie counts for common items
- **Timestamp rule: message send time = eating time.** Use message timestamp directly. Only ask for time if user explicitly says "earlier," "yesterday," "last night," etc.
- Ask for portion size if ambiguous (e.g., "cup of rice" vs "bowl of rice")
- Use USDA database / common references for estimates
### Photo entries (user sends pic)
- Use vision_analyze to identify food items
- Estimate portion sizes visually
- **Bowl distortion:** Close-up bowl photos make portions look 2-3x larger than reality. Home-cooked meals in bowls or deep plates are especially deceptive. Default to conservative (lower) estimates for bowl-based home meals, and actively prompt user for portion confirmation on starch, protein, and oil before finalizing.
- Ask clarifying questions if unclear (e.g., dressing, cooking method, hidden ingredients)
- Flag low-confidence estimates with explicit uncertainty markers
- **If user corrects multiple components, recalculate fully. Corrections are data, not debate.**

### Restaurant meals
- See also: `references/restaurant-menu-research.md` for systematic escalation path when menu access is blocked
- Much harder to estimate. Ask where from.
- Chain restaurants: use published nutrition info
- Independent restaurants: estimate by components, flag as rough estimate
- Restaurant meals typically 30-50% higher than homemade equivalents

#### When restaurant doesn't publish nutrition info

**⚠️ Many restaurant sites block automated access (Wordfence, Cloudflare). Don't burn 10 tool calls retrying the same domain. If the main site returns a block page, skip directly to alternative sources — menu aggregators, ordering platforms, review sites, or general knowledge.**

1. **Resolve Google Maps short URLs first:** `curl -sI -o /dev/null -w '%{redirect_url}' "<short_url>"` — extracts restaurant name/location.
2. Search official website for product/menu page → extract ingredient list. **If blocked (Wordfence/Cloudflare), move on immediately.**
3. Check for nutrition PDFs linked on site (common: `/files/...Nutritional_Information...pdf`).
4. Try third-party databases and menu aggregators: MyFitnessPal, Nutritionix, Yelp menu, ToastTab ordering, DoorDash/Uber Eats store pages.
5. Try search engines (DuckDuckGo, Bing) for menu item mentions in reviews or blog posts.
6. **Fallback for known chains:** if the restaurant is a well-known chain with a consistent menu across locations, use general knowledge of their menu + transparent disclosure that it's an estimate, not scraped data.
7. Estimate from ingredients + comparable known items; be transparent it's an estimate.
8. If you searched and found nothing, say so — don't invent confidence. Mark as rough estimate.

## Standard Reference Items
Common items users mention without photos (all estimates — verify when precision matters):

| Item | Calories | Protein | Fiber | Notes |
|------|----------|---------|-------|-------|
| Drip coffee, w/ splash whole milk (~2 tbsp) | 25 | 0.5g | 0g | |
| Drip coffee, black | 5 | 0g | 0g | 8 oz |
| Cortado | 40 | 2g | 0g | espresso + small amount steamed milk |
| Drip coffee, w/ 2 tbsp cream | 45-60 | 0.5g | 0g | depends on cream |
| Drip coffee, w/ 1 tbsp sugar | 50 | 0g | 0g | + cream adjust |
| Espresso shot | 3 | 0g | 0g | |
| Latte, 12 oz whole milk | 180 | 9g | 0g | |
| Latte, 12 oz oat milk | 150 | 3g | 2g | |
| Masala chai, 10-12oz | 120-170 | 5g | 0g | whole milk + sugar, varies by milk ratio/sweetness |
| Papaya drink, half (10oz) | 110 | 0g | 0g | sweetened, ~220 full |
| TJ's overnight oats (vanilla, almond milk) | 240 | 8g | 6g | 159g container |
| Mediterranean plate (restaurant) | 700-900 | 45g | 8g | lamb/beef, feta, hummus, greens, roasted potatoes, yogurt |
| Egg, large, fried | 90 | 6g | 0g | + oil ~40 |
| Egg, large, scrambled | 90 | 6g | 0g | + butter ~50 |
| Egg, large, boiled | 70 | 6g | 0g | |
| Toast, white, 1 slice | 80 | 2g | 1g | + butter ~35 |
| Toast, whole wheat, 1 slice | 70 | 3g | 2g | + butter ~35 |
| Avocado, 1/2 medium | 120 | 2g | 7g | |
| Banana, medium | 105 | 1g | 3g | |
| Apple, medium | 95 | 0.5g | 4g | |
| Chicken breast, 6 oz cooked | 280 | 52g | 0g | |
| Chicken thigh, 6 oz cooked | 320 | 40g | 0g | boneless skinless |
| Salmon, 6 oz cooked | 350 | 38g | 0g | |
| Rice, white, 1 cup cooked | 205 | 4g | 1g | |
| Rice, brown, 1 cup cooked | 215 | 5g | 3g | |
| Pasta, 1 cup cooked | 220 | 8g | 3g | |
| Olive oil, 1 tbsp | 120 | 0g | 0g | ~often underestimated |
| Butter, 1 tbsp | 100 | 0g | 0g | |
| Greek yogurt, low-fat plain (5.3oz) | 130 | 17g | 0g | Chobani |
| Chia seeds, 1 tbsp | 60 | 2g | 5g | |
| TJ's Garlic Cheese Bread Stick, 1 stick (42g) | 120 | 5g | 1g | verified via CalorieKing, FatSecret, MyNetDiary |
| Protein shake, standard | 150-200 | 20-30g | 0-3g | varies by brand |
| OWYN Dark Chocolate (11.15oz) | 170 | 20g | 5g | verified from label |
| Celsius energy drink (12oz) | 10 | 0g | 0g | |
| Beer, 12 oz (5%) | 150 | 2g | 0g | |
| Wine, 5 oz | 125 | 0g | 0g | |
| Cocktail, standard | 200-300 | 0g | 0g | varies wildly |
| Metamucil Sugar-Free Orange, 2 tsp | 20 | 0g | 5g | psyllium fiber supplement |
| Metamucil Sugar-Free Orange, 2 tbsp | 60 | 0g | 15g | triple standard serving |
| Pad see ew, full restaurant | 700-800 | 25g | 3g | wide rice noodles, chicken, soy sauce, oil-heavy |
| Pad see ew, half portion | 350-400 | 12g | 2g | leftovers/common portion |
| Chicken 65, full order | 900 | 50g | 2g | deep-fried Indian spicy chicken, restaurant |
| Chicken 65, half order | 450 | 25g | 1g | |
| Dal makhani, 1 cup restaurant | 300 | 12g | 6g | heavy butter/cream, black lentils |
| Callie's Hot Little Biscuit — strawberry shortcake biscuit w/ jam | 400 | 6g | 2g | estimated; no published nutrition |
| Playa Bowl Aloha smoothie, 20oz full | 360 | 4g | 6g | pitaya, pineapple, mango, banana, coconut milk |
| Playa Bowl Aloha smoothie, 10oz half | 180 | 2g | 3g | |
| Indian restaurant meal (rice+dal+half app) | 700-1000 | 25-40g | 5-10g | varies, estimate by components |
| Indian restaurant combo (dal makhani + biryani + rice + naan) | 900-1100 | 35g | 6g | varies by restaurant |
At end of day (or when user asks):
- Show running total vs targets, protein vs target, fiber vs target
- Always include all three macros in summaries
- Note over/under per macro
- Weekly average would be useful after ~3 days of data

## Timestamp Rule (OVERRIDES ALL BELOW)

**Message send time = eating time. Period.** The user reports food as they're eating. Do NOT ask "when did you eat this?" or "what time?" — the message time IS the answer. Do NOT guess or do mental timezone math.

**⚠️ MANDATORY: Create a script to deterministically output the user's local time before every food log write.** (`now_et.py --time` or equivalent). This script deterministically outputs current local time. Never estimate, never convert in your head. The script IS the time. If you can't run it, ask the user what time it is — don't guess.

**⚠️ System clock is typically UTC. User likely in a different timezone.** Messaging timestamps may also be UTC. The script handles conversion. If time looks wrong after running the script, log it anyway — don't second-guess the script.

**Exception only when explicitly signaled:** If user says "earlier," "yesterday," "last night," "this morning" (when it's evening), or any other retroactive indicator, THEN ask for the specific time.

This rule replaces any contradictory guidance in Important Notes below.

## Important Notes
- Estimates are approximations — honest about uncertainty
- Timestamps: message time = eat time (see Timestamp Rule above). No exceptions unless user says otherwise.
- **Day boundary is sleep-based, not midnight.**
- **Photo portion bias:** Close-up food photos (especially bowls) systematically overestimate. Home-cooked meals are almost always smaller than they look. Prompt for confirmation on key components (starch, protein, oil) rather than trusting visual alone.
- "One tbsp" of oil in home cooking is often actually 2-3 tbsp
- Restaurant portions are larger than home portions
- Don't nag or judge — this is tracking, not coaching
- Target lives in memory (not hardcoded here). Check memory for current target before creating new daily logs.
- TDEE calculator: https://tdeecalculator.net/ (use Imperial or Metric as appropriate)

## Pitfalls

- **Never respond socially to food/drink mentions without logging first.** User says "eating X" or "drinking Y" — tool call to log comes BEFORE any reply. A social-only response to a food mention is a dropped entry. Log then respond. This is the #1 failure mode.
- **Always estimate protein and fiber for every entry.** Every food item in the log table MUST have protein and fiber values, even if approximate. Summaries must include calories + protein + fiber. Never report calories-only.
- **NEVER do mental timezone math.** System is likely UTC, user is in their local timezone. You WILL get it wrong. Always run the local-time script before every food log write. This failure happened repeatedly — the script exists because mental timezone conversion does not work.
- **Logs can exist outside the daily file.** When user says "did you log X" and it's not in today's file, run `session_search` for that meal before concluding it never happened. Previous sessions may have estimated the meal but failed to write it to the daily log. Recovery: extract time + estimate from session, add as new entry in today's file, tell user what you found.
- **Casual mentions trigger logging.** "Drinking a cortado," "eating a donut," "had lunch" — these ARE food descriptions. Don't treat them as social chat. Log immediately. If you reply "enjoy" without logging, you failed. This is the #1 failure mode: agent treats casual consumption mentions as small talk instead of tracking triggers.
- **Write provisional entries immediately.** When you estimate a meal but are waiting on user confirmation (portion sizes, ingredients, etc.), write the entry to the log anyway — mark it `[PENDING CONFIRMATION]` in the Notes column. Sessions end; unpersisted estimates are lost. User can't confirm what they can't see. Update the entry when confirmed, remove the marker.
- **Adding entries via patch can silently drop adjacent table rows.** When adding new food entries to the markdown table with the `patch` tool, the tool occasionally merges or omits the last row of the existing table. After EVERY patch to a food log, read the file back and verify all entries are present and the running total is correct. If an entry was dropped, re-add it immediately. Don't trust the patch diff — it may not show the dropped row.
- **Rounding ≠ inventing.** When user says "round it out to 2400," adjust existing entries (portion sizes, counts) rather than creating a generic new entry. E.g., user says "round it out to 2400" then "mozzarella sticks" → bump the existing mozzarella stick count (6→8), don't add a new "[ROUNDING] evening snack" row.
- **Prefer write_file over patch for multi-entry tables.** When the food log has 4+ entries or you're adding 2+ rows in one operation, use `write_file` to rewrite the entire file instead of `patch`. Patch corruption has been observed: duplicated rows, dropped table headers, and other data scrambled into the food table. `write_file` is more reliable for complex markdown table modifications.
- **External file modifications can corrupt patches mid-edit.** The food log may be modified externally (e.g., fitness tracker sync injecting exercise rows). If the file changes between your last read and your patch, the diff context shifts and rows get mangled. Before patching, re-read the file to get current state. If uncertain, fall back to `write_file`.
- **External processes write the food log too.** Fitness integrations and other cron jobs may append data to the daily log between your read and write. If the file was modified externally (warning: "modified since you last read it"), always re-read the file first, then rewrite the ENTIRE file with `write_file` rather than trying to salvage a corrupted patch.
- **Never declare "no nutrition found" too early.** Product websites being JS-blocked is NOT the same as "data doesn't exist." Exhaust third-party databases (FatSecret, CalorieKing, CarbManager, MyNetDiary) before giving up. The user will check your work.
- **Casual food/drink mentions ARE log requests.** "Drinking a cortado" is not small talk — it's an instruction. Never reply with conversation without logging first. Log then respond.
- **Timebox obscure product searches.** For products without easily-findable nutrition (private label, restaurant-specific items, small-batch products), limit direct curl attempts to 3 max. Then use DDGS (DuckDuckGo Search) to find nutrition on third-party sites. After 2 rounds of DDGS with no results, estimate from similar products, mark as `[ESTIMATE]`, and move on.

## Gut Health Troubleshooting

When user reports bloating, constipation, or reflux, load `references/gut-health-troubleshooting.md` for systematic diagnostic flow: review recent food logs, scan for trigger patterns (cruciferous veg, fried food, low water, dairy, late meals, alcohol), cross-reference with known reflux-safe foods.
