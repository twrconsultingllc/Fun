#!/usr/bin/env node
/* J.A.R.V.I.S. full brain — weights fetcher (Session 14 of jarvis/build-plan.html).
 *
 * Brings a small language model's weights into this repo, so jarvis-test.html can load them from this
 * site and never from Hugging Face. Every model it may fetch is listed in models.json: the Hugging Face
 * repo and the commit it's pinned to, the base model it was made from (whose licence is checked too),
 * the folder it goes in, and the SHA-256 of every file.
 *
 *   node fetch-model.mjs --pin=qwen3-0.6b     # download at the pinned (or latest) commit, check the licences
 *                                             # and sizes, print the hashes for models.json; writes nothing
 *   node fetch-model.mjs --model=qwen3-0.6b   # download at the pinned commit, refuse anything whose hash,
 *                                             # licence, file list or size isn't what models.json says, then
 *                                             # write the files into the repo
 *   node fetch-model.mjs --check=qwen3-0.6b   # check the files already in the repo against models.json
 *   node fetch-model.mjs --dry-run            # all of the above against tests/fixtures/jarvis-llm/, plus
 *                                             # the refusals (a changed chunk, a wrong licence, a file
 *                                             # too big, a file not listed); writes nothing in the repo
 *
 * The claude.ai/code containers get 403 from Hugging Face, so the real runs happen on GitHub's servers, from
 * the hand-run "J.A.R.V.I.S. language model" workflow (.github/workflows/jarvis-llm.yml). See README.md.
 *
 * Limits: every file under GitHub's 100 MB file limit, and the whole site (every tracked file plus the new
 * ones) under GitHub Pages' 1 GB limit. No dependencies: Node 22's own fetch.
 */

import { readFile, writeFile, mkdir, stat, rm, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const HF = 'https://huggingface.co/';
const USER_AGENT = 'JarvisFullBrain/1.0 (copies pinned open model weights; +https://github.com/twrconsultingllc/Fun)';

export const FILE_LIMIT = 100 * 1000 * 1000;   // GitHub refuses a file of 100 MiB; stay under 100 MB to be safe
export const SITE_LIMIT = 1000 * 1000 * 1000;  // GitHub Pages: a published site may be no larger than 1 GB
export const LICENCE = 'apache-2.0';
const SKIP = new Set(['.gitattributes']);       // git plumbing on Hugging Face, not part of the model
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // flat file names only: no folders, no "..", no hidden files
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class Refusal extends Error {}
const refuse = (msg) => { throw new Refusal(msg); };
const mb = (n) => (n / 1e6).toFixed(1) + ' MB';

/* ---------- The manifest ---------- */

export function checkManifest(models, { needPins = false } = {}) {
    if (!models || typeof models !== 'object') refuse('models.json is not an object');
    for (const [key, m] of Object.entries(models)) {
        if (key.startsWith('$')) continue; // "$comment"
        for (const f of ['repo', 'base', 'dir', 'licence']) if (typeof m[f] !== 'string' || !m[f]) refuse(`${key}: no ${f}`);
        if (m.licence !== LICENCE) refuse(`${key}: models.json may only list ${LICENCE} models, not ${m.licence}`);
        if (!/^[\w.-]+\/[\w.-]+$/.test(m.repo) || !/^[\w.-]+\/[\w.-]+$/.test(m.base)) refuse(`${key}: a repo name isn't owner/name`);
        if (!/^[\w./-]+$/.test(m.dir) || m.dir.split('/').some((p) => !p || p === '.' || p === '..')) refuse(`${key}: bad folder ${m.dir}`);
        // WebLLM only takes a model URL that has a "resolve/<name>/" in it, as Hugging Face's do.
        if (!/(^|\/)resolve\/[^/]+$/.test(m.dir)) refuse(`${key}: the folder must end in resolve/<name>, not ${m.dir}`);
        if (needPins) {
            if (!SHA.test(m.commit || '')) refuse(`${key}: no pinned commit for ${m.repo}`);
            if (!SHA.test(m.baseCommit || '')) refuse(`${key}: no pinned commit for ${m.base}`);
            if (!m.files || !Object.keys(m.files).length) refuse(`${key}: no file hashes`);
        }
        for (const [name, h] of Object.entries(m.files || {})) {
            if (!SAFE_NAME.test(name) || SKIP.has(name)) refuse(`${key}: bad file name ${name}`);
            if (!SHA256.test(h)) refuse(`${key}: ${name} has no SHA-256`);
        }
        if (m.files && m.files.LICENSE) refuse(`${key}: LICENSE is the base model's, so the model can't have its own of that name`);
        if (m.licenceFile && !SHA256.test(m.licenceFile)) refuse(`${key}: the licence file has no SHA-256`);
        if (needPins && !m.licenceFile) refuse(`${key}: no hash for the base model's licence`);
    }
    return models;
}

/* ---------- Getting things: the real Hugging Face, or the fixtures ---------- */

async function fetchReal(url, { binary } = {}) {
    let last;
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
            if (res.status === 404) throw Object.assign(new Error(`404 ${url}`), { final: true });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
        } catch (e) {
            if (e.final) throw e;
            last = e;
            console.log(`  ${url}: ${e.message} (try ${attempt} of 4)`);
            await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
        }
    }
    throw new Error(`couldn't fetch ${url}: ${last.message}`);
}

// Fixtures mirror Hugging Face's paths: api/models/<owner>/<name>/revision/<rev>.json and
// files/<owner>/<name>/<rev>/<file>. A URL that isn't one of those is an error, so the dry run can't
// quietly reach the network.
export function fixtureGetter(root) {
    return async (url, { binary } = {}) => {
        let m, path;
        if ((m = url.match(/^https:\/\/huggingface\.co\/api\/models\/([\w.-]+\/[\w.-]+)\/revision\/([\w.-]+)$/))) path = join(root, 'api', m[1], m[2] + '.json');
        else if ((m = url.match(/^https:\/\/huggingface\.co\/([\w.-]+\/[\w.-]+)\/resolve\/([\w.-]+)\/([\w.-]+)$/))) path = join(root, 'files', m[1], m[2], m[3]);
        else throw new Error(`the dry run has no fixture for ${url}`);
        const buf = await readFile(path).catch(() => { throw new Error(`404: no fixture ${relative(root, path)}`); });
        return binary ? buf : buf.toString('utf8');
    };
}

/* ---------- The checks ---------- */

// The licence as Hugging Face's tags give it, and as the model card (README.md's front matter, at the same
// pinned commit) states it. Both must say apache-2.0.
export function cardLicence(readme) {
    const m = String(readme || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const line = m[1].match(/^license:\s*["']?([\w.-]+)["']?\s*$/m);
    return line ? line[1].toLowerCase() : null;
}

export function checkLicence(info, readme, who) {
    const tags = (info.tags || []).filter((t) => t.startsWith('license:')).map((t) => t.slice(8));
    const card = cardLicence(readme);
    const facts = `tags [${tags.join(', ')}], model card ${card || 'no licence line'}`;
    console.log(`  ${who}: ${facts}`);
    const front = String(readme || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    console.log(`  ${who}: model card front matter: ${front ? JSON.stringify(front[1].slice(0, 600)) : 'none'}; first line: ${JSON.stringify(String(readme || '').replace(/^---[\s\S]*?---\s*/, '').split('\n')[0].slice(0, 120))}`);
    if (tags.length !== 1 || tags[0] !== LICENCE) refuse(`${who}: its licence tags are [${tags.join(', ')}], not exactly ${LICENCE} (${facts})`);
    if (card !== LICENCE) refuse(`${who}: its model card says the licence is ${card || 'nothing'}, not ${LICENCE} (${facts})`);
}

export function checkLicenceText(buf, who) {
    const text = buf.toString('utf8');
    if (!/Apache License\s+Version 2\.0, January 2004/.test(text)) refuse(`${who}: its LICENSE file isn't the Apache License 2.0`);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// The files a model repo publishes, minus git plumbing. Anything that isn't a flat, plain name is refused,
// so nothing can be written outside the model's folder.
export function filesOf(info, who) {
    const names = (info.siblings || []).map((s) => s.rfilename).filter((n) => !SKIP.has(n));
    for (const n of names) if (!SAFE_NAME.test(n)) refuse(`${who}: refusing the file name ${JSON.stringify(n)}`);
    if (names.includes('LICENSE')) refuse(`${who}: has its own LICENSE, which would clash with the base model's`);
    return names.sort();
}

// The size of what GitHub Pages would publish now: every tracked file, as it is on disk.
export async function siteSize(repo = REPO, { leaving = '' } = {}) {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    let total = 0;
    for (const f of out.split('\0')) {
        if (!f || (leaving && (f + '/').startsWith(leaving + '/'))) continue;
        try { total += (await stat(join(repo, f))).size; } catch { /* deleted in the working tree */ }
    }
    return total;
}

/* ---------- Pin, fetch, check ---------- */

async function revisionInfo(get, repo, rev) {
    return JSON.parse(await get(`${HF}api/models/${repo}/revision/${rev}`));
}

// Download one model at one commit and run every check except the hashes. Returns the files in memory.
async function download(get, key, m, commit, baseCommit, limits) {
    const info = await revisionInfo(get, m.repo, commit);
    if (info.sha !== commit) refuse(`${m.repo}: asked for ${commit}, Hugging Face answered for ${info.sha}`);
    checkLicence(info, await get(`${HF}${m.repo}/resolve/${commit}/README.md`).catch(() => ''), m.repo);
    const base = await revisionInfo(get, m.base, baseCommit);
    if (base.sha !== baseCommit) refuse(`${m.base}: asked for ${baseCommit}, Hugging Face answered for ${base.sha}`);
    checkLicence(base, await get(`${HF}${m.base}/resolve/${baseCommit}/README.md`).catch(() => ''), m.base);
    const names = filesOf(info, m.repo);
    if (!names.includes('mlc-chat-config.json') || !names.includes('ndarray-cache.json')) refuse(`${m.repo}: not an MLC model (no mlc-chat-config.json or ndarray-cache.json)`);
    const licence = await get(`${HF}${m.base}/resolve/${baseCommit}/LICENSE`, { binary: true });
    checkLicenceText(licence, m.base);
    const files = new Map();
    let total = 0;
    for (const n of names) {
        const buf = await get(`${HF}${m.repo}/resolve/${commit}/${n}`, { binary: true });
        if (buf.length >= limits.file) refuse(`${m.repo}: ${n} is ${mb(buf.length)}, over the ${mb(limits.file)} file limit`);
        total += buf.length;
        files.set(n, buf);
        console.log(`  ${n.padEnd(28)} ${mb(buf.length).padStart(9)}  ${sha256(buf)}`);
    }
    total += licence.length;
    return { files, licence, total, info, base };
}

export async function pin(get, key, m, limits) {
    const head = await revisionInfo(get, m.repo, m.commit || 'main');
    const baseHead = await revisionInfo(get, m.base, m.baseCommit || 'main');
    const { files, licence, total } = await download(get, key, m, head.sha, baseHead.sha, limits);
    const entry = { ...m, commit: head.sha, baseCommit: baseHead.sha, files: {}, licenceFile: sha256(licence), bytes: total };
    for (const [n, buf] of files) entry.files[n] = sha256(buf);
    return entry;
}

export async function fetchModel(get, key, m, limits, { repo = REPO, write = true } = {}) {
    checkManifest({ [key]: m }, { needPins: true });
    const { files, licence, total } = await download(get, key, m, m.commit, m.baseCommit, limits);
    const want = Object.keys(m.files).sort(), got = [...files.keys()].sort();
    const missing = want.filter((n) => !files.has(n)), extra = got.filter((n) => !m.files[n]);
    if (missing.length) refuse(`${m.repo}@${m.commit.slice(0, 7)} is missing ${missing.join(', ')}`);
    if (extra.length) refuse(`${m.repo}@${m.commit.slice(0, 7)} has files models.json doesn't list: ${extra.join(', ')}`);
    for (const [n, buf] of files) if (sha256(buf) !== m.files[n]) refuse(`${n}: its SHA-256 is ${sha256(buf)}, but models.json says ${m.files[n]}`);
    if (sha256(licence) !== m.licenceFile) refuse(`${m.base} LICENSE: its SHA-256 is ${sha256(licence)}, but models.json says ${m.licenceFile}`);
    const site = (await limits.site0(m.dir)) + total;
    if (site >= limits.site) refuse(`the site would be ${mb(site)} with this model, over the ${mb(limits.site)} limit`);
    console.log(`${m.repo}@${m.commit.slice(0, 7)}: ${files.size} files and the licence, ${mb(total)}; the site would be ${mb(site)}`);
    if (!write) return { total, site };
    const dir = join(repo, ...m.dir.split('/'));
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const [n, buf] of files) await writeFile(join(dir, n), buf);
    await writeFile(join(dir, 'LICENSE'), licence);
    return { total, site };
}

export async function checkFiles(key, m, repo = REPO) {
    checkManifest({ [key]: m }, { needPins: true });
    const dir = join(repo, ...m.dir.split('/'));
    let total = 0;
    for (const [n, h] of Object.entries({ ...m.files, LICENSE: m.licenceFile })) {
        const buf = await readFile(join(dir, n)).catch(() => refuse(`${m.dir}/${n} is missing`));
        if (buf.length >= FILE_LIMIT) refuse(`${m.dir}/${n} is over the file limit`);
        if (sha256(buf) !== h) refuse(`${m.dir}/${n}: its SHA-256 is ${sha256(buf)}, not ${h}`);
        total += buf.length;
    }
    return total;
}

/* ---------- The dry run: the real code path against fixtures, then each refusal ---------- */

export async function dryRun(fixtures, log = console.log) {
    const get = fixtureGetter(fixtures);
    const models = checkManifest(JSON.parse(await readFile(join(fixtures, 'models.json'), 'utf8')));
    const limits = { file: 4096, site: 64 * 1024, site0: async () => 1000 };
    const out = await mkdtemp(join(tmpdir(), 'jarvis-llm-'));
    try {
        const pinned = await pin(get, 'sample', { ...models.sample, commit: undefined, baseCommit: undefined, files: undefined, licenceFile: undefined }, limits);
        for (const f of ['commit', 'baseCommit', 'licenceFile']) if (pinned[f] !== models.sample[f]) throw new Error(`dry run: pin gave ${f} ${pinned[f]}, models.json has ${models.sample[f]}`);
        if (JSON.stringify(pinned.files) !== JSON.stringify(Object.fromEntries(Object.entries(models.sample.files).sort()))) throw new Error('dry run: pin gave different hashes from models.json');
        await fetchModel(get, 'sample', models.sample, limits, { repo: out });
        await checkFiles('sample', models.sample, out);
        log(`dry run: the sample model pinned, fetched and checked (${Object.keys(models.sample.files).length} files)`);
        // Each of these must be refused. A run that lets one through fails.
        const tampered = { ...models.sample, files: { ...models.sample.files, 'params_shard_0.bin': '0'.repeat(64) } };
        const cases = [
            ['a changed chunk', () => fetchModel(get, 'sample', tampered, limits, { write: false })],
            ['a model whose licence is GPL', () => fetchModel(get, 'gpl', models.gpl, limits, { write: false })],
            ['a base model whose licence is GPL', () => fetchModel(get, 'gplBase', models.gplBase, limits, { write: false })],
            ['a file over the file limit', () => fetchModel(get, 'sample', models.sample, { ...limits, file: 1024 }, { write: false })],
            ['a site over the site limit', () => fetchModel(get, 'sample', models.sample, { ...limits, site0: async () => limits.site }, { write: false })],
            ['a file models.json does not list', () => fetchModel(get, 'sample', { ...models.sample, files: Object.fromEntries(Object.entries(models.sample.files).slice(1)) }, limits, { write: false })],
            ['a commit that is not pinned', () => fetchModel(get, 'sample', { ...models.sample, commit: undefined }, limits, { write: false })],
            ['a model card whose licence differs from its tags', () => fetchModel(get, 'mixed', models.mixed, limits, { write: false })],
            ['a file name with a folder in it', () => fetchModel(get, 'sneaky', models.sneaky, limits, { write: false })],
            ['a changed chunk already on disk', async () => { await writeFile(join(out, ...models.sample.dir.split('/'), 'params_shard_1.bin'), 'changed'); await checkFiles('sample', models.sample, out); }]
        ];
        let refused = 0;
        for (const [what, run] of cases) {
            try { await run(); } catch (e) {
                if (e instanceof Refusal) { log(`dry run: refused ${what}: ${e.message}`); refused++; continue; }
                throw e;
            }
            throw new Error(`dry run: ${what} was NOT refused`);
        }
        log(`dry run passed: ${refused} of ${cases.length} refused as they should be`);
        return refused;
    } finally {
        await rm(out, { recursive: true, force: true });
    }
}

/* ---------- Command line ---------- */

async function main(argv) {
    const arg = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
    if (argv.includes('--dry-run')) {
        await dryRun(arg('fixtures') || join(REPO, 'tests', 'fixtures', 'jarvis-llm'));
        return 0;
    }
    const models = checkManifest(JSON.parse(await readFile(join(HERE, 'models.json'), 'utf8')));
    const key = arg('pin') || arg('model') || arg('check');
    const m = models[key];
    if (!key || !m) { console.error(`Usage: --pin=<model>, --model=<model> or --check=<model>, where <model> is one of: ${Object.keys(models).filter((k) => !k.startsWith('$')).join(', ')}`); return 2; }
    const limits = { file: FILE_LIMIT, site: SITE_LIMIT, site0: (leaving) => siteSize(REPO, { leaving }) };
    if (arg('check')) {
        console.log(`${m.dir}: ${mb(await checkFiles(key, m))}, every hash as models.json says`);
        return 0;
    }
    if (arg('pin')) {
        const entry = await pin(fetchReal, key, m, limits);
        const site = (await siteSize(REPO, { leaving: m.dir })) + entry.bytes;
        if (site >= SITE_LIMIT) refuse(`the site would be ${mb(site)} with this model, over the ${mb(SITE_LIMIT)} limit`);
        console.log(`Pinned ${key}: ${Object.keys(entry.files).length} files and the licence, ${mb(entry.bytes)} (${entry.bytes} bytes); the site would be ${mb(site)}.`);
        console.log('Put this in jarvis/llm/models.json, then run the workflow again with "fetch":');
        console.log('----- models.json entry -----');
        console.log(JSON.stringify({ [key]: entry }, null, 2));
        console.log('-----------------------------');
        return 0;
    }
    await fetchModel(fetchReal, key, m, limits);
    return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
        console.error(e instanceof Refusal ? `Refused: ${e.message}` : e);
        process.exit(1);
    });
}
