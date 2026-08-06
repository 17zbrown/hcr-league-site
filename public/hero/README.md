# Hero footage

Two encodes of the same clip, played by `src/components/HeroVideo.tsx` — muted,
looping, cover-cropped, behind a curtain that lifts once playback actually starts
(tire-smoke canvas otherwise).

| file | size | what gets it |
| --- | --- | --- |
| `hero-1.mp4` | 960x544, 70s, ~42MB | screens ≥640px |
| `hero-1-mobile.mp4` | 640x362, 15s, ~4.6MB | screens <640px |

**Why two.** 42MB is far too much to push at a phone on cellular, so phones used to
be excluded outright and shown the smoke hero — which made the site look like two
different products depending on the device. The phone encode is short *and* small:
it loops, and nobody watches a hero to the end, so 15 seconds reads the same as 70.

Save-Data and 2G connections still get no video at all, on any screen size, and
`prefers-reduced-motion` gets a settled haze. Someone who has asked their browser to
conserve data means it, and 4.6MB is not an exception to that.

## Swapping the clip

Replace both files, keeping both names. On a Mac without ffmpeg, `avconvert` is
built in:

```bash
avconvert --preset Preset960x540 --source in.mov --output hero-1.mp4 --replace
avconvert --preset Preset640x480 --start 0 --duration 15 \
          --source in.mov --output hero-1-mobile.mp4 --replace
```

Check the mobile file afterwards — keep it under about 5MB. `avconvert` has no
bitrate control, so the lever is `--duration`: the size scales with it more or less
linearly. `PresetAppleM4VCellular` gets to ~1.9MB for the full clip but drops to
400px wide, which is visibly soft on a retina phone; the 15-second 640px cut looks
considerably better for roughly the same download.
