# Test fixtures

Every file here is generated, so nothing in this directory carries a third party's copyright.
Regenerate a fixture with the command beside it rather than replacing it with a found file.

## `video.mp4`

One second of FFmpeg's built-in `testsrc` pattern: 320x180, 12 fps, H.264 Baseline, no audio.
The attachment tests assert the 320x180 poster size, so keep the dimensions.

```sh
ffmpeg -y -f lavfi -i testsrc=size=320x180:rate=12:duration=1 \
  -c:v libopenh264 -profile:v constrained_baseline -pix_fmt yuv420p -an \
  -movflags +faststart -fflags +bitexact -flags:v +bitexact -map_metadata -1 \
  e2e/fixtures/video.mp4
```
