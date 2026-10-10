#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — render the settings reference for the READMEs, or check it is current.
//
//   node scripts/settings-reference.mjs --print          # the markdown block (English)
//   node scripts/settings-reference.mjs --check          # exit 2 if a README is stale
//   node scripts/settings-reference.mjs --write          # refresh the marked blocks
//
// Why generated: the schema is the only authority on which settings exist. A hand-kept
// table rots the moment a key is added -- the README then advertises a setting that is not
// there, or hides one that is. Every cell here comes out of `schemas/*.xml`, and the parser
// self-checks its own key count against the raw `<key` occurrences, because a parser that
// silently drops one shape (the `flags=` bug of 2026-10-09) would publish an incomplete
// reference that still looks tidy.
//
// What is deliberately NOT in the table: a per-key description. The description of every
// row lives in the settings window as its subtitle, `test/prefs/run.sh` checks that those
// subtitles exist, and a second copy in the README would be a second owner for the same
// sentence. The table answers "which keys are there and what do they hold", the UI answers
// "what does this one do".

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = path.join('schemas', 'org.gnome.shell.extensions.copyous.gschema.xml');
const READMES = ['README.md', 'README.zh-CN.md'];
const START = '<!-- settings-reference:start -->';
const END = '<!-- settings-reference:end -->';

const xml = fs.readFileSync(path.join(REPO, SCHEMA), 'utf8');

const enumBlocks = new Map();
for (const m of xml.matchAll(/<enum id="([^"]+)"[\s\S]*?<\/enum>/g))
    enumBlocks.set(m[1], [...m[0].matchAll(/nick="([^"]+)"/g)].map((n) => n[1]));

const schemas = [...xml.matchAll(/<schema\s+([^>]*)>([\s\S]*?)<\/schema>/g)].map((m) => {
    const id = /id="([^"]+)"/.exec(m[1])?.[1] ?? '';
    const body = m[2];
    const keys = [...body.matchAll(/<key\s+name="([^"]+)"\s+([^>]*)>([\s\S]*?)<\/key>/g)].map((k) => {
        const [, name, rest, inner] = k;
        const enumId = /enum="([^"]+)"/.exec(rest)?.[1] ?? /flags="([^"]+)"/.exec(rest)?.[1];
        const kind = /type="([^"])"/.exec(rest)?.[1] ?? (enumId ? (/flags=/.test(rest) ? 'flags' : 'enum') : '?');
        return {
            name,
            kind,
            def: /<default(?:\s+empty="true")?\s*>([\s\S]*?)<\/default>/.exec(inner)?.[1]?.trim()
                ?? (/<default empty="true"/.test(inner) ? '(empty)' : '(none)'),
            min: /<range\s+min="(-?[\d.]+)"/.exec(inner)?.[1],
            max: /max="(-?[\d.]+)"/.exec(inner)?.[1],
            choices: enumId ? enumBlocks.get(enumId) : null,
        };
    });
    return { id, keys };
});

const declared = schemas.reduce((n, s) => n + s.keys.length, 0);
const rawDeclared = (xml.match(/<key\s+name="/g) ?? []).length;
if (declared !== rawDeclared) {
    console.error(`FAIL: the schema declares ${rawDeclared} keys but the parser found ${declared}`);
    process.exit(2);
}

const KIND = { b: 'boolean', i: 'integer', u: 'unsigned', d: 'double', s: 'string', as: 'string array', ay: 'byte array', n: 'nullable', enum: 'enum', flags: 'flag set', '?': 'unknown' };
const SHORT = (id) => id.replace('org.gnome.shell.extensions.copyous', '(root)');

// The reset-coverage figure is read out of the gate that computes it, not typed here: this
// script generates README text, and a stale aggregate inside generated text is invisible.
let coverage = null;
try {
    const cov = execFileSync('node', ['scripts/settings-coverage.mjs'], { cwd: REPO, encoding: 'utf8' });
    coverage = /controls with a reset button:\s*(\d+)\/(\d+)/.exec(cov);
} catch {
    coverage = null;
}
const COVER = coverage ? `${coverage[1]} of ${coverage[2]}` : 'coverage unknown (settings-coverage.mjs did not answer)';

function render(zh) {
    const head = zh
        ? ['键名', '类型', '默认值', '取值范围 / 选项']
        : ['Key', 'Type', 'Default', 'Range / choices'];
    const out = [];
    for (const s of schemas) {
        out.push(`### \`${SHORT(s.id)}\``, '');
        out.push(`| ${head.join(' | ')} |`);
        out.push(`|${head.map(() => '---|').join('')}`);
        for (const k of s.keys) {
            const notes = k.choices ? k.choices.join(' / ')
                : k.min !== undefined ? `${k.min} – ${k.max}` : '—';
            out.push(`| \`${k.name}\` | ${KIND[k.kind] ?? k.kind} | \`${k.def}\` | ${notes} |`);
        }
        out.push('');
    }
    out.push(zh
        ? `共 **${declared}** 个键，分布在 **${schemas.length}** 条 schema 路径。每个有控件的键在设置窗里都对应一行，行右侧的 undo 按钮把它送回默认值（**${COVER}** 个控件覆盖，由 \`node scripts/settings-coverage.mjs\` 把关）；每一行的副标题写明它改什么，那是这些说明唯一的主人。本表由 \`node scripts/settings-reference.mjs --write\` 生成，不要手改。`
        : `${declared} keys across ${schemas.length} schema paths. Every key with a control has a row in the settings window, and the undo button on that row is the way back to its default (**${COVER}** controls covered -- \`node scripts/settings-coverage.mjs\` proves it). The subtitle under each row says what the setting changes, and that row is the only owner of that sentence. Generated by \`node scripts/settings-reference.mjs --write\` -- do not edit by hand.`);
    return out.join('\n');
}

const block = (zh) => `${START}\n${render(zh)}\n${END}`;

if (process.argv.includes('--print')) {
    console.log(block(false));
    process.exit(0);
}

let bad = 0;
for (const f of READMES) {
    const p = path.join(REPO, f);
    const text = fs.readFileSync(p, 'utf8');
    const fresh = block(f.endsWith('.zh-CN.md'));
    if (!text.includes(START) || !text.includes(END)) {
        console.error(`FAIL: ${f} has no settings-reference block (expected between ${START} and ${END})`);
        bad++;
        continue;
    }
    const out = text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), fresh);
    if (process.argv.includes('--write')) {
        fs.writeFileSync(p, out);
        console.log(`${f}: ${out !== text ? 'refreshed' : 'already current'}`);
    } else if (process.argv.includes('--check') && out !== text) {
        console.error(`FAIL: ${f} is stale -- run node scripts/settings-reference.mjs --write`);
        bad++;
    } else {
        console.log(`${f}: current (${declared} keys)`);
    }
}
if (bad && !process.argv.includes('--write')) process.exit(2);
if (bad) process.exit(2);
console.log(`RESULT: PASS (${declared} keys, ${schemas.length} schema paths)`);
