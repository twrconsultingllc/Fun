/* fullcircle.html — regression tests for the medallion artwork itself.
 *
 * This page has no PURE MATH block and no window.__pagename hook (see the
 * battle-bots-V2 note in tests/README.md for why a WebGL page like this one
 * is awkward to drive in jsdom at all — paintIdleArena-style canvas calls at
 * import time, no local `canvas`/chromium-cli). So this suite works directly
 * on the page's HTML text instead of rendering it, pinning the specific
 * regressions a follow-up edit could reintroduce:
 *
 *   - the ring words (SWIM / BIKE / RUN / …) drifting back onto the gear's
 *     teeth instead of sitting on the solid backing plate behind them
 *   - the "more, liquid-mercury" water droplets shrinking back down
 *   - the swimmer/cyclist/runner pictograms losing their liquid-mercury-free,
 *     always-polished droplet override, or the static <svg> and the 3D
 *     LOGO_SVG drifting out of sync with each other
 *
 * None of this checks that the artwork *looks* good — that was judged by
 * rendering it (see the session that added this file). It only pins the
 * numbers and structure that made it look good from regressing silently.
 */

export const name = 'Full Circle — medallion artwork regressions';

function countOccurrences(haystack, needle) {
    return haystack.split(needle).length - 1;
}

export default async function run(t, page) {
    const html = page.html;

    t.section('Ring text sits on the solid gear plate, not the teeth');

    const staticRadiusMatch = html.match(/id="ringTextPath" d="M 50 50 m -([\d.]+),0/);
    t.ok('static ringTextPath radius is present', !!staticRadiusMatch);
    if (staticRadiusMatch) {
        const r = Number(staticRadiusMatch[1]);
        // The gear's teeth start at r≈45.6 svg units (root of the zigzag) and
        // the white face plate ends at r=39.6 — the solid backing band is the
        // gap between them. Anything at or past ~45.6 starts riding onto teeth.
        t.ok(`static ring-text radius (${r}) sits inside the solid band (39.6–45.6)`, r > 39.6 && r < 45.6);
    }

    const jsRadiusMatch = html.match(/const RING_TEXT_RADIUS = ([\d.]+);/);
    t.ok('3D RING_TEXT_RADIUS constant is present', !!jsRadiusMatch);
    if (jsRadiusMatch) {
        const r = Number(jsRadiusMatch[1]);
        t.ok(`3D ring-text radius (${r}) sits inside the solid band (39.6–45.6)`, r > 39.6 && r < 45.6);
    }

    t.section('Ring text is stylized to match the metal wordmark, not flat-filled');

    t.ok('static ring text fills with the metal-sweep gradient', html.includes('fill="url(#ringTextGrad)"'));
    t.ok('ringTextGrad gradient is defined', /id="ringTextGrad"/.test(html));
    t.ok('the 3D ring words paint a metallic base gradient', /paintRingWord/.test(html) && /createLinearGradient/.test(html));
    t.ok('the 3D ring words get a moving specular sweep, not a static fill', html.includes("globalCompositeOperation = 'source-atop'"));

    t.section('Water droplets — more of them, and always liquid mercury');

    const staticDroplets = countOccurrences(html, 'fill="url(#dropGrad)"') > 0
        ? (html.match(/<g fill="url\(#dropGrad\)">([\s\S]*?)<\/g>/) || [null, ''])[1]
        : '';
    const staticDropletCount = countOccurrences(staticDroplets, '<path');
    t.ok(`static mark has more than the original 6 droplets (got ${staticDropletCount})`, staticDropletCount >= 12);

    const logoDropletCount = countOccurrences(html, 'data-layer="droplet"');
    t.eq('the 3D LOGO_SVG has the same droplet count as the static mark', logoDropletCount, staticDropletCount);

    t.ok('LIQUID_MERCURY material override is defined', /const LIQUID_MERCURY = \{/.test(html));
    t.ok('buildLogo tags droplet materials as liquid mercury', /material\.userData\.liquidMercury = true/.test(html));
    t.ok('applyFinish leaves liquid-mercury materials alone', /if \(material\.userData\.liquidMercury\) return;/.test(html));

    t.section('Swimmer / cyclist / runner pictograms were redesigned, and stay in sync');

    const staticPictoBlock = (html.match(/<g fill="#0d3a63" fill-rule="evenodd">([\s\S]*?)<\/g>/) || [null, ''])[1];
    const staticPictoCount = countOccurrences(staticPictoBlock, '<path');
    const logoPictoCount = countOccurrences(html, 'data-layer="pictogram"');

    // The old three-figure artwork was 28 paths total; the redesigned figures
    // (real limbs instead of single jagged strokes) use noticeably more.
    t.ok(`static mark's pictogram path count grew past the old design (got ${staticPictoCount})`, staticPictoCount > 30);
    t.eq('the 3D LOGO_SVG has the same pictogram path count as the static mark', logoPictoCount, staticPictoCount);

    // A fingerprint of the old swimmer head circle — if this reappears, the
    // static mark and the 3D LOGO_SVG have drifted apart again rather than
    // both carrying the redesigned figures.
    t.ok('the old swimmer-head path is gone', !html.includes('M 30.4 47.6 A 1.9 1.9 0 1 0 26.6 47.6'));

    t.section('Wordmark styling untouched by the ring-text change');
    t.ok('the FULL CIRCLE wordmark still uses its own brushed-metal gradient', /\.wordmark-line\s*\{[\s\S]*?background: linear-gradient/.test(html));
}
