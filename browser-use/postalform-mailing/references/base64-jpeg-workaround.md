# Base64 JPEG PDF Workaround

When upload tokens are blocked (consumed, rate-limited, or stale SPTs), base64 data URL is the only alternative PDF submission path. The main blocker is PostalForm/Cloudflare's ~2MB request body limit (HTTP 413).

## Solution: JPEG Compression Pipeline

Ghibli-style PNG artwork (1.5-1.8MB) balloons WeasyPrint PDFs to ~1.7MB. Base64-encoding pushes that to ~2.3MB — over the limit.

Convert artwork PNGs to JPEG before embedding in HTML, then re-render PDF:

```python
from PIL import Image
from weasyprint import HTML
import fitz

# 1. Convert Ghibli PNG to JPEG
img = Image.open("artwork.png")
if img.mode in ('RGBA', 'P'):
    img = img.convert('RGB')
img.save("artwork.jpg", 'JPEG', quality=85)

# 2. Re-render HTML with JPEG
html = '''<!DOCTYPE html>
<html><head><style>
@page { size: 6.25in 4.25in; margin: 0; }
body { width: 6.25in; height: 4.25in; overflow: hidden; }
.photo-area img { width: 6.25in; height: 4.25in; object-fit: cover; }
</style></head>
<body>
<div class="photo-area"><img src="artwork.jpg"></div>
</body></html>'''

HTML(string=html).write_pdf("card-jpg.pdf")

# 3. Verify size (should be ~200-250KB vs 1.7MB original)
import os
size = os.path.getsize("card-jpg.pdf")
print(f"{size:,} bytes — base64: ~{size*4//3:,} chars")
```

## Size Comparison

| Card | PNG PDF | JPEG PDF | Reduction |
|------|---------|----------|-----------|
| Abhinav | 1,754 KB | 218 KB | 88% |
| Hemil | 1,873 KB | 233 KB | 88% |
| Siddharth | 1,634 KB | 170 KB | 90% |
| Utkarsh | 1,675 KB | 214 KB | 87% |

Base64 of 233KB PDF ≈ 311KB chars — well under 413 limit.

## Quality

JPEG quality=85 is visually indistinguishable from PNG at card size. Ghibli watercolor aesthetic is forgiving of JPEG artifacts.

## Integration with MPP Flow

```python
import base64

with open("card-jpg.pdf", "rb") as f:
    pdf_b64 = base64.b64encode(f.read()).decode()

payload = {
    "pdf": f"data:application/pdf;base64,{pdf_b64}",
    # ... other fields
}

# Save to file to avoid ARG_MAX
with open("payload.json", "w") as f:
    json.dump(payload, f)

# Step 1: Get 402 challenge
# curl -s -D headers.txt -d @payload.json https://postalform.com/api/machine/mpp/orders

# Step 2: Generate mppx auth with challenge + SPT
# node /tmp/mppx_gen.js "<stripe_challenge>" "spt_..."

# Step 3: Retry with Authorization
# curl -s -H "Authorization: <auth>" -d @payload.json https://postalform.com/api/machine/mpp/orders
```

## Edge Cases

- **Rotated photos**: Apply rotation BEFORE JPEG conversion (PIL's `img.rotate(-90, expand=True)` on the PNG, then save as JPEG)
- **Very large artwork**: Try quality=75 if still over limit
- **6x9 cards**: Larger canvas means larger PDF — JPEG compression becomes even more important
