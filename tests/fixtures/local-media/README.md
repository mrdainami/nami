# Synthetic local video fixtures

These four-second, 320×180 test patterns are generated from FFmpeg's `testsrc2` filter. They contain no user media or audio. No FFmpeg installation is required to run the tests.

Generation commands:

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -t 4 -c:v libx264 -crf 28 -pix_fmt yuv420p -movflags +faststart clip.mp4
ffmpeg -i clip.mp4 -c copy clip-end.mp4
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -t 4 -c:v libvpx-vp9 -b:v 180k clip.webm
```

`clip.mp4` has its MP4 metadata at the beginning; `clip-end.mp4` has metadata at the end. Both must load and seek correctly through the local document protocol. `clip.webm` exercises a different container and codec.

Run the actual Nami media integration from the repository root:

```sh
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/browser-local-media.cjs
```
