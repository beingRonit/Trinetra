<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8ef2201d-2d27-4ca0-b33a-cc46f2c6f598

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set frontend env values in [.env.local](.env.local)
3. Run the app:
   `npm run dev`
4. Open:
   `http://localhost:3000/`

## Base Path

- Default dev and preview path is `/`
- To build for a nested deployment path like `/frontend/`, run:
  `npm run build:frontend`
