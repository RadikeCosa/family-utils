#!/usr/bin/env node

import { readdir, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const DISPLAY_EDGE = 2048;
const THUMBNAIL_EDGE = 384;
const COLLECTION_COUNT = 200;
const MIN_SAMPLE_COUNT = 20;
const STORAGE_BUDGET_BYTES = 700 * 1024 * 1024;
const SUPPORTED = new Set(['.png', '.jpg', '.jpeg']);

function inside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function listImages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listImages(path));
    else if (entry.isFile() && SUPPORTED.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

async function derive(inputPath, outputPath, edge) {
  const { data, info } = await sharp(inputPath, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
    .rotate()
    .toColourspace('srgb')
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ lossless: true, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  await writeFile(outputPath, data, { flag: 'wx' });
  return { bytes: data.byteLength, width: info.width, height: info.height };
}

async function audit(inputDirectory, outputDirectory) {
  const inputRoot = await realpath(inputDirectory);
  const outputRoot = resolve(outputDirectory);
  const repositoryRoot = resolve(import.meta.dirname, '..');
  if (inside(repositoryRoot, outputRoot)) throw new Error('La salida debe estar fuera del repositorio.');
  if (inside(inputRoot, outputRoot) || inside(outputRoot, inputRoot)) throw new Error('Entrada y salida deben ser carpetas independientes.');
  await mkdir(outputRoot, { recursive: false });
  const files = await listImages(inputRoot);
  if (files.length < MIN_SAMPLE_COUNT) throw new Error(`Se necesitan al menos ${MIN_SAMPLE_COUNT} exportaciones; se encontraron ${files.length}.`);
  const samplesToMeasure = files;

  const samples = [];
  let displayTotal = 0;
  let thumbnailTotal = 0;
  for (const [index, path] of samplesToMeasure.entries()) {
    const [metadata, file] = await Promise.all([
      sharp(path, { limitInputPixels: MAX_PIXELS }).metadata(),
      stat(path),
    ]);
    if (!metadata.width || !metadata.height) throw new Error(`No se pudieron leer dimensiones de la muestra ${index + 1}.`);
    const orientation = metadata.orientation ?? 1;
    const swapped = orientation >= 5 && orientation <= 8;
    const width = swapped ? metadata.height : metadata.width;
    const height = swapped ? metadata.width : metadata.height;
    const id = String(index + 1).padStart(3, '0');
    const display = await derive(path, join(outputRoot, `sample-${id}-display.webp`), DISPLAY_EDGE);
    const thumbnail = await derive(path, join(outputRoot, `sample-${id}-thumbnail.webp`), THUMBNAIL_EDGE);
    displayTotal += display.bytes;
    thumbnailTotal += thumbnail.bytes;
    samples.push({
      sample: `sample-${id}`,
      inputBytes: file.size,
      format: metadata.format ?? 'unknown',
      sourceDimensions: `${metadata.width}x${metadata.height}`,
      orientedDimensions: `${width}x${height}`,
      pixels: width * height,
      orientation,
      hasAlpha: metadata.hasAlpha ?? false,
      sourceColourspace: metadata.space ?? 'unknown',
      embeddedIccProfile: Boolean(metadata.icc),
      under25MiB: file.size <= MAX_INPUT_BYTES,
      under40MP: width * height <= MAX_PIXELS,
      displayWebpBytes: display.bytes,
      thumbnailWebpBytes: thumbnail.bytes,
    });
  }

  const projectedBytes = Math.round((displayTotal + thumbnailTotal) / samples.length * COLLECTION_COUNT);
  const report = {
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    sampleSelection: 'All supported files in the input folder; source names are omitted.',
    assumptions: { maxInputBytes: MAX_INPUT_BYTES, maxPixels: MAX_PIXELS, collectionCount: COLLECTION_COUNT, storageBudgetBytes: STORAGE_BUDGET_BYTES, displayEdge: DISPLAY_EDGE, thumbnailEdge: THUMBNAIL_EDGE },
    projectionFor200: { webpLosslessBytes: projectedBytes, within700MiB: projectedBytes <= STORAGE_BUDGET_BYTES },
    transferPerImage: { uploadOriginal: 'inputBytes once plus retries', finalizeRead: 'inputBytes once for hash and processing', stored: 'display derivative plus thumbnail', cleanup: 'delete temporary original after processing' },
    samples,
  };
  const reportPath = join(outputRoot, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`Auditoría lista: ${reportPath}`);
  console.log('Los nombres originales no aparecen en el reporte. La salida queda en esta carpeta privada.');
}

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('Uso: node scripts/gallery-image-audit.mjs <carpeta-privada-con-20-exportaciones> <carpeta-privada-de-salida-fuera-del-repo>');
  process.exitCode = 1;
} else {
  audit(input, output).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
