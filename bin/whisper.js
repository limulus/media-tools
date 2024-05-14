#!/usr/bin/env node

import { XMLParser } from 'fast-xml-parser'
import { spawn } from 'node:child_process'
import { rename, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { packageDirectory } from 'pkg-dir'

const [, , ...files] = process.argv
const wavFiles = []

for (let file of files) {
  try {
    let needsConversion = false
    const output = await run('file', [file])
    if (!output.includes('WAV')) {
      needsConversion = true
    } else {
      const output = await run('afinfo', ['-x', file])
      const xml = new XMLParser().parse(output)
      console.log(`Evaluating ${file}`)
      if (xml.audio_info.audio_file.tracks.track.sample_rate !== 16000) {
        needsConversion = true
      }
    }

    if (needsConversion) {
      console.log(`Converting ${file} to 16kHz WAV...`)
      const wavFile = `${noExtension(file)}.wav`
      await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', file, wavFile])
      file = wavFile
    }

    wavFiles.push(file)
  } catch (error) {
    throw new Error(`Error processing file ${file}: ${error.message}`)
  }
}

const whisperDir = join(
  await packageDirectory({ cwd: new URL(import.meta.url) }),
  'local',
  'whisper.cpp'
)
await runWithPassThrough(join(whisperDir, 'main'), [
  '-ovtt',
  '-m',
  join(whisperDir, 'models', 'ggml-large-v2.bin'),
  ...wavFiles,
])

// Replace `.wav.vtt` with `.vtt` in the output files
await Promise.all(
  wavFiles.map(async (file) => {
    await rename(`${file}.vtt`, `${basename(file, '.wav')}.vtt`)
  })
)

// Remove the temporary WAV files
await Promise.all(wavFiles.map((file) => unlink(file)))

function run(command, args) {
  console.log(`Running: ${command} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, args, { stdio: 'pipe' }) // Use 'pipe' option to capture output

    let output = '' // Variable to store the command output

    cmd.stdout.on('data', (data) => {
      output += data.toString() // Append the output to the variable
    })

    cmd.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
        return
      }
      resolve(output) // Resolve the promise with the captured output
    })
  })
}

function runWithPassThrough(command, args) {
  console.log(`Running: ${command} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, args, { stdio: 'inherit' }) // Use 'inherit' option to pass through output

    cmd.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
        return
      }
      resolve() // Resolve the promise without any output
    })
  })
}

function noExtension(file) {
  return basename(file, extname(file))
}
