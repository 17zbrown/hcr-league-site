# Hero background clips

Drop your own race video clips here to play behind the home hero.

- Filenames: `hero-1.mp4`, `hero-2.mp4`, `hero-3.mp4` (multiple clips cycle automatically).
- Format: **MP4 (H.264)**, muted, ~8–15s each, 1080p or 720p, a few MB each (keep them
  small so the page loads fast). `.webm` also works if you rename the list in
  `src/components/HeroVideo.tsx`.
- Use **your own league footage / broadcasts** — do not use copyrighted IMSA TV footage.
- If no clips are present here, the hero automatically falls back to the animated 3D logo.

To change how many clips or their names, edit the `CLIPS` array in
`src/components/HeroVideo.tsx`.
