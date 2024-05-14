#!/usr/bin/env bash

if [ -d "local" ]; then
  echo "Setup has already been run. Exiting."
  exit 1
fi

mkdir -p ./.cache
curl -Lo ./.cache/whisper.cpp.tar.gz https://github.com/ggerganov/whisper.cpp/archive/refs/tags/v1.5.5.tar.gz

mkdir -p local/whisper.cpp
tar -xzf ./.cache/whisper.cpp.tar.gz -C local/whisper.cpp --strip-components=1

# Install Whisper
cd local/whisper.cpp

# Download the Whisper model
./models/download-ggml-model.sh large-v2

# Create a virtual environment in the local directory
if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo "Virtual environment created."
fi

# Activate the virtual environment
source venv/bin/activate

# Install the required packages
pip3 install ane_transformers
pip3 install openai-whisper
pip3 install coremltools

# Convert the Whisper model to CoreML
./models/generate-coreml-model.sh large-v2

# Deactivate the virtual environment
deactivate

# Build whisper.cpp
WHISPER_COREML=1 make -j

# Return to the root directory
cd ../..
