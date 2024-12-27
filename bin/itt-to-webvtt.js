#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseStringPromise } from 'xml2js'

const [, , ittFilePath, ...args] = process.argv

if (!ittFilePath) {
  console.error('Usage: itt-to-webvtt <path-to-itt-file> [--fps <frames-per-second>]')
  process.exit(1)
}

const fpsArgIndex = args.indexOf('--fps')
const fps = fpsArgIndex !== -1 ? parseInt(args[fpsArgIndex + 1], 10) : 30

const ittContent = await readFile(ittFilePath, 'utf8')
const ittJson = await parseStringPromise(ittContent)

const webvttContent = convertToWebVTT(ittJson, fps)
const webvttFilePath = join(process.cwd(), `${basename(ittFilePath, '.itt')}.vtt`)
await writeFile(webvttFilePath, webvttContent)

console.log(`Converted ${ittFilePath} to ${webvttFilePath}`)

function convertToWebVTT(ittJson, fps) {
  const cues = ittJson.tt.body[0].div[0].p
  const webvttCues = cues.map((cue) => {
    const start = convertTime(cue.$.begin, fps)
    const end = convertTime(cue.$.end, fps)
    let text = cue._
    if (cue.$['tts:fontStyle'] === 'italic') {
      text = `<i>${text}</i>`
    }
    const position = cue.$.region === 'top' ? 'line:5%' : 'line:95%'
    return `\n${start} --> ${end} ${position}\n${text}`
  })

  return `WEBVTT\n${webvttCues.join('\n')}`
}

function convertTime(time, fps) {
  const [hours, minutes, seconds, frames] = time.split(':')
  const milliseconds = Math.round((parseInt(frames, 10) / fps) * 1000)
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
}
