---
name: nyc-parks-events
description: Scrape NYC Parks event pages (movies, concerts, fitness) — extract embedded eventsByLocationJSON, parse structured event data, filter by borough.
version: 1.0.0
metadata:
  hermes:
    tags: [nyc, parks, events, scraping, json-extraction]
    category: productivity
---

# NYC Parks Events Scraper

Scrape event data from NYC Parks event listing pages (Free Summer Movies, concerts, fitness, etc.) by extracting the embedded `eventsByLocationJSON` JavaScript variable.

## When to Use

- User asks to scrape NYC Parks events (movies, concerts, fitness, etc.)
- URL pattern: `https://www.nycgovparks.org/events/*`
- Need structured event data (title, date, time, location, borough) from a dynamic page

## Procedure

### 1. Download Full Page

NYC Parks pages are dynamic — the full event JSON is embedded in inline JavaScript. Download with a browser User-Agent:

```bash
curl -sS -L -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://www.nycgovparks.org/events/free_summer_movies" -o page.html
```

Verify file size — should be 180KB+ for a full event listing. Files under 60KB are truncated.

### 2. Extract eventsByLocationJSON

The data lives in inline JS as `var eventsByLocationJSON = [...];`. Load `scripts/extract.py` for the battle-tested extraction script. Usage:

```bash
python3 scripts/extract.py page.html /tmp/movie_events.json
```

Key pitfalls:
- The JSON contains escaped characters (`\"`, `\\`) — use `json_parse()` with `strict=False`
- Naive bracket matching fails on escaped quotes in location names (e.g., `Phil \"Scooter\" Rizzuto Park`)
- The extraction script handles this by finding the outer `[`...`]` brackets with a state machine

### 3. Parse Event Fields

Each event object:
```json
{
  "title": "Movies Under the Stars: Zootopia 2",
  "start": "2026-07-10T20:00:00-04:00",
  "end": "2026-07-10T21:30:00-04:00",
  "link": "https://www.nycgovparks.org/events/2026/07/10/movies-under-the-stars-zootopia-2",
  "location": "Peter's Field, E. 20 St. To E. 21 St., 1 Ave. To 2 Ave., Manhattan",
  "borough": "Manhattan"
}
```

Borough is the last comma-separated segment of `location`. Some events have blank borough — treat these as valid (not Bronx/Staten Island).

### 4. Filter by Borough

```python
# Exclude Bronx and Staten Island
filtered = [e for e in events if e['borough'] not in ('Bronx', 'Staten Island')]
# Blank borough is kept
```

## Handoff to Calendar Invites

Output from this skill feeds directly into `calendar-invites` skill:
1. Write filtered events to `/tmp/movie_events.json`
2. Load `calendar-invites` skill
3. Generate ICS files → send test → batch

## Pitfalls

- **Truncated download** — first `curl` attempt may truncate mid-page (50-60KB). Re-download if filesize < 100KB.
- **`\"` in location names** — `Phil \"Scooter\" Rizzuto Park` breaks naive JSON parsers. Use `scripts/extract.py`.
- **Page blocked by CloudFront** — individual event pages return 403 from CloudFront. Use the listing page JSON; don't try to scrape detail pages.
- **Empty borough field** — some events have no borough listed. These are NOT Bronx/Staten Island; they pass the filter.
