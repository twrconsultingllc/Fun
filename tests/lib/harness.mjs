/* Minimal assertion harness — no test framework dependency, so these files
   keep running years from now with nothing but node installed. */

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

export function createHarness() {
    let pass = 0, fail = 0;
    const failures = [];

    const record = (ok, name, detail) => {
        if (ok) {
            pass++;
            console.log(`  ${GREEN}ok${OFF}   ${name}${detail ? DIM + ' = ' + detail + OFF : ''}`);
        } else {
            fail++;
            failures.push(name);
            console.log(`  ${RED}FAIL${OFF} ${name}${detail ? '\n       ' + detail : ''}`);
        }
        return ok;
    };

    return {
        section(title) { console.log(`\n${BOLD}${title}${OFF}`); },

        eq(name, got, want) {
            const ok = String(got) === String(want);
            return record(ok, name, ok ? String(got) : `got  ${got}\n       want ${want}`);
        },

        near(name, got, want, tolerance) {
            const ok = Number.isFinite(got) && Math.abs(got - want) <= tolerance;
            return record(ok, name, ok ? String(got) : `got ${got}, want ${want} ±${tolerance}`);
        },

        ok(name, value) { return record(!!value, name, String(!!value)); },

        note(text) { console.log(`  ${DIM}${text}${OFF}`); },

        get totals() { return { pass, fail, failures }; }
    };
}

/* Pull the DOM-free math block out of a page so it can be tested directly.
   The page marks it with `===== PURE MATH START/END =====` comments. */
export function extractPureMath(html, exportNames) {
    const startMarker = html.indexOf('===== PURE MATH START =====');
    const endMarker = html.indexOf('===== PURE MATH END =====');
    if (startMarker === -1 || endMarker === -1) return null;

    // The markers sit inside /* */ comments; take the code between them.
    const codeStart = html.indexOf('*/', startMarker);
    const codeEnd = html.lastIndexOf('/*', endMarker);
    if (codeStart === -1 || codeEnd === -1 || codeEnd <= codeStart) return null;

    const body = html.slice(codeStart + 2, codeEnd);
    return `${body}\nreturn {${exportNames.join(',')}};`;
}
