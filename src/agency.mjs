import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { json, listFiles, readRegular, requireThat, safePath, sameSet, sha256 } from './files.mjs';

export const PLUGIN = 'plugins/agency-agents';
export const PRODUCER_FILES = [
  'package.json', 'package-lock.json', 'src/agency.mjs', 'src/archive.mjs', 'src/cli.mjs', 'src/files.mjs',
];

export function frontmatter(bytes) {
  const text = bytes.toString('utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  requireThat(match && !text.includes('\r') && !text.includes('\0'), 'Expected LF skill frontmatter and body');
  const document = parseDocument(match[1], { uniqueKeys: true });
  requireThat(!document.errors.length, 'Invalid skill YAML');
  const data = document.toJS({ maxAliasCount: 0 });
  requireThat(data && typeof data.name === 'string' && data.name.trim() &&
    typeof data.description === 'string' && data.description.trim() && match[2].trim(), 'Incomplete skill');
  return { data, body: match[2] };
}

export function loadInputs(root) {
  const recipeBytes = readRegular(root, `${PLUGIN}/recipe.json`);
  const lockBytes = readRegular(root, `${PLUGIN}/source-lock.json`);
  const recipe = JSON.parse(recipeBytes);
  const lock = JSON.parse(lockBytes);
  requireThat(recipe.schemaVersion === 1 && recipe.id === 'agency-agents' &&
    /^0\.\d+\.\d+$/.test(recipe.version) && recipe.channel === 'internal-preview' &&
    recipe.converter?.entry === 'scripts/convert.sh' && recipe.converter.tool === 'antigravity' &&
    recipe.skills?.length === 2, 'Unsupported Agency recipe');
  requireThat(lock.schemaVersion === 1 && /^[a-f0-9]{40}$/.test(lock.commit) && lock.license === 'MIT' &&
    lock.repository === 'https://github.com/msitarzewski/agency-agents.git', 'Invalid source lock');
  const slugs = new Set();
  for (const skill of recipe.skills) {
    requireThat(/^agency-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.slug) && !slugs.has(skill.slug), 'Duplicate/invalid skill slug');
    slugs.add(skill.slug);
    safePath(skill.source);
    requireThat(skill.family === 'work' && skill.packageKind === 'role' && /^agency_[a-z_]+$/.test(skill.role), 'Invalid role metadata');
    for (const field of ['capabilityTags', 'productTags', 'deliveryHints']) {
      requireThat(Array.isArray(skill[field]) && skill[field].length && skill[field].every(v =>
        typeof v === 'string' && /^[a-z][a-z-]*$/.test(v)), `Invalid ${field}`);
    }
    requireThat(skill.deliveryHints.every(v => ['filesystem', 'instructions'].includes(v)), 'Invalid delivery hint');
  }
  const sourcePaths = ['LICENSE', 'scripts/convert.sh', 'scripts/lib.sh', ...recipe.skills.map(s => s.source)];
  sameSet(Object.keys(lock.files), sourcePaths, 'Source lock');
  const sourceRoot = path.join(root, PLUGIN, 'upstream');
  sameSet(listFiles(sourceRoot), sourcePaths, 'Retained source');
  const sources = Object.fromEntries(sourcePaths.map(file => {
    const bytes = readRegular(sourceRoot, file);
    requireThat(lock.files[file].size === bytes.length && lock.files[file].sha256 === sha256(bytes), `Source digest mismatch: ${file}`);
    return [file, bytes];
  }));
  return { recipe, lock, recipeBytes, lockBytes, sources };
}

export function resolveBash() {
  if (process.env.CATS_PLUGINS_BASH) {
    requireThat(path.isAbsolute(process.env.CATS_PLUGINS_BASH), 'CATS_PLUGINS_BASH must be an absolute executable path');
    return process.env.CATS_PLUGINS_BASH;
  }
  if (process.platform !== 'win32') return 'bash';
  const candidates = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
    .filter(Boolean).map(base => path.join(base, 'Git', 'bin', 'bash.exe'));
  const found = candidates.find(existsSync);
  requireThat(found, 'Install Git for Windows or set CATS_PLUGINS_BASH to Git Bash (not WSL)');
  return found;
}

export function convert(inputs) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'cats-plugins-build-'));
  try {
    for (const [file, bytes] of Object.entries(inputs.sources)) {
      const target = path.join(scratch, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx' });
    }
    const bash = resolveBash();
    // Reviewed, digest-checked upstream code runs in a private build directory.
    // This is isolation of files, NOT a security sandbox for arbitrary plugins.
    execFileSync(bash, ['--noprofile', '--norc', 'scripts/convert.sh', '--tool', 'antigravity', '--out', 'converted'], {
      cwd: scratch, timeout: 30_000, maxBuffer: 2 ** 20,
      env: { ...process.env, BASH_ENV: '', ENV: '', LC_ALL: 'C', NO_COLOR: '1' },
    });
    const outputRoot = path.join(scratch, 'converted', 'antigravity');
    sameSet(listFiles(outputRoot), inputs.recipe.skills.map(s => `${s.slug}/SKILL.md`), 'Converter output');
    return Object.fromEntries(inputs.recipe.skills.map(s => [s.slug, readRegular(outputRoot, `${s.slug}/SKILL.md`)]));
  } finally {
    // Only the exact mkdtemp-created directory, never a caller-provided path.
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function makeSkill(input, skill, version, converted) {
  const original = frontmatter(input);
  // Assert the pinned upstream converter's known normalization: remove standalone
  // horizontal-rule lines and trailing blank lines. All other body text survives.
  const expectedBody = original.body.split('\n').filter(line => line !== '---').join('\n').replace(/\n+$/, '') + '\n';
  const output = converted ? frontmatter(converted) : { data: { name: skill.slug, description: original.data.description }, body: expectedBody };
  requireThat(output.data.name === skill.slug && output.data.description === original.data.description &&
    output.body === expectedBody, `Unexpected upstream conversion: ${skill.slug}`);
  const data = {
    name: skill.slug, description: output.data.description, family: skill.family,
    slug: skill.slug, role: skill.role, packageKind: skill.packageKind, version,
    capabilityTags: skill.capabilityTags, productTags: skill.productTags, deliveryHints: skill.deliveryHints,
  };
  return Buffer.from(`---\n${stringify(data, { lineWidth: 0 })}---\n${output.body}`);
}

export function manifest(recipe) {
  return {
    format: 'cats-plugin-producer-preview/v1', id: recipe.id, version: recipe.version,
    channel: recipe.channel, displayName: recipe.displayName, description: recipe.description,
    license: 'MIT', capabilities: recipe.skills.map(s => ({
      kind: 'skill', id: `${s.family}/${s.slug}`, entry: `skills/${s.family}/${s.slug}/SKILL.md`,
    })),
    permissions: [], lifecycle: { hooks: {}, removal: 'clean-context-required-if-loaded' },
    hostCompatibility: { status: 'integration-pending', runtimeManagedDiscovery: false, desktopInstall: false },
  };
}

export function payload(root, inputs, converted) {
  const { recipe, lock, sources } = inputs;
  const files = {
    'plugin.json': Buffer.from(json(manifest(recipe))),
    'licenses/agency-agents-MIT.txt': sources.LICENSE,
    'provenance/source-lock.json': inputs.lockBytes,
    'provenance/recipe.json': inputs.recipeBytes,
    'provenance/build-inputs.json': Buffer.from(json({
      schemaVersion: 1, nodeMajor: 24,
      recipeSha256: sha256(inputs.recipeBytes), sourceLockSha256: sha256(inputs.lockBytes),
      producerFiles: Object.fromEntries(PRODUCER_FILES.map(file => [file, sha256(readRegular(root, file))])),
      converter: { commit: lock.commit, entry: recipe.converter.entry, tool: recipe.converter.tool },
    })),
    'NOTICE.txt': Buffer.from('Agency Agents — MIT, Copyright (c) 2025 AgentLand Contributors.\n' +
      `Source: ${lock.repository} @ ${lock.commit}\n` +
      'Cats adds packaging metadata. Upstream persona/memory claims are instructions, not granted tools or persistent memory.\n' +
      'Converted bodies follow the pinned upstream normalization; originals and license are retained.\n' +
      'Internal producer preview: no Desktop installer, Runtime registry, hooks or provider supplied.\n'),
  };
  for (const skill of recipe.skills) {
    files[`skills/${skill.family}/${skill.slug}/SKILL.md`] = makeSkill(sources[skill.source], skill, recipe.version, converted?.[skill.slug]);
    files[`provenance/originals/${skill.source}`] = sources[skill.source];
  }
  files['integrity.json'] = Buffer.from(json(Object.fromEntries(Object.keys(files).sort().map(file => [file, {
    sha256: sha256(files[file]), size: files[file].length,
  }]))));
  return files;
}
