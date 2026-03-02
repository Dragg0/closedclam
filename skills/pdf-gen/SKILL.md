---
name: pdf-gen
description: "Generate professional branded PDFs from markdown files"
version: "1.0.0"
author: "closedclam"
tags: ["pdf", "document", "markdown", "dental"]
requirements:
  tools: ["markdown_to_pdf"]
alwaysActive: false
---

# PDF Generation Skill

When the user asks you to create a PDF, generate a document, or convert markdown to PDF:

1. **Write the markdown first** using `write_file` to create a well-structured `.md` file in the workspace. Use proper headings, tables, lists, and formatting.

2. **Convert to PDF** using the `markdown_to_pdf` tool with appropriate branding.

## Default Branding for River Crossing Family Dental

When generating documents for the dental practice, use these defaults unless told otherwise:
- `practiceName`: "River Crossing Family Dental"
- `practiceSubtitle`: Set to the document type (e.g., "Staff Training Guide", "Treatment Plan Overview")
- `footer`: "River Crossing Family Dental — Confidential"

## IMAGE: Placeholders

To embed AI-generated images in the PDF, use this syntax in the markdown:

```
![description](IMAGE:detailed prompt for the image)
```

Set `generateImages: true` when calling the tool. Example:

```markdown
## Our Facility

![Modern dental office](IMAGE:A bright, modern dental office reception area with comfortable chairs, warm lighting, and a friendly atmosphere, photorealistic)
```

## Tips

- Keep markdown well-structured with clear heading hierarchy (H1 for title, H2 for sections, H3 for subsections)
- Use tables for structured data (schedules, comparisons, pricing)
- Use blockquotes for important notes or callouts
- Image generation adds time — only use `generateImages: true` when the markdown actually contains `IMAGE:` placeholders
- The PDF is automatically sent in the Telegram chat AND saved to disk
