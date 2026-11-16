import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

// Application checks may skip root docs/ and the root agent instruction files
// (AGENTS.md, CLAUDE.md, CODEX.md, GEMINI.md), whose content CI treats as
// documentation. Keep executable test/build inputs in fixtures instead; quoted
// docs paths need a documented temporary-workspace use.
const sourceFile = /\.(?:[cm]?js|[cm]?ts|tsx)$/u;
const docsPath = /['"\x60](?:\.{1,2}\/)*docs\/|['"\x60]docs['"\x60]\s*[,)]/u;
// A quoted root agent instruction file. Nested copies such as sub/AGENTS.md
// are ordinary files that CI tests.
const agentFile = /['"\x60](?:\.{1,2}\/)*(?:AGENTS|CLAUDE|CODEX|GEMINI)\.md['"\x60]/u;
// Checking that a root agent file exists does not read it, and CI still runs
// when one is deleted. A line that also reads remains a violation.
const existenceCheck = /\b(?:exists|l?stat|access)(?:Sync)?\(/u;
const readsFile = /read/iu;
const ignoreMarker = /docs-boundary-ignore: \S/u;
const generatedWorkspacePaths = new Set([
  'tests/ci.test.mjs', // creates Git fixture docs and agent files under a temporary directory

]);
function listSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSources(path);
    return sourceFile.test(entry.name) ? [path] : [];
  });
}
const crossesBoundary = line => !ignoreMarker.test(line) &&
  (docsPath.test(line) || (agentFile.test(line) && !(existenceCheck.test(line) && !readsFile.test(line))));

test('the boundary flags docs/ and root agent file reads but allows existence checks', () => {
  for (const line of [
    "readFileSync('docs/guide.md', 'utf8')",
    "readFileSync(join(root, 'AGENTS.md'), 'utf8')",
    "readFile('./CLAUDE.md')",
    'const instructions = "../../CODEX.md";',
    'parse(`GEMINI.md`)',
    "if (existsSync('CODEX.md')) readFileSync('CODEX.md');",
    "existsSync('AGENTS.md') && readFileSync('AGENTS.md')",
  ]) assert.equal(crossesBoundary(line), true, line);
  for (const line of [
    "assert.ok(existsSync(join(root, 'AGENTS.md')))",
    "if (!(await stat(join(root, 'CLAUDE.md'))).isFile()) throw error;",
    "readFileSync('sub/AGENTS.md')",
    "readFileSync('README.md')",
    "readFileSync('AGENTS.md') // docs-boundary-ignore: temporary workspace fixture",
  ]) assert.equal(crossesBoundary(line), false, line);
});

test('tests, scripts and application sources do not consume repository docs as executable inputs', () => {
  const root = process.cwd();
  const violations = ['tests', 'scripts', 'src'].flatMap(dir => listSources(join(root, dir)))
    .map(path => relative(root, path).split(sep).join('/'))
    .filter(path => path !== 'tests/docs-boundary.test.mjs' && !generatedWorkspacePaths.has(path))
    .flatMap(path => readFileSync(join(root, path), 'utf8').split(/\r?\n/u)
      .map((line, index) => ({ line, at: path + ':' + (index + 1) }))
      .filter(({ line }) => crossesBoundary(line))
      .map(({ at, line }) => at + ': ' + line.trim()));
  assert.deepEqual(violations, [],
    'Move executable inputs into tests/fixtures/ instead of reading repository docs/ or root agent files.');
});
