import { readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const targets = process.argv.slice(2);
if (!targets.length) targets.push('chrome', 'firefox');
if (targets.some(target => !['chrome', 'firefox'].includes(target))) {
  throw new Error('Usage: node scripts/build.mjs [chrome|firefox]');
}
if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js >=20 is required');

// Stored ZIP entries avoid external tools, compression-version differences, and timestamps.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const [name, data] of files) {
    const filename = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); // UTF-8 names
    header.writeUInt16LE(0x21, 12); // 1980-01-01, 00:00:00
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    locals.push(header, filename, data);
    directory.push(central, filename);
    offset += header.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

function manifestPaths(manifest) {
  return [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(typeof manifest.action?.default_icon === 'object' ? manifest.action.default_icon : {}),
    ...(typeof manifest.action?.default_icon === 'string' ? [manifest.action.default_icon] : []),
    ...(manifest.content_scripts ?? []).flatMap(entry => [...(entry.js ?? []), ...(entry.css ?? [])]),
    ...(manifest.declarative_net_request?.rule_resources ?? []).map(entry => entry.path),
    ...(manifest.web_accessible_resources ?? []).flatMap(entry => entry.resources ?? []),
  ].filter(Boolean);
}

async function sourceFiles(manifest) {
  const files = new Map();
  const pending = manifestPaths(manifest);
  while (pending.length) {
    const name = pending.pop().replaceAll('\\', '/');
    if (files.has(name)) continue;
    if (path.posix.isAbsolute(name) || name.split('/').includes('..') || /[?*#]/.test(name)) {
      throw new Error(`Unsupported or unsafe asset path: ${name}`);
    }
    const absolute = await realpath(path.join(root, name));
    if (!absolute.startsWith(root) || /(^|\/)(?:_metadata|build|dist|node_modules|\.git)(\/|$)/.test(name)) {
      throw new Error(`Asset is outside canonical sources: ${name}`);
    }
    const data = await readFile(absolute);
    files.set(name, data);
    if (/\.html$/i.test(name)) {
      for (const match of data.toString().matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const reference = match[1];
        if (!/^(?:[a-z]+:|\/\/|#)/i.test(reference)) pending.push(path.posix.join(path.posix.dirname(name), reference));
      }
    }
    if (/\.css$/i.test(name)) {
      for (const match of data.toString().matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) {
        if (!/^(?:[a-z]+:|\/\/|#)/i.test(match[1])) pending.push(path.posix.join(path.posix.dirname(name), match[1]));
      }
    }
  }
  return files;
}

const sourceManifestBytes = await readFile(path.join(root, 'manifest.json'));
const sourceManifest = JSON.parse(sourceManifestBytes);
if (sourceManifest.manifest_version !== 3) throw new Error('Canonical manifest must be MV3');
for (const target of targets) {
  const manifest = structuredClone(sourceManifest);
  if (target === 'firefox') {
    manifest.background = { scripts: ['settings.js', 'background.js'] };
    manifest.browser_specific_settings = {
      ...manifest.browser_specific_settings,
      gecko: {
        ...manifest.browser_specific_settings?.gecko,
        id: 'early-performance-optimizer@site-optimizer.local',
        strict_min_version: '128.0',
      },
    };
  }
  const files = await sourceFiles(manifest);
  files.set('manifest.json', target === 'chrome' ? sourceManifestBytes : Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  const sorted = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const output = path.join(root, 'build', target);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [name, data] of sorted) {
    await mkdir(path.dirname(path.join(output, name)), { recursive: true });
    await writeFile(path.join(output, name), data);
  }
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', `${target}-extension.zip`), zip(sorted));
  console.log(`Built build/${target} and dist/${target}-extension.zip (${sorted.length} files)`);
}
