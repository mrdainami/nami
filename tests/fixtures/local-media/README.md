# Synthetic local video fixtures

These four-second, 320×180 test patterns are generated from FFmpeg's `testsrc2` filter. They contain no user media. The `clip-audio` variants include quiet synthetic tones; the other clips are silent. No FFmpeg installation is required to run the tests.

Generation commands:

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -t 4 -c:v libx264 -crf 28 -pix_fmt yuv420p -movflags +faststart clip.mp4
ffmpeg -i clip.mp4 -c copy clip-end.mp4
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -t 4 -c:v libvpx-vp9 -b:v 180k clip.webm
ffmpeg -i clip.mp4 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=4 -map 0:v -map 1:a -c:v copy -c:a aac -b:a 64k -af 'volume=0.25,afade=t=in:d=0.1,afade=t=out:st=3.8:d=0.2' -shortest -movflags +faststart clip-audio.mp4
ffmpeg -i clip.webm -f lavfi -i sine=frequency=660:sample_rate=48000:duration=4 -map 0:v -map 1:a -c:v copy -c:a libopus -b:a 48k -af 'volume=0.25,afade=t=in:d=0.1,afade=t=out:st=3.8:d=0.2' -shortest clip-audio.webm
```

`clip.mp4` has its MP4 metadata at the beginning; `clip-end.mp4` has metadata at the end. Both must load and seek correctly through the local document protocol. `clip.webm` exercises a different container and codec.

The audio variants cover AAC in MP4 and Opus in WebM. The integration verifies decoded audio bytes and Electron's audible-output state, including mute/unmute and sound after seeking/replaying, in browser tabs and saved HTML previews. It does not inspect the user's system volume or speaker routing.

Run the actual Nami media integration from the repository root:

```sh
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/browser-local-media.cjs
```
