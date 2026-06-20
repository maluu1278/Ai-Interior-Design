AI Interior Design - Full Graduation Project Version

How to run:
1. Open terminal in this folder.
2. Run: npm install
3. Run: node server.js
4. Open: http://localhost:3000

What is included:
- Real AI generation using Pollinations by default.
- Optional OpenAI or Hugging Face provider through .env.
- Login and signup backend.
- Backend JSON database in data/db.json.
- Saved design history per user.
- Generated images saved in public/generated.
- Uploaded room photos saved in public/uploads.
- Dashboard with search, filters, favourites, view and delete.
- Before/after result page with comparison slider.
- Download, share, copy prompt, generate another version.
- Form validation, image preview, loading overlay and error handling.
- Dark/light mode toggle.
- Contact form saved to the backend database.
- Rate limiting and image upload validation.

Default free provider:
AI_PROVIDER=pollinations

Important note:
Pollinations is free text-to-image generation. It creates a real generated image, but it is not perfect image-to-image preservation. For stronger same-room transformation, use an image-to-image paid/free-trial API such as Replicate, Stability, or OpenAI image editing.
