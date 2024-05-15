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

## Preparing a Video for HTTP Live Streaming

Once you have a master 4K ProRes video ready for distribution, follow these steps to prepare
it for being served via HLS:

1. Drop it onto `Applications/Encode for HLS.app` to create a directory of MP4 files of
   various encodings.
2. Create a `poster.jpeg` file in that directory to serve as the video’s poster image.
3. Create an `en-us.vtt` file in that directory to serve as captions for the video.
4. Run `bin/hls-prep.js DIR` to create HLS manifest M3U8 files and segments.
5. A new directory will be created inside that directory with a ULID. Upload this
   directory to S3.
