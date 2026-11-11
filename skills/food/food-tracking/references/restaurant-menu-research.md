# Restaurant Menu Research — Escalation Path

Quick reference for extracting menu/calorie info when user sends a restaurant link.

## Step 1: Resolve the Location
If user sends a Google Maps short URL (`maps.app.goo.gl/...`):
```bash
curl -sI -o /dev/null -w '%{redirect_url}' "<short_url>"
```
Extracts the full Google Maps URL with restaurant name, address, and place ID.

## Step 2: Try the Official Site
Common URL patterns:
- `https://<restaurant-domain>/menu`
- `https://<restaurant-domain>/<city>/menu`
- `https://<restaurant-domain>/order-online`

**If blocked (Wordfence/Cloudflare) — skip immediately.** Restaurants commonly use aggressive WAFs that block curl/bots. Don't retry the domain.

### Step 2a: Extract JSON-LD Structured Data
Many restaurant sites (BentoBox, Squarespace, Toast) embed full menus as `application/ld+json` with `@type: Menu`. Extract it from the HTML before falling back to visible-text scraping:

```python
import re, json

# After fetching page HTML into `html`
matches = re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL)
for block in matches:
    try:
        data = json.loads(block)
        if isinstance(data, dict) and data.get('@type') == 'Menu':
            print(json.dumps(data, indent=2))
            break
    except json.JSONDecodeError:
        continue
```

The JSON-LD `hasMenuSection` → `hasMenuItem` structure gives you dish names, descriptions, prices, and `suitableForDiet` tags — much more reliable than parsing visible HTML. This works even when the visual page is JS-rendered; the JSON-LD is typically server-rendered in the `<head>`.

Menu sections are often scoped (e.g., `"name": "Dinner"`, `"name": "Brunch"`) — filter to the relevant meal period.

## Step 3: Try Ordering Platforms
- ToastTab: `https://www.toasttab.com/<restaurant-slug>/v3`
- DoorDash store pages
- Uber Eats store pages
- Grubhub/Seamless

These may also be Cloudflare-protected. If so, move on.

## Step 4: Search for Menu Content via DDGS + Review Platforms\n\n**DDGS (Python library) is the most reliable search approach** when websites block direct access. DDG lite HTML sometimes returns empty results — prefer the Python library:\n\n```bash\npip install ddgs       # in a venv to avoid system package conflicts\n```\n\n```python\nfrom ddgs import DDGS\nresults = list(DDGS().text(\"<restaurant> <dish> menu calories reviews\", max_results=10))\nfor r in results:\n    print(r[\"title\"], r[\"body\"], r[\"href\"])\n```\n\n**Write DDGS scripts to a temp file** — inline `python3 -c` with quoted search strings hits shell escaping issues.\n\n### Key platforms that host menu details (prioritize these):\n- **OpenTable** — often lists full menus with prices and dish descriptions in search result snippets\n- **Yelp** — user-submitted menu photos and review descriptions\n- **TripAdvisor** — review snippets mention specific dishes\n- **TikTok** — menu item names and descriptions in video captions\n- **Allmenus.com / res-menu.net** — dedicated menu mirror sites\n\nExample: `site:opentable.com \"<restaurant>\" \"grilled chicken\" calories` will surface OpenTable pages that list mains with descriptions and prices.

## Step 5: Known Chain Fallback
If the restaurant is a well-known chain with consistent menu across locations, use general knowledge. **Always disclose** when estimates are from general knowledge vs. scraped data. Mark confidence level.

Example: Ruby Sunshine, Cava, Sweetgreen, Chipotle — menus are standardized enough for reasonable estimates.

## Step 6: Component-Based Estimate
Break the dish into components (protein + carb + fat + sauce) and estimate each. Restaurant meals are typically 30-50% higher than homemade equivalents due to butter/oil/portion size.
