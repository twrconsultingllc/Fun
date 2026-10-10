import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
// Writes the dry-run fixtures for jarvis/llm/fetch-model.mjs into this folder. To rebuild them:
//   node tests/fixtures/jarvis-llm/make-fixtures.mjs
// Everything is deterministic, so a rebuild gives the same files and hashes.
const here = new URL('./', import.meta.url).pathname;
const root = process.argv[2] || here, lic = process.argv[3] || new URL('../../../jarvis/llm/LICENSE-web-llm', import.meta.url).pathname;
const h = (b) => createHash('sha256').update(b).digest('hex');
const C = { model: '1111111111111111111111111111111111111111', base: '2222222222222222222222222222222222222222', gpl: '3333333333333333333333333333333333333333', gplBase: '4444444444444444444444444444444444444444', sneaky: '5555555555555555555555555555555555555555', mixed: '6666666666666666666666666666666666666666', silent: '7777777777777777777777777777777777777777', orphan: '8888888888888888888888888888888888888888', child: '9999999999999999999999999999999999999999' };
// Deterministic bytes, so the fixtures never change between runs.
const bytes = (n, seed) => { const b = Buffer.alloc(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const files = {
  'mlc-chat-config.json': Buffer.from(JSON.stringify({ model_type: 'sample', context_window_size: 512, tokenizer_files: ['tokenizer.json'] }, null, 2) + '\n'),
  'ndarray-cache.json': Buffer.from(JSON.stringify({ metadata: { ParamSize: 2 }, records: [{ dataPath: 'params_shard_0.bin', nbytes: 2000 }, { dataPath: 'params_shard_1.bin', nbytes: 1500 }] }, null, 2) + '\n'),
  'params_shard_0.bin': bytes(2000, 7),
  'params_shard_1.bin': bytes(1500, 11),
  'tokenizer.json': Buffer.from(JSON.stringify({ version: '1.0', model: { type: 'BPE', vocab: { a: 0, b: 1 } } }) + '\n'),
  'README.md': Buffer.from('---\nlicense: apache-2.0\nbase_model: sample-org/Sample\n---\n\n# Sample-MLC\n\nA fixture for jarvis/llm/fetch-model.mjs --dry-run. Not a real model.\n')
};
const silentCard = Buffer.from('---\nlibrary_name: mlc-llm\nbase_model: sample-org/Sample\ntags:\n- mlc-llm\n---\n\n# Silent-MLC\n\nA fixture like mlc-ai\'s builds: no licence line.\n');
const licence = Buffer.from(readFileSync(lic, 'utf8').split('\n').slice(0, 12).join('\n') + '\n\n   (Fixture: the first lines of the Apache License 2.0, enough for the dry run.)\n');
const api = (id, sha, license, sibs) => JSON.stringify({ id, sha, tags: ['mlc-llm', `license:${license}`], cardData: { license }, siblings: sibs.map((rfilename) => ({ rfilename })) }, null, 2) + '\n';
const put = (p, b) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), b); };
const sibs = ['.gitattributes', ...Object.keys(files)];
for (const rev of ['main', C.model]) put(`api/sample-org/Sample-MLC/${rev}.json`, api('sample-org/Sample-MLC', C.model, 'apache-2.0', sibs));
for (const rev of ['main', C.base]) put(`api/sample-org/Sample/${rev}.json`, api('sample-org/Sample', C.base, 'apache-2.0', ['LICENSE', 'README.md']));
put(`api/sample-org/Gpl-MLC/${C.gpl}.json`, api('sample-org/Gpl-MLC', C.gpl, 'gpl-3.0', sibs));
put(`api/sample-org/Gpl/${C.gplBase}.json`, api('sample-org/Gpl', C.gplBase, 'gpl-3.0', ['LICENSE']));
put(`api/sample-org/Sneaky-MLC/${C.sneaky}.json`, api('sample-org/Sneaky-MLC', C.sneaky, 'apache-2.0', [...sibs, '../escape.bin']));
for (const [n, b] of Object.entries(files)) { put(`files/sample-org/Sample-MLC/${C.model}/${n}`, b); put(`files/sample-org/Sneaky-MLC/${C.sneaky}/${n}`, b); }
put(`files/sample-org/Sample/${C.base}/LICENSE`, licence);
const card = (l) => Buffer.from(`---\nlicense: ${l}\n---\n\nA fixture model card.\n`);
put(`files/sample-org/Sample/${C.base}/README.md`, card('apache-2.0'));
put(`files/sample-org/Gpl-MLC/${C.gpl}/README.md`, card('gpl-3.0'));
put(`files/sample-org/Gpl/${C.gplBase}/README.md`, card('gpl-3.0'));
// Tags say apache-2.0, but the card at that commit says otherwise: refused.
put(`api/sample-org/Mixed-MLC/${C.mixed}.json`, api('sample-org/Mixed-MLC', C.mixed, 'apache-2.0', sibs));
put(`files/sample-org/Mixed-MLC/${C.mixed}/README.md`, card('cc-by-nc-4.0'));
// Like mlc-ai's real builds: no licence of its own, and a card naming its base. Inherits the base's: accepted.
const noTags = (id, sha) => JSON.stringify({ id, sha, tags: ['mlc-llm'], siblings: sibs.map((rfilename) => ({ rfilename })) }, null, 2) + '\n';
put(`api/sample-org/Silent-MLC/${C.silent}.json`, noTags('sample-org/Silent-MLC', C.silent));
for (const [n, b] of Object.entries(files)) put(`files/sample-org/Silent-MLC/${C.silent}/${n}`, n === 'README.md' ? silentCard : b);
// No licence of its own, and a card naming a different base: refused.
// No licence of its own, and a card naming a GPL base: it inherits GPL, so the base check refuses it.
put(`api/sample-org/GplChild-MLC/${C.child}.json`, noTags('sample-org/GplChild-MLC', C.child));
put(`files/sample-org/GplChild-MLC/${C.child}/README.md`, Buffer.from('---\nlibrary_name: mlc-llm\nbase_model: sample-org/Gpl\n---\n\nA fixture model card.\n'));
put(`api/sample-org/Orphan-MLC/${C.orphan}.json`, noTags('sample-org/Orphan-MLC', C.orphan));
put(`files/sample-org/Orphan-MLC/${C.orphan}/README.md`, Buffer.from('---\nlibrary_name: mlc-llm\nbase_model: someone-else/Other\n---\n\nA fixture model card.\n'));
const fh = Object.fromEntries(Object.entries(files).map(([n, b]) => [n, h(b)]).sort());
const entry = (repo, commit, base, baseCommit) => ({ repo, commit, base, baseCommit, licence: 'apache-2.0', dir: 'resolve/Sample-MLC', files: fh, licenceFile: h(licence) });
const models = {
  $comment: 'Fixtures for jarvis/llm/fetch-model.mjs --dry-run. "sample" must pass; the others must be refused.',
  sample: entry('sample-org/Sample-MLC', C.model, 'sample-org/Sample', C.base),
  gpl: entry('sample-org/Gpl-MLC', C.gpl, 'sample-org/Sample', C.base),
  gplBase: entry('sample-org/GplChild-MLC', C.child, 'sample-org/Gpl', C.gplBase),
  sneaky: entry('sample-org/Sneaky-MLC', C.sneaky, 'sample-org/Sample', C.base),
  mixed: entry('sample-org/Mixed-MLC', C.mixed, 'sample-org/Sample', C.base),
  silent: { ...entry('sample-org/Silent-MLC', C.silent, 'sample-org/Sample', C.base), files: { ...fh, 'README.md': h(silentCard) } },
  orphan: entry('sample-org/Orphan-MLC', C.orphan, 'sample-org/Sample', C.base)
};
put('models.json', JSON.stringify(models, null, 2) + '\n');
