#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ulid } from 'ulid'

const [, , dir] = process.argv

const id = ulid()
const streamDir = join(dir, id)

// Find m4a and mov files in the input directory
const allFiles = await readdir(dir)
const m4aFiles = allFiles.filter((f) => f.endsWith('.m4a'))
const movFiles = allFiles.filter((f) => f.endsWith('.mov'))

const variants = []

// Run mediafilesegmenter on each video file
for (const file of [...movFiles]) {
  variants.push(await segmentMedia(file))
}

// Run mediafilesegmenter on each audio file
for (const file of [...m4aFiles]) {
  await segmentMedia(file)
}

// Run mediasubtitlesegmenter on the subtitle file
await mkdir(join(streamDir, 'subs-en-us'), { recursive: true })
await run('mediasubtitlesegmenter', [
  '-t', // Segment length in seconds
  '60',
  '-f', // Output directory
  join(streamDir, 'subs-en-us'),
  '-i', // Output file name
  'index.m3u8',
  join(dir, 'en-us.vtt'),
])

// Run variantplaylistcreator to create a multivariant playlist
await run('variantplaylistcreator', [
  '-o',
  join(streamDir, 'index.m3u8'),
  ...variants
    .sort(({ score: a }, { score: b }) => (parseFloat(a) <= parseFloat(b) ? -1 : 1))
    .reverse() // Sort variants by score in descending order. This gets HEVC 1440p first.
    .map((v) => [v.url, v.plist, v.iframe && ['-iframe-url', v.iframe]].flat())
    .flat()
    .filter(Boolean),
])

// Open the multivariant playlist file and put the lines into an array.
const playlist = await readFile(join(streamDir, 'index.m3u8'), 'utf8')
const lines = playlist.split('\n')

// Rewrite the playlist file with an EXT-X-MEDIA tag for each audio group (`aac-lc-128` and
// `aac-he-64`)
const audioGroups = [
  { type: 'aac-lc-128', language: 'en', name: 'English', codec: 'mp4a.40.2' },
  { type: 'aac-he-64', language: 'en', name: 'English', codec: 'mp4a.40.5' },
]
for (const group of audioGroups) {
  lines.splice(
    lines.findIndex(
      (line) =>
        line.startsWith('#EXT-X-STREAM-INF:') ||
        line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')
    ),
    0,
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${group.type}",NAME="${group.name}",LANGUAGE="${group.language}",AUTOSELECT=YES,DEFAULT=NO,URI="${group.type}/index.m3u8"`
  )
}

// Rewrite the playlist file so that subtitles are included in the playlist
lines.splice(
  lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF:')),
  0,
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",AUTOSELECT=YES,DEFAULT=YES,FORCED=NO,CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound",URI="subs-en-us/index.m3u8"'
)

// Rewrite the playlist file so that the 540p variants get the `aac-he-64` audio group and
// all other variants get the `aac-lc-128` audio group. Plus add the subs to the stream.
for (const line of lines) {
  if (line.startsWith('#EXT-X-STREAM-INF:')) {
    const variant = line.match(/RESOLUTION=\d+x(\d+)/)[1]
    const group = variant === '540' ? 'aac-he-64' : 'aac-lc-128'
    const audioCodec = audioGroups.find((g) => g.type === group).codec
    const lineWithAudioGroup = `${line.replace(
      /CODECS="[^"]+/,
      `$&,${audioCodec}`
    )},AUDIO="${group}",SUBTITLES="subs"`
    lines.splice(lines.indexOf(line), 1, lineWithAudioGroup)
  }
}

// Write the modified playlist file back to disk
await writeFile(join(streamDir, 'index.m3u8'), lines.join('\n'))

// Copy poster.jpeg to the stream directory using node:fs/promises
await writeFile(join(streamDir, 'poster.jpeg'), await readFile(join(dir, 'poster.jpeg')))

async function segmentMedia(file) {
  const path = join(dir, file)
  const variant = basename(file).replace(/\.[^/.]+$/, '')
  const outdir = join(streamDir, variant)
  await mkdir(outdir, { recursive: true })
  const score = determineScore(variant)
  await run('mediafilesegmenter', [
    '-r', // Create a fragmented MPEG-4 file
    '-s', // Create a single MPEG-4 file (do not split segments into multiple files)
    '-t', // Segment length in seconds
    '6',
    '-start-segments-with-iframe',
    ...(score ? ['-score', score] : []),
    '-i', // Index file name
    'index.m3u8',
    '-f',
    outdir,
    '-variant-plist',
    outdir,
    path,
  ])
  return {
    url: `${variant}/index.m3u8`,
    plist: `${variant}/${variant}.plist`,
    score,
    ...(movFiles.includes(file) && { iframe: `${variant}/iframe_index.m3u8` }),
  }
}

function determineScore(variant) {
  const [codec, resolution] = variant.split('-')
  if (codec === 'aac') return null

  let codecRank
  if (codec === 'avc') {
    codecRank = 1
  } else if (codec === 'hevc') {
    codecRank = 2
  } else {
    throw new Error(`Unknown codec: ${codec}`)
  }

  let intraCodecRank
  switch (resolution) {
    case '1440p':
      intraCodecRank = 4
      break
    case '1080p':
      intraCodecRank = 3
      break
    case '720p':
      intraCodecRank = 2
      break
    case '540p':
      intraCodecRank = 1
      break
    default:
      throw new Error(`Unknown resolution: ${resolution}`)
  }

  return `${codecRank}.${intraCodecRank}`
}

function run(command, args) {
  console.log(`Running: ${command} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, args, { stdio: 'inherit', cwd: streamDir })

    cmd.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
        return
      }
      resolve()
    })
  })
}
