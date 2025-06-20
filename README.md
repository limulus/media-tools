# @limulus/media-tools

Various scrappy tools for media production.

> :warning: This repository is made up of scripts that I have cobbled together to aid in
> producing videos for my [website]. They were made quickly with LLM assistance with minimal
> concern for maintainability. They are meant to run on a Mac with [Node.js], [Xcode],
> [Compressor], and [HTTP Live Streaming Tools].

[website]: https://limulus.net/
[node.js]: https://nodejs.org/
[xcode]: https://developer.apple.com/xcode/
[compressor]: https://www.apple.com/final-cut-pro/compressor/
[http live streaming tools]: https://developer.apple.com/documentation/http-live-streaming/using-apple-s-http-live-streaming-hls-tools

## Setup

Run these commands:

```bash
npm install
./setup.sh
```

The `setup.sh` script will download and set up [whisper.cpp]. The Whisper model is a large
file, so beware of doing this on a metered connection.

[whisper.cpp]: https://github.com/ggerganov/whisper.cpp

## Transcribing Video

The `bin/whisper.js` script can be used to transcribe video files in WebVTT format. It will
first extract the audio to a WAV file that will work with whisper.cpp.

The `--track` option can be used to specify the track number to transcribe. I use this
because I record with OBS set up to record a separate audio track for my microphone that
does have noise gate or other filters applied. Interestingly, the Whisper model seems to be
faster at transcribing when there is some background noise and a bit less prone to repeating
the last phrase over and over.

## Convert Captions From Final Cut Pro

The iTunes Text Timing format that FCP produces is a better match for the WebVTT format. The
`bin/itt-to-webvtt.js` script will do some basic conversion of `.itt` files to WebVTT.

## Preparing a Video for HTTP Live Streaming

Once you have a master 4K ProRes video ready for distribution, follow these steps to prepare
it for being served via HLS:

1. Drop it onto `Applications/Encode for HLS.app` to create a directory of MP4 files of
   various encodings.
2. Create a `poster.jpeg` file in that directory to serve as the video’s poster image.
3. Create an `subs-en-us.vtt` file in that directory to serve as captions for the video.
   (Check out the `bin/itt-to-webvtt.js` script if creating captions in FCP.)
4. WebVTT metadata tracks must be pre-segmented. The [tcx2webvtt] tool’s `--hls` option will
   do this for you. Place them in the directory with a `meta-` prefix.
5. Run `./bin/hls-prep.js DIR` to create HLS manifest M3U8 files and segments.
6. A new directory will be created inside that directory with a ULID. Upload this directory
   to vod.limulus.net.

[tcx2webvtt]: https://github.com/limulus/tcx2webvtt

### Subtitle Track Naming

Create subtitle files in your video directory using these naming conventions:

- `en-us.vtt` - English (US) subtitles (legacy format)
- `subs-en.vtt` - English subtitles (new format)
- `subs-es.vtt` - Spanish subtitles
- `subs-fr.vtt` - French subtitles

Use `bin/itt-to-webvtt.js` to convert Final Cut Pro ITT captions to WebVTT format.

### Complete Directory Structure Example

```
my-video/
├── avc-1080p.mov           # Video files (multiple resolutions)
├── hevc-2160p.mov
├── aac-lc-128.m4a          # Audio file
├── poster.jpeg             # Video poster image
├── subs-en-us.vtt          # English subtitle track
├── subs-es.vtt             # Spanish subtitle track
└── meta-eric/              # Biometric/location metadata track
    ├── index.m3u8          # HLS playlist for metadata
    ├── seg-00001.webvtt    # First metadata segment
    ├── seg-00002.webvtt    # Second metadata segment
    └── ...                 # Additional segments
```

The HLS preparation script will automatically:

- Process all subtitle files and include them in the HLS manifest
- Copy metadata directories to the output and reference them in the manifest
- Generate appropriate `EXT-X-MEDIA` entries for both subtitles and metadata tracks
