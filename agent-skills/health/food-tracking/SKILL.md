1|---
2|name: food-tracking
3|description: "Track daily food intake with calories, protein, and fiber. Supports photo-based and text-based entries. Maintains daily log files with running totals. Adaptable targets — defaults shown are examples."
4|---
5|
6|## CRITICAL — Step 0 (before ANYTHING else)
7|
**Run `python3 ~/.hermes/scripts/now_et.py --time` FIRST.** Before reading files, before estimating, before writing. This script outputs current ET date AND time. Never guess the day. Never estimate the hour. The script IS the answer. If the script says 2am, the user is eating at 2am — log it. If the script says Monday when you thought it was Sunday, you're wrong and the script is right.
9|
10|**Failure mode:** Long sessions (50+ messages) bleed across day boundaries. Agent drifts, forgets to reload skill, guesses the day, writes to wrong file. Jun 14-15 2026: agent wrote Sunday food to Monday's file because it "felt like Sunday." The script would have caught this. Run it every single time without exception.
11|
12|## Trigger
13|
**ANY mention of eating or drinking = log it.** Even casual — "drinking a cortado," "eating a donut," "having lunch." No explicit description needed. User shouldn't have to say "log this" or provide a detailed breakdown. If the user says they're consuming something, log it immediately. No exception for short/social mentions — those are the most common failure mode.
15|
16|Also: food photos, daily total queries, calorie estimates, weight loss questions.
17|
18|**ANY mention of eating or drinking is a log request.** "Drinking a cortado," "having a snack," "eating lunch" — these are NOT casual conversation. They are instructions to log. Log FIRST, then reply. Never respond to a food/drink mention without logging it. This is the #1 failure mode — agent chats about the food instead of doing its job.
19|
20|## Log File
21|Daily files at `~/.hermes/food-log/YYYY-MM-DD.md`. One entry per meal/snack.
22|
23|### Log Format
24|```markdown
25|# Food Log — YYYY-MM-DD
26|
27|## Daily Target: #### cal | ###g protein | ~##g fiber (see memory — targets may change)
28|
29|| # | Time | Item | Cals | Protein | Fiber | Notes |
30||---|------|------|------|---------|-------|-------|
31|| 1 |  ##:## | Item | ### | #g | #g | source/confidence |
32|
33|## Running Totals
- Calories: **XXXX / ####** (XXXX left)
- Protein: **XXg / ###g** (XXg left)
- Fiber: **XXg / ~##g** (~XXg left)
37|
38|## Calorie Estimation Approach
39|
40|### Text entries (user describes what they ate)
41|- Look up standard calorie counts for common items
42|- **Timestamp rule: message send time = eating time.** Use message timestamp directly. Only ask for time if the user explicitly says "earlier," "yesterday," "last night," etc.
43|- Ask for portion size if ambiguous (e.g., "cup of rice" vs "bowl of rice")
44|- Use USDA database / common references for estimates
45|### Photo entries (user sends pic)
46|- Use vision_analyze to identify food items
47|- Estimate portion sizes visually
48|- **Bowl distortion:** Close-up bowl photos make portions look 2-3x larger than reality. Home-cooked meals in bowls or deep plates are especially deceptive. Default to conservative (lower) estimates for bowl-based home meals, and actively prompt user for portion confirmation on starch, protein, and oil before finalizing.
49|- Ask clarifying questions if unclear (e.g., dressing, cooking method, hidden ingredients)
50|- Flag low-confidence estimates with explicit uncertainty markers
51|- **If user corrects multiple components, recalculate fully. Corrections are data, not debate.**
52|
53|### Restaurant meals
54|- See also: `references/restaurant-menu-research.md` for systematic escalation path when menu access is blocked
55|- **Paywall/authwall bypass:** When ANY site blocks access (restaurant menus, nutrition databases, research articles), use `references/paywall-bypass.md` escalation path — don't retry same blocked domain repeatedly.
56|- Much harder to estimate. Ask where from.
57|- Chain restaurants: use published nutrition info
58|- Independent restaurants: estimate by components, flag as rough estimate
59|- Restaurant meals typically 30-50% higher than homemade equivalents
60|
61|#### When restaurant doesn't publish nutrition info
62|
63|**⚠️ Many restaurant sites block automated access (Wordfence, Cloudflare). Don't burn 10 tool calls retrying the same domain. If the main site returns a block page, skip directly to alternative sources — menu aggregators, ordering platforms, review sites, or general knowledge.**
64|
65|1. **Resolve Google Maps short URLs first:** `curl -sI -o /dev/null -w '%{redirect_url}' "<short_url>"` — extracts restaurant name/location.
66|2. Search official website for product/menu page → extract ingredient list. **If blocked (Wordfence/Cloudflare), move on immediately.**
67|3. Check for nutrition PDFs linked on site (common: `/files/...Nutritional_Information...pdf`).
68|4. Try third-party databases and menu aggregators: MyFitnessPal, Nutritionix, Yelp menu, ToastTab ordering, DoorDash/Uber Eats store pages.
69|5. Try search engines (DuckDuckGo, Bing) for menu item mentions in reviews or blog posts.
70|6. **Fallback for known chains:** if the restaurant is a well-known chain with a consistent menu across locations, use general knowledge of their menu + transparent disclosure that it's an estimate, not scraped data.
71|7. Estimate from ingredients + comparable known items; be transparent it's an estimate.
72|8. If you searched and found nothing, say so — don't invent confidence. Mark as rough estimate.
73|
74|## Barcode Lookup
75|When the user sends a barcode photo, extract nutrition precisely — see `references/barcode-lookup.md` for the full pipeline (vision → digits or pyzbar → Open Food Facts API).
76|
77|## Standard Reference Items
78|Common items users may mention without photos:
79|
80|| Item | Calories | Protein | Fiber | Notes |
81||------|----------|---------|-------|-------|
82|| Drip coffee, w/ splash whole milk (~2 tbsp) | 25 | 0.5g | 0g | |
83|| Drip coffee, black | 5 | 0g | 0g | 8 oz |
84|| Cortado | 40 | 2g | 0g | espresso + small amount steamed milk |
85|| Drip coffee, w/ 2 tbsp cream | 45-60 | 0.5g | 0g | depends on cream |
86|| Drip coffee, w/ 1 tbsp sugar | 50 | 0g | 0g | + cream adjust |
87|| Espresso shot | 3 | 0g | 0g | |
88|| Latte, 12 oz whole milk | 180 | 9g | 0g | |
89|| Latte, 12 oz oat milk | 150 | 3g | 2g | |
90|| Masala chai, 10-12oz | 120-170 | 5g | 0g | whole milk + sugar, varies by milk ratio/sweetness |
91|| Papaya drink, half (10oz) | 110 | 0g | 0g | sweetened, ~220 full |
92|| TJ's overnight oats (vanilla, almond milk) | 240 | 8g | 6g | 159g container |
93|| Mediterranean plate (restaurant) | 700-900 | 45g | 8g | lamb/beef, feta, hummus, greens, roasted potatoes, yogurt |
94|| Egg, large, fried | 90 | 6g | 0g | + oil ~40 |
95|| Egg, large, scrambled | 90 | 6g | 0g | + butter ~50 |
96|| Egg, large, boiled | 70 | 6g | 0g | |
97|| Toast, white, 1 slice | 80 | 2g | 1g | + butter ~35 |
98|| Toast, whole wheat, 1 slice | 70 | 3g | 2g | + butter ~35 |
99|| Avocado, 1/2 medium | 120 | 2g | 7g | |
100|| Banana, medium | 105 | 1g | 3g | |
101|| Apple, medium | 95 | 0.5g | 4g | |
102|| L'Industrie pizza, 1 slice | 400 | 13g | 1g | [ESTIMATE] thin Neapolitan-ish, NYC |
103|| Chicken breast, 6 oz cooked | 280 | 52g | 0g | |
104|| Chicken thigh, 6 oz cooked | 320 | 40g | 0g | boneless skinless |
105|| Salmon, 6 oz cooked | 350 | 38g | 0g | |
106|| Rice, white, 1 cup cooked | 205 | 4g | 1g | |
107|| Rice, brown, 1 cup cooked | 215 | 5g | 3g | |
108|| Pasta, 1 cup cooked | 220 | 8g | 3g | |
109|| Olive oil, 1 tbsp | 120 | 0g | 0g | ~often underestimated |
110|| Butter, 1 tbsp | 100 | 0g | 0g | |
111|| Greek yogurt, low-fat plain (5.3oz) | 130 | 17g | 0g | Chobani |
112|| Chia seeds, 1 tbsp | 60 | 2g | 5g | |
113|| TJ's Garlic Cheese Bread Stick, 1 stick (42g) | 120 | 5g | 1g | verified: CalorieKing, FatSecret, MyNetDiary, CarbManager |
114|| Protein shake, standard | 150-200 | 20-30g | 0-3g | varies by brand |
115|| Nuri protein shake | 160 | 25g | 2g | RTD, estimate — need label verification |
116|| OWYN Dark Chocolate (11.15 fl oz) | 180 | 20g | 5g | plant-based (pea + pumpkin seed protein); verified from label Jun 2026; 8g carb, 7g fat, 4g sugar |
117|| Nutri chocolate milk shake (11oz, ultra-filtered) | 160 | 30g | 1g | 1g sugar from label; ultra-filtered milk |
118|| Barebells protein bar | 200 | 20g | 3g | standard size; the user eats these regularly |
119|| Kirkland Signature protein bar (all flavors) | 190 | 21g | 10g | 60g bar; 2g sugar, 10g net carbs per label |
120|| Kirkland Signature energy drink | 10 | 0g | 0g | |
121|| Barebells protein bar (all flavors) | 200 | 20g | 3g | 55g bar; varies slightly by flavor |
122|| Costco energy drink | 10 | 0g | 0g | |
123|| Celsius energy drink (12oz) | 10 | 0g | 0g | |
124|| Beer, 12 oz (5%) | 150 | 2g | 0g | |
125|| Wine, 5 oz | 125 | 0g | 0g | |
126|| Cocktail, standard | 200-300 | 0g | 0g | varies wildly |
127|| Metamucil Sugar-Free Orange, 2 tsp | 20 | 0g | 5g | psyllium fiber supplement |
128|| Metamucil Sugar-Free Orange, 2 tbsp | 60 | 0g | 15g | triple standard serving |
129|| Pad see ew, full restaurant | 700-800 | 25g | 3g | wide rice noodles, chicken, soy sauce, oil-heavy |
130|| Pad see ew, half portion | 350-400 | 12g | 2g | leftovers/common portion |
131|| Chicken 65, full order | 900 | 50g | 2g | deep-fried Indian spicy chicken, restaurant |
132|| Chicken 65, half order | 450 | 25g | 1g | |
133|| Dal makhani, 1 cup restaurant | 300 | 12g | 6g | heavy butter/cream, black lentils |
134|| Callie's Hot Little Biscuit — strawberry shortcake biscuit w/ jam | 400 | 6g | 2g | estimated; no published nutrition |
135|| Playa Bowl Aloha smoothie, 20oz full | 360 | 4g | 6g | pitaya, pineapple, mango, banana, coconut milk |
136|| Playa Bowl Aloha smoothie, 10oz half | 180 | 2g | 3g | |
137|| Indian restaurant meal (rice+dal+half app) | 700-1000 | 25-40g | 5-10g | varies, estimate by components |
138|| Indian restaurant combo (dal makhani + biryani + rice + naan) | 900-1100 | 35g | 6g | the user corrected 1200→1000 (date removed) |
139|| Bagel, deli (onion/everything) w/ cream cheese (~2-3 tbsp) | 440-470 | 14g | 2g | varies by schmear size and cream cheese type |
140|| Chipotle burrito: honey chicken, white rice, black beans, tomato salsa, corn salsa, lettuce, cheese | 1060 | 61g | 15g | no sour cream, no fajita veggies; the user's standard order |
141|| Chipotle burrito: honey chicken, brown rice, black beans, tomato salsa, corn salsa, lettuce, cheese | 1070 | 62g | 17g | +10 cal, +1g protein, +2g fiber vs white rice |
142|At end of day (or when user asks):
143|- Show running total vs targets, protein vs target, fiber vs target
144|- Always include all three macros in summaries
145|- Note over/under per macro
146|- Weekly average would be useful after ~3 days of data
147|
148|## Timestamp Rule (OVERRIDES ALL BELOW)
149|
150|**Message send time = eating time. Period.** The user reports food as they're eating. Do NOT ask "when did you eat this?" or "what time?" — the message time IS the answer. Do NOT guess or do mental timezone math.
151|
152|**⚠️ MANDATORY: Run `python3 ~/.hermes/scripts/now_et.py --time` before EVERY food log write.** This script deterministically outputs current ET time. Never estimate, never convert in your head. The script IS the time. If you can't run it, ask the user what time it is — don't guess.
153|
154|**⚠️ System clock is typically UTC. The user is likely in a different timezone (UTC-4/EDT).** Messaging timestamps may also be UTC. The script handles this. If time looks wrong after running the script (e.g., 2:00am for a meal), it means they're eating at 2am — log it. Don't second-guess the script.
155|
156|**Exception only when explicitly signaled:** If the user says "earlier," "yesterday," "last night," "this morning" (when it's evening), or any other retroactive indicator, THEN ask for the specific time.
157|
158|This rule replaces any contradictory guidance in Important Notes below.
159|
160|## Important Notes
161|- Estimates are approximations — honest about uncertainty
162|- Timestamps: message time = eat time (see Timestamp Rule above). No exceptions unless the user says otherwise.
163|- **Day boundary is sleep-based, not midnight.**
164|- **Photo portion bias:** Close-up food photos (especially bowls) systematically overestimate. Home-cooked meals are almost always smaller than they look. Prompt for confirmation on key components (starch, protein, oil) rather than trusting visual alone.
165|- "One tbsp" of oil in home cooking is often actually 2-3 tbsp
166|- Restaurant portions are larger than home portions
167|- Don't nag or judge — this is tracking, not coaching
168|- **Alcohol rule: no drinks Mon-Thu.** Hard rule, not a guideline. Fri-Sun OK, keep to 1-2. Flag any Mon-Thu alcohol in the log.
169|- Target lives in memory (not hardcoded here). Check memory for current target before creating new daily logs.
170|- TDEE calculator: https://tdeecalculator.net/ (use Imperial or Metric as appropriate). BF% optional — leaving it out uses a standard estimate.
171|
172|## Pitfalls
173|
174|- **Never declare day totals from a single meal.** Before reporting any "day so far" or day-total summary, read the existing daily log file first. A single entry added in isolation does NOT represent the full day. Failing to read the log before making a day claim is the fastest way to look incompetent — The user will check your work (June 10, 2026: dinner logger claimed "1120 cal, 36g protein" when the full log had 2836 cal, 177g protein across 13 entries).
175|- **Delegate tasks can silently fail to write.** A subagent may self-report "Logged" without actually writing to the daily log file. The tortellini bolognese from June 10 was "logged" by a delegate but never reached the file. If a delegate claims to have written to the food log, verify by reading the file afterward. Self-reported completion is not evidence of completion.
176|- **Never respond socially to food/drink mentions without logging first.** User says "eating X" or "drinking Y" — tool call to log comes BEFORE the "enjoy" reply. A social-only response to a food mention is a dropped entry. Caveman voice is no excuse — log then banter. This is the #1 failure mode.
177|- **Always estimate protein and fiber for every entry.** Every food item in the log table MUST have protein and fiber values, even if approximate. Summaries must include calories + protein + fiber. Never report calories-only.
178|- **NEVER do mental timezone math — not even the date.** System is UTC. User is ET (UTC-4/EDT). You WILL get the day AND time wrong. Always run `python3 ~/.hermes/scripts/now_et.py --time` before every food log write. This script outputs the current ET date AND time — use both. Failures: May 20 (logged noon meals as 1:30am), Jun 15 2026 (guessed "Sunday 2pm" without running script — was actually Monday 9:25am, wrote to wrong day's file with wrong time AND wrong calorie values from memory instead of the reference table). The script exists because "remembering to subtract 4 hours" does not work — and neither does "I'm pretty sure it's still Sunday."
179|- **Logs can exist outside the daily file.** When user says "did you log X" and it's not in today's file, run `session_search` for that meal before concluding it never happened. Previous sessions may have estimated the meal but failed to write it to the daily log. Recovery: extract time + estimate from session, add as new entry in today's file, tell user what you found.
180|- **Casual mentions trigger logging.** "Drinking a cortado," "eating a donut," "had lunch" — these ARE food descriptions. Don't treat them as social chat. Log immediately. If you reply "enjoy" without logging, you failed. This is the #1 failure mode: agent treats casual consumption mentions as small talk instead of tracking triggers.
181|
182|- **Write provisional entries immediately.** When you estimate a meal but are waiting on user confirmation (portion sizes, ingredients, etc.), write the entry to the log anyway — mark it `[PENDING CONFIRMATION]` in the Notes column. Sessions end; unpersisted estimates are lost. User can't confirm what they can't see. Update the entry when confirmed, remove the marker.
183|- **Adding entries via patch can silently drop adjacent table rows.** When adding new food entries to the markdown table with the `patch` tool, the tool occasionally merges or omits the last row of the existing table. After EVERY patch to a food log, read the file back and verify all entries are present and the running total is correct. If an entry was dropped, re-add it immediately. Don't trust the patch diff — it may not show the dropped row.
184|- **Rounding ≠ inventing.** When user says "round it out to 2400," adjust existing entries (portion sizes, counts) rather than creating a generic new entry. E.g., user says "round it out to 2400" then "mozzarella sticks" → bump the existing mozzarella stick count (6→8), don't add a new "[ROUNDING] evening snack" row.
185|- **Prefer write_file over patch for multi-entry tables.** When the food log has 4+ entries or you're adding 2+ rows in one operation, use `write_file` to rewrite the entire file instead of `patch`. Patch corruption has been observed twice in one session (May 29, 2026): duplicated rows, dropped table headers, and exercise data scrambled into the food table. `write_file` is more reliable for complex markdown table modifications. Cost of re-reading and fixing after a bad patch exceeds cost of a clean rewrite.
186|- **External file modifications can corrupt patches mid-edit.** The food log may be modified externally (e.g., Strava sync injecting exercise rows). If the file changes between your last read and your patch, the diff context shifts and rows get mangled. Before patching, re-read the file to get current state. If uncertain, fall back to `write_file`.
187|- **External processes write the food log too.** Strava integration and other cron jobs may append exercise data to the daily log between your read and write. If the file was modified externally (warning: "modified since you last read it"), always re-read the file first, then rewrite the ENTIRE file with `write_file` rather than trying to salvage a corrupted patch.
188|- **Never declare \"no nutrition found\" too early.** User pushed back after \"no published nutrition found\" was declared prematurely — the data was available on FatSecret, CalorieKing, CarbManager, and MyNetDiary. The product website being JS-blocked is NOT the same as \"data doesn't exist.\" Exhaust third-party databases before giving up. User will check your work.\n- **Casual food/drink mentions ARE log requests.** "Drinking a cortado" is not small talk — it's an instruction. Never reply "enjoy" or make conversation without logging first. Log then respond. Agent responded "Brown sugar in cortado — solid move" without logging (Jun 5, 2026) — The user immediately corrected: "When I tell you I'm eating or drinking something, that means you're supposed to log it."
189|- **Verify message date before logging.** When user replies to a threaded message mentioning food, check whether that message is from today or a different day. Replying "I just had another one of these" to yesterday's bagel message means the original was yesterday — don't log it to today's file. If unsure whether the referenced meal is today's, ask before logging.
190|- **Before adding entries, check existing daily log for duplicates from cross-day bleed.** Sessions running past midnight can duplicate previous day's entries into tomorrow's file with wrong timestamps (June 12, 2026: June 11 dinner at 7:30pm correctly in June 11 file, but also duplicated at 11:48pm in June 12 file). When user reports a meal time ("dinner was at 7:30pm"), cross-check the previous day's log — the entry may already exist there with the correct time. Delete duplicates from the wrong day's file.
191|- **Sessions running past midnight contaminate the next day's log.** When a session writes food entries after midnight (system clock rolled to next day), those entries land in the new day's file even though the user hasn't slept yet — and often duplicate entries already correctly logged in the previous day's file by a prior session. Before writing to today's file, check whether the previous day's file already has those entries. If so, do NOT duplicate them in today's file. If entries appear with late-night timestamps (11pm+) in the morning's file, they're almost certainly from last night — move them to the previous day's file and remove from today's. (Jun 12, 2026: dinner logged at 11:48pm to June 12 file, but dinner was at 7:30pm and already in June 11 file.)
192|- **Long non-food sessions cause skill drift.** When food tracking happens inline within a 100+ message session about something else (Home Assistant setup, research task), agent forgets to reload this skill. Result: skips time script, guesses day, uses wrong calorie values from memory instead of reference table. Jun 14-15 2026: Home Assistant session (159 msgs) → food log request → agent wrote to Sunday file without running `now_et.py --time`. Was actually Monday 9:25am. User corrected. Fix: before ANY food log operation in a non-food context, run `skill_view(name='food-tracking')` or at minimum `now_et.py --time` + re-read the reference table.
193|- **Timebox obscure product searches.** For products without easily-findable nutrition (Trader Joe's private label, restaurant-specific items, small-batch products), limit direct curl attempts to 3 max. Then use DDGS (DuckDuckGo Search) to find nutrition on third-party sites: `pip install ddgs` in a venv, search for \"[product] nutrition facts calories per serving\", and check results from FatSecret, CalorieKing, CarbManager, MyNetDiary. These sites are NOT JS-blocked and consistently host TJ's product data. Write DDGS scripts to a temp file — inline `python3 -c` with quoted search strings hits shell escaping issues. After 2 rounds of DDGS with no results, estimate from similar products, mark as `[ESTIMATE]`, and move on.
194|
195|## Gut Health Troubleshooting
196|
197|When the user reports bloating, constipation, or reflux, load `references/gut-health-troubleshooting.md` for systematic diagnostic flow: review recent food logs, scan for trigger patterns (cruciferous veg, fried food, low water, dairy, late meals, alcohol), cross-reference with known reflux-safe foods.
198|