/* shader-lab.html — pins the literal GLSL preset source without ever
 * needing a real GL context, the same way tricalc.html's PURE MATH markers
 * let the core suite check math without a DOM. The presets live between
 * `/* ===== SHADER PRESETS START ===== *\/` and the matching END marker in
 * the page's inline script.
 */

export const name = 'Shader Lab — GLSL preset source integrity';

function extractPresetBlock(html) {
    const start = html.indexOf('SHADER PRESETS START');
    const end = html.indexOf('SHADER PRESETS END');
    if (start === -1 || end === -1 || end <= start) return null;
    const blockStart = html.indexOf('*/', start);
    const blockEnd = html.lastIndexOf('/*', end);
    if (blockStart === -1 || blockEnd === -1 || blockEnd <= blockStart) return null;
    return html.slice(blockStart + 2, blockEnd);
}

export default async function run(t, page) {
    t.section('Preset markers');

    const block = extractPresetBlock(page.html);
    t.ok('the SHADER PRESETS markers are present', !!block);
    if (!block) return;

    t.section('Every preset is defined and shape-valid');

    const expected = ['plasma', 'tunnel', 'voronoi', 'julia'];
    for (const id of expected) {
        const re = new RegExp(id + '\\s*:\\s*\\[');
        t.ok(`${id} preset is defined`, re.test(block));
    }

    const shadeCount = (block.match(/vec3 shade\(/g) || []).length;
    t.eq('exactly one shade() entry point per preset', shadeCount, expected.length);

    const openBraces = (block.match(/\{/g) || []).length;
    const closeBraces = (block.match(/\}/g) || []).length;
    t.eq('braces balance across all preset source', openBraces, closeBraces);

    const openParens = (block.match(/\(/g) || []).length;
    const closeParens = (block.match(/\)/g) || []).length;
    t.eq('parens balance across all preset source', openParens, closeParens);
}
