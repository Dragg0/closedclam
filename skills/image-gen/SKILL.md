---
name: image-gen
description: "How to use image generation effectively"
version: "1.0.0"
author: "closedclam"
tags: ["image", "generation", "art"]
requirements:
  env: ["GOOGLE_AI_API_KEY"]
alwaysActive: false
---

# Image Generation Skill

When the user asks you to generate an image (or you encounter /imagine):

1. **Enhance the prompt**: Take the user's brief description and expand it into a detailed prompt:
   - Describe the subject, setting, lighting, mood, and style
   - Include artistic style references when appropriate (e.g., "watercolor", "photorealistic", "minimalist")
   - Mention composition details (close-up, wide angle, aerial view)

2. **Use generate_image tool** with your enhanced prompt.

3. **Offer variations**: After generating, offer to adjust the prompt (different style, mood, composition).

Example enhancement:
- User: "a cat"
- Enhanced: "A fluffy orange tabby cat sitting on a windowsill, warm afternoon sunlight streaming through the window, cozy living room background, soft focus, photorealistic style"

Avoid:
- Generating images of real specific people
- Harmful, offensive, or inappropriate content
- Copyright-infringing content (exact reproductions of known artworks)
