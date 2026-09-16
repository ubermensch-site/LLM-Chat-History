import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const releaseDir = resolve(root, 'release');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(typeof packageJson.version === 'string' && packageJson.version, 'package.json version is missing');
assert(manifest.version === packageJson.version, `Version mismatch: package=${packageJson.version}, manifest=${manifest.version}`);

async function collectFiles(directory) {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await collectFiles(absolute)));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

const absoluteFiles = await collectFiles(dist);
assert(absoluteFiles.length > 0, 'dist/ is empty; run npm run build first');
const files = await Promise.all(
  absoluteFiles.map(async (absolute) => {
    const path = relative(dist, absolute).split(sep).join('/');
    assert(!path.startsWith('../') && !path.includes('/../'), `Unsafe release path: ${path}`);
    assert(!path.endsWith('.map'), `Source map must not ship in release package: ${path}`);
    return { path, data: await readFile(absolute) };
  })
);
files.sort((a, b) => a.path.localeCompare(b.path));

const requiredFiles = new Set(['manifest.json', 'background.js', 'content.js', 'library.js', 'library.html']);
for (const required of requiredFiles) {
  assert(files.some((file) => file.path === required), `Release package missing ${required}`);
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed DOS timestamp (2026-01-01 00:00:00) makes identical dist contents produce
// identical ZIP bytes regardless of build machine/time.
const dosTime = 0;
const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

function localHeader(name, data, crc) {
  const nameBytes = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30 + nameBytes.length);
  let offset = 0;
  header.writeUInt32LE(0x04034b50, offset); offset += 4;
  header.writeUInt16LE(20, offset); offset += 2;
  header.writeUInt16LE(0x0800, offset); offset += 2; // UTF-8 names
  header.writeUInt16LE(0, offset); offset += 2; // stored/no compression
  header.writeUInt16LE(dosTime, offset); offset += 2;
  header.writeUInt16LE(dosDate, offset); offset += 2;
  header.writeUInt32LE(crc, offset); offset += 4;
  header.writeUInt32LE(data.length, offset); offset += 4;
  header.writeUInt32LE(data.length, offset); offset += 4;
  header.writeUInt16LE(nameBytes.length, offset); offset += 2;
  header.writeUInt16LE(0, offset); offset += 2;
  nameBytes.copy(header, offset);
  return header;
}

function centralHeader(name, data, crc, localOffset) {
  const nameBytes = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(46 + nameBytes.length);
  let offset = 0;
  header.writeUInt32LE(0x02014b50, offset); offset += 4;
  header.writeUInt16LE(20, offset); offset += 2;
  header.writeUInt16LE(20, offset); offset += 2;
  header.writeUInt16LE(0x0800, offset); offset += 2;
  header.writeUInt16LE(0, offset); offset += 2;
  header.writeUInt16LE(dosTime, offset); offset += 2;
  header.writeUInt16LE(dosDate, offset); offset += 2;
  header.writeUInt32LE(crc, offset); offset += 4;
  header.writeUInt32LE(data.length, offset); offset += 4;
  header.writeUInt32LE(data.length, offset); offset += 4;
  header.writeUInt16LE(nameBytes.length, offset); offset += 2;
  header.writeUInt16LE(0, offset); offset += 2;
  header.writeUInt16LE(0, offset); offset += 2;
  header.writeUInt16LE(0, offset); offset += 2;
  header.writeUInt16LE(0, offset); offset += 2;
  header.writeUInt32LE(0, offset); offset += 4;
  header.writeUInt32LE(localOffset, offset); offset += 4;
  nameBytes.copy(header, offset);
  return header;
}

const localParts = [];
const centralParts = [];
let localOffset = 0;
for (const file of files) {
  const crc = crc32(file.data);
  const header = localHeader(file.path, file.data, crc);
  localParts.push(header, file.data);
  centralParts.push(centralHeader(file.path, file.data, crc, localOffset));
  localOffset += header.length + file.data.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
let endOffset = 0;
end.writeUInt32LE(0x06054b50, endOffset); endOffset += 4;
end.writeUInt16LE(0, endOffset); endOffset += 2;
end.writeUInt16LE(0, endOffset); endOffset += 2;
end.writeUInt16LE(files.length, endOffset); endOffset += 2;
end.writeUInt16LE(files.length, endOffset); endOffset += 2;
end.writeUInt32LE(centralDirectory.length, endOffset); endOffset += 4;
end.writeUInt32LE(localOffset, endOffset); endOffset += 4;
end.writeUInt16LE(0, endOffset);

const zip = Buffer.concat([...localParts, centralDirectory, end]);
const filename = `llm-chat-history-v${packageJson.version}.zip`;
const outputPath = resolve(releaseDir, filename);
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
await writeFile(outputPath, zip);
const digest = createHash('sha256').update(zip).digest('hex');
await writeFile(`${outputPath}.sha256`, `${digest}  ${basename(outputPath)}\n`, 'utf8');

console.log(`Packaged ${files.length} files -> release/${filename}`);
console.log(`SHA-256 ${digest}`);
