#!/usr/bin/env node

import countries from 'i18n-iso-countries'
import ISO6391 from 'iso-639-1'
import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ulid } from 'ulid'

// Constants
const SEGMENT_LENGTH = {
  VIDEO: '6',
  SUBTITLE: '60',
}

const AUDIO_GROUPS = [
  { type: 'aac-lc-128', language: 'en', name: 'English', codec: 'mp4a.40.2' },
  { type: 'aac-he-64', language: 'en', name: 'English', codec: 'mp4a.40.5' },
]

const VTT_PREFIXES = {
  SUBTITLES: 'subs-',
}

const SUBTITLE_CHARACTERISTICS =
  'public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound'

// Audio group assignments by resolution
const AUDIO_GROUP_ASSIGNMENTS = {
  LOW_RES_THRESHOLD: '540',
  LOW_RES_GROUP: 'aac-he-64',
  HIGH_RES_GROUP: 'aac-lc-128',
}

// Media track groups
const TRACK_GROUPS = {
  SUBTITLES: 'subtitles',
  METADATA: 'metadata',
}

// File extensions
const FILE_EXTENSIONS = {
  VTT: '.vtt',
  M4A: '.m4a',
  MOV: '.mov',
  JPEG: '.jpeg',
}

const CODEC_RANKS = {
  avc: 1,
  hevc: 2,
}

const RESOLUTION_RANKS = {
  '540p': 1,
  '720p': 2,
  '1080p': 3,
  '1440p': 4,
  '2160p': 5,
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

await main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})

/**
 * Main function that orchestrates the HLS preparation process
 */
async function main() {
  const dir = validateInput()
  const id = ulid()
  const streamDir = join(dir, id)

  const assets = await discoverAssets(dir)
  const metadataDirectoryTracks = await processMetadataDirectories(
    assets.metaDirs,
    dir,
    streamDir
  )
  const variants = await processMediaAssets(assets, streamDir)
  await generateManifest({ ...assets, metadataDirectoryTracks }, variants, streamDir)
  await copyStaticAssets(dir, streamDir)
}

function validateInput() {
  const [, , dir] = process.argv

  if (!dir) {
    throw new Error(
      'Usage: hls-prep <input-directory>\n' +
        'Please provide a directory path containing media files for HLS processing.'
    )
  }

  return dir
}

/**
 * Discovers and classifies all media assets in the input directory
 * @param {string} dir - Input directory path
 * @returns {Object} Classified assets including audio, video, subtitle tracks, and metadata directories
 */
async function discoverAssets(dir) {
  // Find m4a, mov, vtt files and meta- directories in the input directory
  const allFiles = await readdir(dir, { withFileTypes: true })

  const m4aFiles = allFiles
    .filter((f) => f.isFile() && f.name.endsWith(FILE_EXTENSIONS.M4A))
    .map((f) => f.name)
  const movFiles = allFiles
    .filter((f) => f.isFile() && f.name.endsWith(FILE_EXTENSIONS.MOV))
    .map((f) => f.name)
  const vttFiles = allFiles
    .filter((f) => f.isFile() && f.name.endsWith(FILE_EXTENSIONS.VTT))
    .map((f) => f.name)
  const metaDirs = allFiles
    .filter((f) => f.isDirectory() && f.name.startsWith('meta-'))
    .map((f) => f.name)

  // Classify VTT files and validate naming
  const { subtitleTracks } = classifyVttFiles(vttFiles)

  return {
    m4aFiles,
    movFiles,
    vttFiles,
    metaDirs,
    subtitleTracks,
  }
}

async function processMediaAssets(assets, streamDir) {
  const variants = []

  // Run mediafilesegmenter on each video file
  for (const file of assets.movFiles) {
    variants.push(await segmentMedia(file, streamDir))
  }

  // Run mediafilesegmenter on each audio file
  for (const file of assets.m4aFiles) {
    await segmentMedia(file, streamDir)
  }

  // Process subtitle tracks
  for (const subtitleTrack of assets.subtitleTracks) {
    await processVttTrack(subtitleTrack, streamDir)
  }

  return variants
}

// ============================================================================
// MANIFEST GENERATION
// ============================================================================

/**
 * Generates the HLS multivariant playlist with all media tracks
 * @param {Object} assets - Discovered media assets
 * @param {Array} variants - Video/audio variants with metadata
 * @param {string} streamDir - Output stream directory
 */
async function generateManifest(assets, variants, streamDir) {
  await createBasePlaylist(variants, streamDir)

  const playlist = await readFile(join(streamDir, 'index.m3u8'), 'utf8')
  let lines = playlist.split('\n')

  lines = addAudioGroups(lines)
  lines = addSubtitleAndMetadataTracks(lines, assets)
  lines = updateStreamEntries(lines, assets)

  await writeFile(join(streamDir, 'index.m3u8'), lines.join('\n'))
}

async function createBasePlaylist(variants, streamDir) {
  // Run variantplaylistcreator to create a multivariant playlist
  await run(
    'variantplaylistcreator',
    [
      '-o',
      'index.m3u8',
      ...variants
        .sort(({ score: a }, { score: b }) => (parseFloat(a) <= parseFloat(b) ? -1 : 1))
        .reverse() // Sort variants by score in descending order. This gets HEVC 2160p first.
        .map((v) => [v.url, v.plist, v.iframe && ['-iframe-url', v.iframe]].flat())
        .flat()
        .filter(Boolean),
    ],
    streamDir
  )
}

function addAudioGroups(lines) {
  const modifiedLines = [...lines]

  for (const group of AUDIO_GROUPS) {
    modifiedLines.splice(
      findStreamEntryIndex(modifiedLines),
      0,
      generateAudioMediaEntry(group)
    )
  }

  return modifiedLines
}

function addSubtitleAndMetadataTracks(lines, assets) {
  const modifiedLines = [...lines]

  const vttMediaEntries = [
    ...assets.subtitleTracks.map(generateSubtitleMediaEntry),
    ...assets.metadataDirectoryTracks.map(generateMetadataMediaEntry),
  ]

  modifiedLines.splice(findStreamEntryIndex(modifiedLines), 0, ...vttMediaEntries)

  return modifiedLines
}

function updateStreamEntries(lines, assets) {
  const modifiedLines = [...lines]

  for (const line of modifiedLines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const variant = line.match(/RESOLUTION=\d+x(\d+)/)[1]
      const group =
        variant === AUDIO_GROUP_ASSIGNMENTS.LOW_RES_THRESHOLD
          ? AUDIO_GROUP_ASSIGNMENTS.LOW_RES_GROUP
          : AUDIO_GROUP_ASSIGNMENTS.HIGH_RES_GROUP
      const audioCodec = AUDIO_GROUPS.find((g) => g.type === group).codec

      let updatedLine = line.replace(/CODECS="[^"]+/, `$&,${audioCodec}`)
      updatedLine += `,AUDIO="${group}"`

      // Add subtitles group if subtitle tracks exist
      if (assets.subtitleTracks.length > 0) {
        updatedLine += `,SUBTITLES="${TRACK_GROUPS.SUBTITLES}"`
      }

      modifiedLines.splice(modifiedLines.indexOf(line), 1, updatedLine)
    }
  }

  return modifiedLines
}

async function copyStaticAssets(dir, streamDir) {
  // Copy poster.jpeg to the stream directory
  const posterFileName = `poster${FILE_EXTENSIONS.JPEG}`
  await writeFile(
    join(streamDir, posterFileName),
    await readFile(join(dir, posterFileName))
  )
}

// ============================================================================
// MEDIA PROCESSING
// ============================================================================

async function segmentMedia(file, streamDir) {
  const variant = basename(file).replace(/\.[^/.]+$/, '')
  const outdir = join(streamDir, variant)
  await mkdir(outdir, { recursive: true })
  const score = determineScore(variant)
  await run(
    'mediafilesegmenter',
    [
      '-r', // Create a fragmented MPEG-4 file
      '-s', // Create a single MPEG-4 file (do not split segments into multiple files)
      '-t',
      SEGMENT_LENGTH.VIDEO,
      '-start-segments-with-iframe',
      ...(score ? ['-score', score] : []),
      '-i', // Index file name
      'index.m3u8',
      '-f',
      variant, // Relative to streamDir
      '-variant-plist',
      variant, // Put plist in the variant subdirectory
      `../${file}`, // Relative path from streamDir back to input file
    ],
    streamDir
  )
  return {
    url: `${variant}/index.m3u8`,
    plist: `${variant}/${variant}.plist`,
    score,
    ...(file.endsWith('.mov') && { iframe: `${variant}/iframe_index.m3u8` }),
  }
}

function determineScore(variant) {
  const [codec, resolution] = variant.split('-')
  if (codec === 'aac') return null

  const codecRank = CODEC_RANKS[codec]
  if (!codecRank) {
    throw new Error(`Unknown codec: ${codec}`)
  }

  const resolutionRank = RESOLUTION_RANKS[resolution]
  if (!resolutionRank) {
    throw new Error(`Unknown resolution: ${resolution}`)
  }

  return `${codecRank}.${resolutionRank}`
}

function classifyVttFiles(vttFiles) {
  const subtitleTracks = []

  for (const file of vttFiles) {
    if (file.startsWith(VTT_PREFIXES.SUBTITLES)) {
      const langCode = file.slice(
        VTT_PREFIXES.SUBTITLES.length,
        FILE_EXTENSIONS.VTT.length * -1
      )
      const languageInfo = parseLanguageCode(langCode)
      subtitleTracks.push({
        filename: file,
        langCode,
        ...languageInfo,
        outputDir: `subs-${langCode}`,
      })
    } else if (
      file.match(new RegExp(`^[a-z]{2}(-[a-z]{2})?\\${FILE_EXTENSIONS.VTT}$`, 'i'))
    ) {
      // Handle legacy format like 'en-us.vtt' or 'en.vtt'
      const langCode = file.slice(0, FILE_EXTENSIONS.VTT.length * -1)
      const languageInfo = parseLanguageCode(langCode)
      subtitleTracks.push({
        filename: file,
        langCode,
        ...languageInfo,
        outputDir: `subs-${langCode}`,
      })
    } else {
      throw new Error(
        `Invalid VTT filename: ${file}. Expected format: '${VTT_PREFIXES.SUBTITLES}<language>${FILE_EXTENSIONS.VTT}' or '<language>${FILE_EXTENSIONS.VTT}' (e.g., 'en${FILE_EXTENSIONS.VTT}', 'en-us${FILE_EXTENSIONS.VTT}')`
      )
    }
  }

  return { subtitleTracks }
}

function parseLanguageCode(langCode) {
  const parts = langCode.split('-')
  const language = parts[0].toLowerCase()
  const region = parts[1]?.toLowerCase()

  // Get language name using ISO 639-1
  const languageName = ISO6391.getName(language)
  if (!languageName) {
    console.warn(`Unknown language code: ${language}. Using code as display name.`)
  }

  let displayName = languageName || language.toUpperCase()

  // Add region if specified
  if (region) {
    const regionName = countries.getName(region.toUpperCase(), 'en')
    if (regionName) {
      displayName = `${displayName} (${regionName})`
    } else {
      console.warn(`Unknown region code: ${region}. Using code as display name.`)
      displayName = `${displayName} (${region.toUpperCase()})`
    }
  }

  return {
    language,
    region,
    displayName,
  }
}

async function processVttTrack(track, streamDir) {
  await mkdir(join(streamDir, track.outputDir), { recursive: true })

  await run(
    'mediasubtitlesegmenter',
    [
      '-t',
      SEGMENT_LENGTH.SUBTITLE,
      '-f',
      track.outputDir,
      '-i',
      'index.m3u8',
      `../${track.filename}`,
    ],
    streamDir
  )
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateMediaEntry(type, groupId, name, options = {}) {
  const {
    language = '',
    autoselect = 'NO',
    defaultTrack = 'NO',
    forced = 'NO',
    characteristics = '',
    uri,
  } = options

  const parts = [
    `TYPE=${type}`,
    `GROUP-ID="${groupId}"`,
    `NAME="${name}"`,
    language && `LANGUAGE="${language}"`,
    `AUTOSELECT=${autoselect}`,
    `DEFAULT=${defaultTrack}`,
    forced !== undefined && `FORCED=${forced}`,
    characteristics && `CHARACTERISTICS="${characteristics}"`,
    `URI="${uri}"`,
  ].filter(Boolean)

  return `#EXT-X-MEDIA:${parts.join(',')}`
}

function generateAudioMediaEntry(audioGroup) {
  return generateMediaEntry('AUDIO', audioGroup.type, audioGroup.name, {
    language: audioGroup.language,
    autoselect: 'YES',
    uri: `${audioGroup.type}/index.m3u8`,
  })
}

function generateSubtitleMediaEntry(subtitleTrack) {
  return generateMediaEntry(
    'SUBTITLES',
    TRACK_GROUPS.SUBTITLES,
    subtitleTrack.displayName,
    {
      language: subtitleTrack.language,
      autoselect: 'YES',
      defaultTrack: subtitleTrack.language === 'en' ? 'YES' : 'NO',
      forced: 'NO',
      characteristics: SUBTITLE_CHARACTERISTICS,
      uri: `${subtitleTrack.outputDir}/index.m3u8`,
    }
  )
}

function generateMetadataMediaEntry(metadataTrack) {
  return generateMediaEntry('SUBTITLES', TRACK_GROUPS.METADATA, metadataTrack.name, {
    uri: `${metadataTrack.outputDir}/index.m3u8`,
  })
}

async function processMetadataDirectories(metaDirs, dir, streamDir) {
  const tracks = []

  for (const dirName of metaDirs) {
    const sourcePath = join(dir, dirName)
    const outputDir = dirName // Use directory name as-is in output
    const destPath = join(streamDir, outputDir)

    // Verify the directory contains an index.m3u8 file
    try {
      await lstat(join(sourcePath, 'index.m3u8'))
    } catch {
      console.warn(`Skipping ${dirName}: No index.m3u8 found`)
      continue
    }

    // Copy the entire directory to the output stream directory
    await cp(sourcePath, destPath, { recursive: true })

    // Extract track name from directory name (remove 'meta-' prefix)
    const trackName = dirName.replace(/^meta-/, '')

    tracks.push({
      name: trackName,
      outputDir,
    })
  }

  return tracks
}

function findStreamEntryIndex(lines) {
  return lines.findIndex(
    (line) =>
      line.startsWith('#EXT-X-STREAM-INF:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')
  )
}

function run(command, args, cwd) {
  console.log(`Running: ${command} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, args, { stdio: 'inherit', cwd })

    cmd.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
        return
      }
      resolve()
    })
  })
}
