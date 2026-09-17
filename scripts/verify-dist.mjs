import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const requiredFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'library.js',
  'library.css',
  'library.html'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function collectFiles(directory) {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await collectFiles(absolute)));
    else if (entry.isFile()) output.push(relative(dist, absolute).split(sep).join('/'));
  }
  return output.sort();
}

for (const file of requiredFiles) {
  await access(resolve(dist, file));
}

const [manifest, packageJson] = await Promise.all([
  readFile(resolve(dist, 'manifest.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse)
]);
assert(manifest.manifest_version === 3, 'Expected Manifest V3');
assert(manifest.version === packageJson.version, `Version mismatch: manifest=${manifest.version}, package=${packageJson.version}`);
assert(/^0\.1\.\d+$/.test(manifest.version), `Expected v0.1.x release version, got ${manifest.version}`);
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

const expectedCsp = "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';";
assert(
  manifest.content_security_policy?.extension_pages === expectedCsp,
  `Unexpected extension CSP: ${JSON.stringify(manifest.content_security_policy)}`
);
assert(!manifest.web_accessible_resources, 'Unexpected web-accessible extension resources');
assert(!manifest.externally_connectable, 'Unexpected externally_connectable surface');

const contentScripts = manifest.content_scripts ?? [];
assert(contentScripts.length === 1, 'Expected one ChatGPT content-script declaration');
assert(
  contentScripts[0]?.js?.length === 1 && contentScripts[0].js[0] === 'content.js',
  'Unexpected content script output'
);
assert(contentScripts[0]?.all_frames !== true, 'Content script must not run in all frames');

const [libraryHtml, libraryCss] = await Promise.all([
  readFile(resolve(dist, 'library.html'), 'utf8'),
  readFile(resolve(dist, 'library.css'), 'utf8')
]);
assert(libraryHtml.includes('src="library.js"'), 'Library page is not wired to library.js');
assert(libraryHtml.includes('href="library.css"'), 'Library page is not wired to library.css');
assert(!/<script[^>]+src=["']https?:\/\//i.test(libraryHtml), 'Remote script found in library page');
assert(!/<link[^>]+href=["']https?:\/\//i.test(libraryHtml), 'Remote stylesheet found in library page');
assert(!/\son[a-z]+\s*=/i.test(libraryHtml), 'Inline event handler found in library page');
assert(!/@import\s+(?:url\()?['"]?https?:\/\//i.test(libraryCss), 'Remote CSS import found in Library stylesheet');
assert(!/url\(['"]?https?:\/\//i.test(libraryCss), 'Remote asset URL found in Library stylesheet');

const scriptTags = [...libraryHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert(scriptTags.length === 1, `Expected exactly one packaged Library script, found ${scriptTags.length}`);
for (const [, attributes = '', body = ''] of scriptTags) {
  const src = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  assert(src === 'library.js', `Unexpected Library script source: ${src ?? '(inline)'}`);
  assert(body.trim() === '', 'Inline JavaScript found in Library page');
}

const distFiles = await collectFiles(dist);
assert(!distFiles.some((file) => file.endsWith('.map')), `Release build contains source maps: ${distFiles.filter((file) => file.endsWith('.map')).join(', ')}`);
assert(
  distFiles.some((file) => file.startsWith('assets/') && file.endsWith('.woff2')),
  'Expected self-hosted Library font assets in dist/assets'
);

const builtScriptEntries = await Promise.all(
  ['background.js', 'content.js', 'library.js'].map(async (file) => ({
    file,
    source: await readFile(resolve(dist, file), 'utf8')
  }))
);
assert(
  builtScriptEntries.every(({ source }) => !/https?:\/\/[^\s"']+\.js/i.test(source)),
  'Built extension appears to reference remotely hosted JavaScript'
);

const forbiddenRuntimePatterns = [
  { pattern: /\beval\s*\(/, label: 'eval()' },
  { pattern: /\bnew\s+Function\s*\(/, label: 'new Function()' },
  { pattern: /\.innerHTML\s*=/, label: 'innerHTML assignment' },
  { pattern: /\.outerHTML\s*=/, label: 'outerHTML assignment' },
  { pattern: /insertAdjacentHTML\s*\(/, label: 'insertAdjacentHTML()' },
  { pattern: /document\.write\s*\(/, label: 'document.write()' },
  { pattern: /\bfetch\s*\(/, label: 'fetch()' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { pattern: /\bWebSocket\b/, label: 'WebSocket' },
  { pattern: /\bEventSource\b/, label: 'EventSource' },
  { pattern: /sendBeacon\s*\(/, label: 'sendBeacon()' }
];

for (const { file, source } of builtScriptEntries) {
  for (const { pattern, label } of forbiddenRuntimePatterns) {
    assert(!pattern.test(source), `${label} found in ${file}; review v0.1 security/network boundary`);
  }
}

console.log(`Verified installable extension bundle v${manifest.version}: ${distFiles.join(', ')}`);
console.log('Verified v0.1 security/release invariants: version match, no source maps, minimal permissions, explicit CSP, locally bundled Library styles/fonts, no dynamic HTML/code sinks, no network APIs.');
