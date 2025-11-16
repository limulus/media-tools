#!/usr/bin/env bash

set -e  # Exit on error

# Check for required dependencies
if ! command -v cmake &> /dev/null; then
    echo "Error: cmake is not installed."
    echo "Please install cmake first:"
    echo "  brew install cmake"
    echo "or download from https://cmake.org/download/"
    exit 1
fi

if [ -d "local" ]; then
  echo "Setup has already been run. Exiting."
  exit 1
fi

mkdir -p ./.cache
curl -Lo ./.cache/whisper.cpp.tar.gz https://github.com/ggerganov/whisper.cpp/archive/refs/tags/v1.8.1.tar.gz

mkdir -p local/whisper.cpp
tar -xzf ./.cache/whisper.cpp.tar.gz -C local/whisper.cpp --strip-components=1

# Install Whisper
cd local/whisper.cpp

# Download the Whisper model (standard GGML format)
./models/download-ggml-model.sh large-v3

# Download VAD model for voice activity detection
echo "Downloading VAD model for silence detection..."
./models/download-vad-model.sh silero-v5.1.2

# Download pre-built CoreML model from HuggingFace
echo "Downloading pre-built CoreML model from HuggingFace..."
COREML_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-encoder.mlmodelc.zip"
COREML_MODEL_ZIP="models/ggml-large-v3-encoder.mlmodelc.zip"

if curl -L -o "$COREML_MODEL_ZIP" "$COREML_MODEL_URL"; then
    echo "CoreML model downloaded successfully. Extracting..."
    cd models
    unzip -q ggml-large-v3-encoder.mlmodelc.zip
    rm ggml-large-v3-encoder.mlmodelc.zip
    cd ..
    echo "CoreML model ready!"
    COREML_ENABLED=1
else
    echo "WARNING: Failed to download pre-built CoreML model."
    echo "Whisper will still work, but without CoreML hardware acceleration."
    COREML_ENABLED=0
fi

# Build whisper.cpp
if [ "$COREML_ENABLED" -eq 1 ]; then
    echo "Building whisper.cpp with CoreML support..."
    WHISPER_COREML=1 make -j
else
    echo "Building whisper.cpp without CoreML support..."
    make -j
fi

# Return to the root directory
cd ../..
