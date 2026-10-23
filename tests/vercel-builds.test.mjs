/* The Vercel projects connected to this repo (battle-bots, battle-bots-V2, jarvis/cloud) each build only when their own
 * folder changed. Vercel runs a project's "ignoreCommand" in that folder before building: exit code 0 skips the build,
 * anything else builds. Every commit to this repo used to rebuild every project, which used up the account's daily
 * deployment limit on 2026-10-11.
 *
 * The command compares HEAD with VERCEL_GIT_PREVIOUS_SHA, the commit Vercel last deployed for that project and branch,
 * so changes made while builds were skipped or rate-limited still count. Without it (a first deploy) it falls back to
 * the commit before. Vercel clones only the latest commits, so after enough skipped builds the previous deploy falls out
 * of the clone. The command then also compares with the commit before. It used to let git fail there, assuming Vercel
 * would build, but Vercel treats any exit code other than 0 or 1 as a failed deployment: from 2026-10-12 every merge to
 * main showed "Deployment has failed" for fun and funv2 (review 91). So the command only ever exits 0 or 1.
 *
 * This suite runs the real command, from the real vercel.json files, in a scratch git repository. */

import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'Vercel builds only for the folder that changed (vercel.json ignoreCommand)';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FOLDERS = ['battle-bots', 'battle-bots-V2', 'jarvis/cloud'];

export default async function run(t) {
    t.section('Every Vercel project skips builds its folder had no part in');
    const cmds = [];
    for (const f of FOLDERS) {
        const vj = JSON.parse(await readFile(join(ROOT, f, 'vercel.json'), 'utf8'));
        t.ok(`${f}/vercel.json has an ignoreCommand`, typeof vj.ignoreCommand === 'string');
        cmds.push(vj.ignoreCommand);
    }
    t.ok('all three use the same command', cmds.every((c) => c === cmds[0]));
    t.ok('and every vercel.json kept its security headers', (await Promise.all(FOLDERS.map(async (f) => JSON.parse(await readFile(join(ROOT, f, 'vercel.json'), 'utf8'))))).every((v) => v.headers?.[0]?.headers?.some((h) => h.key === 'X-Content-Type-Options')));

    const dir = await mkdtemp(join(tmpdir(), 'vercel-builds-'));
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } }).trim();
    const touch = async (f, text) => { await mkdir(join(dir, f, '..'), { recursive: true }); await writeFile(join(dir, f), text); git('add', '-A'); git('commit', '-q', '-m', f); return git('rev-parse', 'HEAD'); };
    // Exit code of the command, run the way Vercel does: a shell, in the project's folder.
    const skipCode = (folder, prev) => spawnSync('sh', ['-c', cmds[0]], { cwd: join(dir, folder), env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: prev ?? '' } }).status;
    try {
        git('init', '-q', '-b', 'main');
        await touch('jarvis/cloud/a.js', '1'); await touch('battle-bots-V2/b.js', '1'); await touch('battle-bots/c.js', '1');
        const start = git('rev-parse', 'HEAD');
        await touch('daily-wire/feeds.json', 'news');
        t.eq('a commit that changes another folder: skipped', skipCode('jarvis/cloud', start), 0);
        t.eq('also with no previous deploy known (falls back to the commit before)', skipCode('battle-bots-V2', ''), 0);
        const beforeCloud = git('rev-parse', 'HEAD');
        await touch('jarvis/cloud/a.js', '2');
        t.eq('a commit that changes the folder: built', skipCode('jarvis/cloud', beforeCloud), 1);
        t.eq('but not the other projects', skipCode('battle-bots-V2', beforeCloud) + skipCode('battle-bots', beforeCloud), 0);
        await touch('index.html', 'later');
        t.eq('the folder changed in an earlier commit that never deployed (rate-limited): still built', skipCode('jarvis/cloud', beforeCloud), 1);
        t.eq('a previous deploy that isn\'t in the clone: compared with the commit before, so skipped here', skipCode('battle-bots', 'f'.repeat(40)), 0);
        await touch('jarvis/cloud/a.js', '3');
        t.eq('and built when that commit changed the folder', skipCode('jarvis/cloud', 'f'.repeat(40)), 1);
        // A merged pull request: the merge commit's first parent is main before it.
        git('checkout', '-q', '-b', 'pr'); await touch('battle-bots/c.js', '2'); await touch('battle-bots/notes.md', 'x');
        git('checkout', '-q', 'main'); git('merge', '-q', '--no-ff', 'pr', '-m', 'merge');
        t.eq('a merged pull request that changed battle-bots: built, with no previous deploy known', skipCode('battle-bots', ''), 1);
        t.eq('and skipped for battle-bots-V2', skipCode('battle-bots-V2', ''), 0);

        // Vercel's clone is shallow. Clone the scratch repo two commits deep and ask about a deploy older than that,
        // which is what happened to fun and funv2: git can't find the commit, and the command must still answer 0 or 1.
        const old = git('rev-list', '--max-parents=0', 'HEAD');
        await touch('index.html', 'one'); await touch('index.html', 'two');
        const shallow = join(dir, 'shallow');
        execFileSync('git', ['clone', '-q', '--depth=2', 'file://' + dir, shallow]);
        const shallowCode = (folder, prev) => spawnSync('sh', ['-c', cmds[0]], { cwd: join(shallow, folder), env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: prev } }).status;
        t.ok('the old deploy really is missing from the shallow clone', spawnSync('git', ['cat-file', '-e', old + '^{commit}'], { cwd: shallow }).status !== 0);
        t.eq('a shallow clone without the last deploy: skipped (not a failed deployment)', shallowCode('battle-bots', old), 0);
        t.eq('the same for battle-bots-V2', shallowCode('battle-bots-V2', old), 0);
        for (const f of FOLDERS) t.ok(`${f}: every answer is 0 or 1, never git's own error code`, [0, 1].includes(shallowCode(f, old)) && [0, 1].includes(shallowCode(f, '')));
    } finally { await rm(dir, { recursive: true, force: true }); }
}
