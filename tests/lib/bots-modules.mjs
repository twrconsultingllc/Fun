/* Shared helper for the battle-bots-V2 suites: resolve a local directory
 * holding the ES module files under test, so they can be `import()`ed by a
 * real file: URL (Node's loader only resolves relative imports — entities.js
 * importing "./skills.js" — against file:/data: URLs, not https:).
 *
 * A local target already has the files on disk. A remote target (the live
 * Vercel deployment, or the same static files served off GitHub Pages) has
 * no filesystem to import from, so fetch each one into a temp dir first. */

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export function isRemote(page) {
    return /^https?:\/\//.test(page.source);
}

export async function resolveModuleDir(page, files) {
    if (!isRemote(page)) return { dir: dirname(page.source), cleanup: async () => {} };

    const dir = await mkdtemp(join(tmpdir(), 'bbv2-'));
    const base = page.source.replace(/index\.html$/, '');
    for (const file of files) {
        const res = await fetch(new URL(file, base));
        if (!res.ok) throw new Error(`fetching ${file}: HTTP ${res.status}`);
        await writeFile(join(dir, file), await res.text());
    }
    return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
