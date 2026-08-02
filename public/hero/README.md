# Hero footage

`hero-1.mp4` is the self-hosted hero background (H.264, 960x540, ~42MB), played
by `src/components/HeroVideo.tsx` — muted, looping, cover-cropped, behind a
curtain that lifts once playback actually starts (tire-smoke canvas otherwise).

Small screens (<640px), Save-Data and 2G connections skip the download and get
the animated smoke hero instead; `prefers-reduced-motion` gets a settled haze.

To swap the clip: replace `hero-1.mp4` (keep the name) with H.264 MP4. On a Mac
without ffmpeg: `avconvert --preset Preset960x540 --source in.mov --output hero-1.mp4`.
