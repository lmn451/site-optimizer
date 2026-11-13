const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const excluded = new Set(['.git', 'node_modules', 'build', 'dist', '_metadata', 'tests']);

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), `${name}/`));
    else files.push(name);
  }
  return files.sort();
}

// Parse both ZIP directory and local headers rather than trusting the build implementation.
function readZip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  assert.equal(bytes.readUInt16LE(end + 8), bytes.readUInt16LE(end + 10));
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  assert.equal(cursor + bytes.readUInt32LE(end + 12), end);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    assert.equal(bytes.readUInt16LE(cursor + 10), 0, 'stored ZIP method');
    const size = bytes.readUInt32LE(cursor + 24);
    assert.equal(bytes.readUInt32LE(cursor + 20), size);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
    assert.ok(!files.has(name), 'no duplicate entries');
    const offset = bytes.readUInt32LE(cursor + 42);
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
    const localNameLength = bytes.readUInt16LE(offset + 26);
    assert.equal(bytes.subarray(offset + 30, offset + 30 + localNameLength).toString(), name);
    const start = offset + 30 + localNameLength + bytes.readUInt16LE(offset + 28);
    const content = bytes.subarray(start, start + size);
    assert.equal(content.length, size);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32LE(cursor + 16), `CRC for ${name}`);
    assert.equal(bytes.readUInt32LE(offset + 14), bytes.readUInt32LE(cursor + 16));
    files.set(name, content);
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, end);
  assert.deepEqual([...files.keys()], [...files.keys()].sort());
  return files;
}

test('npm builds canonical MV3 sources, deterministic ZIPs, and isolated browser targets', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'site-optimizer-build-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.cp(root, fixture, {
    recursive: true,
    filter: source => {
      const relative = path.relative(root, source);
      return !relative || !excluded.has(relative.split(path.sep)[0]);
    },
  });
  const run = script => execFileSync('npm', ['run', script], { cwd: fixture, encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
  for (const target of ['chrome', 'firefox']) {
    await fs.mkdir(path.join(fixture, 'build', target), { recursive: true });
    await fs.writeFile(path.join(fixture, 'build', target, 'stale.js'), 'stale');
  }
  // Browser-generated metadata must never leak into a package, even if present locally.
  await fs.mkdir(path.join(fixture, '_metadata'), { recursive: true });
  await fs.writeFile(path.join(fixture, '_metadata', 'generated'), 'not source');
  run('build');
  const originals = new Map();
  const canonicalManifest = await fs.readFile(path.join(fixture, 'manifest.json'));
  const sourceManifest = JSON.parse(canonicalManifest);
  for (const target of ['chrome', 'firefox']) {
    const zip = await fs.readFile(path.join(fixture, 'dist', `${target}-extension.zip`));
    originals.set(target, zip);
    const entries = readZip(zip);
    const names = await listFiles(path.join(fixture, 'build', target));
    assert.deepEqual([...entries.keys()], names);
    for (const required of ['manifest.json', 'background.js', 'contentScript.js', 'popup.html', 'popup.js', 'settings.js']) {
      assert.ok(entries.has(required), `${target} contains ${required}`);
    }
    assert.ok(!names.some(name => /(?:stale|_metadata|node_modules|README|package\.json)/.test(name)));
    for (const [name, content] of entries) {
      assert.deepEqual(await fs.readFile(path.join(fixture, 'build', target, name)), content);
      if (name !== 'manifest.json') assert.deepEqual(content, await fs.readFile(path.join(fixture, name)), `${name} matches canonical source`);
    }
    const manifest = JSON.parse(entries.get('manifest.json'));
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.content_scripts.some(entry => entry.js.includes('settings.js')), 'shared settings reach content scripts');
    const popup = entries.get('popup.html').toString();
    assert.match(popup, /<script\b[^>]*src=["']settings\.js["']/);
    assert.ok(popup.indexOf('settings.js') < popup.indexOf('popup.js'), 'settings load before popup code');
    if (target === 'chrome') assert.deepEqual(entries.get('manifest.json'), canonicalManifest);
    else {
      assert.deepEqual(manifest.background, { scripts: ['settings.js', 'background.js'] });
      assert.equal(manifest.browser_specific_settings.gecko.id, 'early-performance-optimizer@site-optimizer.local');
      assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '128.0');
      const { background, browser_specific_settings, ...rest } = manifest;
      const { background: originalBackground, browser_specific_settings: originalSettings, ...originalRest } = sourceManifest;
      assert.deepEqual(rest, originalRest, 'Firefox only changes target-specific manifest fields');
    }
  }
  // Source mtimes must not affect reproducibility.
  await fs.utimes(path.join(fixture, 'background.js'), new Date(0), new Date(0));
  run('build');
  for (const target of ['chrome', 'firefox']) {
    assert.deepEqual(await fs.readFile(path.join(fixture, 'dist', `${target}-extension.zip`)), originals.get(target), 'repeated build is byte-identical');
  }
  for (const target of ['chrome', 'firefox']) {
    const other = target === 'chrome' ? 'firefox' : 'chrome';
    const sentinel = path.join(fixture, 'build', other, 'keep.txt');
    await fs.writeFile(sentinel, 'other target untouched');
    run(`build:${target}`);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'other target untouched');
    assert.deepEqual(await fs.readFile(path.join(fixture, 'dist', `${target}-extension.zip`)), originals.get(target));
    assert.deepEqual(await fs.readFile(path.join(fixture, 'dist', `${other}-extension.zip`)), originals.get(other));
    await fs.unlink(sentinel);
  }
  assert.throws(() => execFileSync(process.execPath, ['scripts/build.mjs', 'invalid'], { cwd: fixture, stdio: 'pipe' }), /Command failed/);
  assert.deepEqual(await fs.readFile(path.join(fixture, 'manifest.json')), canonicalManifest, 'canonical manifest is unchanged');

  // Exercise nested manifest and popup/CSS asset dependencies, not just today's JS files.
  await fs.mkdir(path.join(fixture, 'assets'), { recursive: true });
  const icon = Buffer.from([0, 1, 2, 255, 128]);
  await fs.writeFile(path.join(fixture, 'assets', 'icon.png'), icon);
  await fs.writeFile(path.join(fixture, 'assets', 'popup.css'), 'body { background-image: url("icon.png"); }');
  const withIcon = { ...sourceManifest, icons: { 16: 'assets/icon.png' } };
  await fs.writeFile(path.join(fixture, 'manifest.json'), JSON.stringify(withIcon));
  await fs.appendFile(path.join(fixture, 'popup.html'), '\n<link rel="stylesheet" href="assets/popup.css">');
  run('build');
  for (const target of ['chrome', 'firefox']) {
    const entries = readZip(await fs.readFile(path.join(fixture, 'dist', `${target}-extension.zip`)));
    assert.deepEqual(entries.get('assets/icon.png'), icon);
    assert.equal(entries.get('assets/popup.css').toString(), 'body { background-image: url("icon.png"); }');
  }
  await fs.unlink(path.join(fixture, 'assets', 'icon.png'));
  assert.throws(() => run('build:chrome'), /Command failed/, 'missing referenced assets fail rather than creating an incomplete package');
});
