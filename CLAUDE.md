# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `@limulus/media-tools` - a collection of Node.js-based tools for video production, transcription, and HTTP Live Streaming (HLS) preparation. The project is macOS-specific and requires professional Apple tools.

## Essential Commands

### Setup
```bash
npm install
./setup.sh  # Downloads and builds whisper.cpp with CoreML optimization
```

### Development Commands
```bash
npm run clean          # Remove local directory and cache
npm run test          # No tests configured
npx eslint .          # Lint JavaScript files  
npx prettier --write . # Format code
```

### Core Tools
```bash
# HLS preparation (main workflow)
node bin/hls-prep.js /path/to/video/directory

# Audio transcription 
node bin/whisper.js video.mov --track 0

# Caption conversion
node bin/itt-to-webvtt.js captions.itt --fps 30
```

## Architecture Overview

### Core Workflow
This project implements a professional video production pipeline:

1. **Encoding**: Drop videos onto `Applications/Encode for HLS.app` (Compressor droplet)
2. **Asset Preparation**: Add `poster.jpeg` and `en-us.vtt` to output directory
3. **HLS Processing**: Run `bin/hls-prep.js` to create streaming manifests and segments
4. **Deployment**: Upload generated ULID directory to `vod.limulus.net`

### Key Components

**`/bin/` - Command Line Tools**
- `hls-prep.js` - Main tool for HLS streaming preparation using Apple's HLS tools
- `whisper.js` - Audio transcription using whisper.cpp with CoreML optimization
- `itt-to-webvtt.js` - Converts Final Cut Pro ITT captions to WebVTT

**`/Applications/Encode for HLS.app/` - Compressor Integration**
- Complete macOS Compressor droplet with encoding presets
- HEVC/AVC encoders at multiple resolutions (540p through 2160p/4K)
- AAC audio encoding with different bitrates
- Supports 10-bit color depth and adaptive bitrate streaming

**`/local/whisper.cpp/` - Transcription Engine**
- Complete whisper.cpp installation with large-v2 model
- CoreML-optimized for Mac hardware acceleration
- Automatically set up by `setup.sh`

### Technology Stack

**Runtime**: Node.js with ES modules (`"type": "module"`)

**Key Dependencies**:
- `fast-xml-parser`, `xml2js` - XML processing for captions
- `ulid` - Unique directory naming for HLS outputs
- `pkg-dir` - Package directory resolution

**Required External Tools**:
- macOS Compressor app
- Apple HTTP Live Streaming Tools (mediafilesegmenter, variantplaylistcreator, mediasubtitlesegmenter)
- whisper.cpp (installed via setup.sh)

### Code Patterns

**Error Handling**: Uses async/await with try/catch blocks
**File Processing**: Streams and promises for media file operations  
**Configuration**: XML-based Compressor settings, JSON for package configuration
**IDs**: ULID generation for unique HLS directory names

### Development Notes

- **ES Modules**: All JavaScript uses import/export syntax
- **No TypeScript**: Pure JavaScript project (TypeScript only used for dev tooling)
- **No Tests**: Rapid development approach without formal testing
- **macOS Specific**: Requires Xcode, Compressor, and HLS Tools
- **Single Workflow**: Optimized for author's specific video production needs

### Transcription Features

- **Multi-track Support**: `--track` option for specific audio tracks
- **Format Conversion**: Automatic conversion to 16kHz WAV for whisper.cpp
- **CoreML Optimization**: Hardware-accelerated transcription on Mac
- **WebVTT Output**: Direct WebVTT caption generation

### HLS Features

- **Multi-variant Streaming**: Automatic generation of adaptive bitrate manifests
- **Modern Codecs**: Both H.264 and H.265/HEVC support
- **4K/HDR Ready**: Up to 2160p with 10-bit color depth
- **Subtitle Integration**: Automatic subtitle segmentation and manifest creation
- **Professional Quality**: Uses Apple's professional HLS tools