# Social Video Pipeline

This repo now treats every generated post as a source for a reusable social package.

## Flow

1. Generate or import posts in the admin.
2. Select posts in the `글` tab or `숏츠` tab.
3. Queue `social_generate`.
4. Run the worker with `npm run worker:once`.
5. Review the generated card-news package in the `숏츠` tab.
6. Queue `video_render` to write a Remotion manifest under `exports/social/<tenant>/`.
7. Render MP4 after installing renderer dependencies:

```bash
npm --prefix apps/video-renderer install
npm run render:shorts -- --input exports/social/<tenant>/<package>.render.json
```

## Current Boundary

The first implementation creates cards, script, caption, hashtags, and Remotion-ready manifests. Direct Instagram, YouTube, TikTok, or Naver publishing is intentionally not enabled yet because those APIs need channel auth, app review, and account-specific policies.
