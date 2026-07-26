"""
Extract eventsByLocationJSON from NYC Parks HTML pages.
Handles escaped quotes in location names (e.g., Phil \"Scooter\" Rizzuto Park).
"""
import json, re, sys

def extract_events(html_path):
    with open(html_path, 'r') as f:
        html = f.read()
    
    # Find the start of eventsByLocationJSON
    marker = 'eventsByLocationJSON'
    idx = html.find(marker)
    if idx == -1:
        raise ValueError(f"'{marker}' not found in HTML")
    
    # Find the opening bracket after the marker
    bracket_start = html.find('[', idx)
    if bracket_start == -1:
        raise ValueError("Opening bracket not found after marker")
    
    # State-machine bracket matcher — handles escaped quotes
    depth = 0
    in_string = False
    escape_next = False
    pos = bracket_start
    
    while pos < len(html):
        c = html[pos]
        
        if escape_next:
            escape_next = False
            pos += 1
            continue
        
        if c == '\\':
            escape_next = True
            pos += 1
            continue
        
        if c == '"' and not escape_next:
            in_string = not in_string
        elif not in_string:
            if c == '[' or c == '{':
                depth += 1
            elif c == ']' or c == '}':
                depth -= 1
                if depth == 0:
                    break
        pos += 1
    
    if depth != 0:
        raise ValueError(f"Bracket matching failed (depth={depth} at pos={pos})")
    
    raw_json = html[bracket_start:pos + 1]
    
    # Parse with strict=False to handle stray escapes
    events = json.loads(raw_json, strict=False)
    
    # Extract structured fields
    result = []
    for evt in events:
        # Some events use 'field_' prefixed keys
        title = evt.get('title', evt.get('field_title', ''))
        start = evt.get('start', evt.get('field_date_value', ''))
        end = evt.get('end', '')
        link = evt.get('link', evt.get('field_link', ''))
        location = evt.get('location', '')
        
        if not start:
            continue
        
        # Derive borough from location (last comma-separated segment)
        borough = ''
        if location:
            parts = [p.strip() for p in location.split(',')]
            borough = parts[-1] if parts else ''
        
        result.append({
            'title': title,
            'start': start,
            'end': end or start,
            'link': link,
            'location': location,
            'borough': borough
        })
    
    return result


if __name__ == '__main__':
    events = extract_events(sys.argv[1])
    with open(sys.argv[2], 'w') as f:
        json.dump(events, f, indent=2)
    print(f"Extracted {len(events)} events → {sys.argv[2]}")
