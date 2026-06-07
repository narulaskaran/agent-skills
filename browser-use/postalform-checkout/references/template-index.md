# PostalForm Template Index

50 templates available at `/postcards`. Data extracted from Inertia.js `data-page` props (May 8, 2026).

## Categories
- **Events** (holiday, event invitations)
- **Local Business** (promotions, announcements)
- **Nonprofit** (fundraising, thank-you)
- **Personal** (birthday, thank-you, sympathy)
- **Real Estate** (just listed, open house)

## Template Data Structure
```json
{
  "templateId": <int>,
  "sourceDir": "<dir-name>",
  "category": "<category>",
  "templateName": "<display name>",
  "primaryUseCase": "<description>",
  "recommendedSize": "4x6|6x9",
  "sizeKey": "4x6|6x9",
  "tone": "neutral",
  "tags": ["tag1", "tag2"],
  "keyFields": ["to_name", "from_name", "message", ...],
  "thumbnailUrl": "/postcards/<id>/thumbnail",
  "frontImageUrl": "/postcards/<id>/front",
  "backImageUrl": "/postcards/<id>/back"
}
```

## Subset (first 5 of 50)
| ID | Name | Category | Size | Tags |
|----|------|----------|------|------|
| 1 | Thank You (Simple) | Personal | 4x6 | thank-you, personal |
| 2 | Birthday (Fun) | Personal | 4x6 | birthday, personal |
| 3 | Anniversary | Personal | 4x6 | anniversary, personal |
| 4 | New Baby Congrats | Personal | 4x6 | baby, congrats |
| 5 | Graduation Congrats | Personal | 4x6 | graduation, congrats |

Full 50-template list is in the `data-page` JSON of `https://postalform.com/postcards`.

## Image URLs
- Thumbnail: `https://postalform.com/postcards/{id}/thumbnail`
- Front: `https://postalform.com/postcards/{id}/front`
- Back: `https://postalform.com/postcards/{id}/back`

## For Custom Card Art
When uploading a custom PDF (from `postalform-mailing` skill), template choice is irrelevant — pick any template. The uploaded PDF replaces the template artwork.
