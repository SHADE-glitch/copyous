// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — the shell-side half of docs/maintenance/compatibility-matrix.md.
//
// Which typelibs are guaranteed is not an opinion: it is the set of gi:// namespaces the
// shell's own modules import, read out of the installed shell. Our shell-side code may
// statically `import X from 'gi://X'` only for a member of that set. Anything else has to
// be loaded with `await import()` and handled when it throws, because a static import of a
// missing typelib fails during module resolution -- the extension then does not load at
// all, instead of losing one feature.
//
// That is exactly how F19 happened: `lib/ui/components/contentInfo.js` statically imported
// gi://Gst, which only ships as gir1.2-gstreamer-1.0, so a machine without it could not
// enable the extension just to print a media duration.
//
// The rules and their CI-vs-local split are documented once, in the script's own header:
//   node scripts/shell-internals.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(json) {
    const r = spawnSync('node', [path.join('scripts', 'shell-internals.mjs'), ...(json ? ['--json'] : [])], {
        cwd: REPO,
        encoding: 'utf8',
        maxBuffer: 1 << 26,
    });
    return { code: r.status, out: r.stdout };
}

describe('shell-internal dependency inventory', () => {
    const text = run(false);
    const counts = JSON.parse(run(true).out);

    it('passes, and says so', () => {
        assert.equal(text.code, 0, `script exited ${text.code}:\n${text.out}`);
        assert.match(text.out, /RESULT: PASS/);
        assert.doesNotMatch(text.out, /^FAIL:/m, 'a FAIL line went uncounted');
    });

    it('no shell-side file statically imports a typelib the shell does not guarantee', () => {
        assert.deepEqual(counts.unguaranteed, [],
            `statically imported but not in the shell's own install set: ${counts.unguaranteed}`);
        assert.deepEqual(counts.contradicted, [],
            `loaded dynamically somewhere and statically elsewhere: ${counts.contradicted}`);
        // Both assertions above are vacuously true if the parser stopped seeing imports,
        // so the sets it was computed from have to be non-trivial.
        assert.ok(counts.staticallyImported.length > 8,
            `only ${counts.staticallyImported.length} static namespaces seen -- the import pattern no longer matches`);
        assert.ok(counts.optionalNamespaces.length >= 2,
            `only ${counts.optionalNamespaces} seen as optional -- rule 1 has nothing to check`);
    });

    it('reports the guaranteed-set cross-check honestly, inert is not silent', () => {
        if (counts.libshell) {
            assert.ok(Array.isArray(counts.literalDrift),
                'libshell was found but no drift result was produced');
            assert.deepEqual(counts.literalDrift, [],
                `GUARANTEED lists namespaces the installed shell no longer imports: ${counts.literalDrift}`);
            assert.match(text.out, /guaranteed-set cross-check\s*: \/usr\/lib\/gnome-shell\/libshell-\d+\.so yields \d+ namespaces/);
        } else {
            // CI has no GNOME Shell. The two machine-free rules still ran, and the output
            // has to say the third did not -- reading that as a pass is how this dies.
            assert.match(text.out, /guaranteed-set cross-check\s*: INERT/);
        }
    });

    it('still describes a real inventory, not an empty one', () => {
        assert.ok(counts.symbols > 20, `only ${counts.symbols} private symbols found -- a rename of the import path would silently empty this`);
        assert.ok(counts.modules > 10, `only ${counts.modules} modules found`);
        assert.ok(counts.rows.every((r) => r.files.length > 0), 'a symbol with no file is a parser bug, not a dependency');
    });
});
