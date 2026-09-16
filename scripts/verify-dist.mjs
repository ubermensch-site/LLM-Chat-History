import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const requiredFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'library.js',
  'library.html'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of requiredFiles) {
  await access(resolve(dist, file));
}

const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
assert(manifest.manifest_version === 3, 'Expected Manifest V3');
assert(manifest.background?.service_worker === 'background.js', 'Unexpected background worker entry');
assert(Array.isArray(manifest.permissions), 'Manifest permissions must be an array');
assert(
  manifest.permissions.length === 1 && manifest.permissions[0] === 'storage',
  `Unexpected extension permissions: ${JSON.stringify(manifest.permissions)}`
);

const allowedHosts = new Set(['https://chatgpt.com/*', 'https://chat.openai.com/*']);
assert(Array.isArray(manifest.host_permissions), 'Manifest host_permissions must be an array');
assert(
  manifest.host_permissions.length === allowedHosts.size &&
    manifest.host_permissions.every((host) => allowedHosts.has(host)),
  `Unexpected host permissions: ${JSON.stringify(manifest.host_permissions)}`
);

const contentScripts = manifest.content_scripts ?? [];
assert(contentScripts.length === 1, 'Expected one ChatGPT content-script declaration');
assert(
  contentScripts[0]?.js?.length === 1 && contentScripts[0].js[0] === 'content.js',
  'Unexpected content script output'
);

const libraryHtml = await readFile(resolve(dist, 'library.html'), 'utf8');
assert(libraryHtml.includes('src="library.js"'), 'Library page is not wired to library.js');
assert(!/<script[^>]+src=["']https?:\/\//i.test(libraryHtml), 'Remote script found in library page');

const builtScripts = await Promise.all(
  ['background.js', 'content.js', 'library.js'].map((file) => readFile(resolve(dist, file), 'utf8'))
);
assert(
  builtScripts.every((source) => !/https?:\/\/[^\s"']+\.js/i.test(source)),
  'Built extension appears to reference remotely hosted JavaScript'
);

console.log(`Verified installable extension bundle: ${requiredFiles.join(', ')}`);
