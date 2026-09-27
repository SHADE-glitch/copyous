/**
 * Converts a glob pattern to a regular expression.
 * @param patterns The glob patterns.
 * @returns The regular expression.
 */
export function globToRegex(...patterns) {
	return patterns.flatMap(expandBraces).map(translate).join('|');
}

// Split on commas that are not inside a nested brace group.
function splitTopLevel(s) {
	const parts = [];
	let depth = 0;
	let current = '';
	for (const ch of s) {
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
		if (ch === ',' && depth === 0) {
			parts.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	parts.push(current);
	return parts;
}

function expandBraces(pattern) {
	let result = '';
	let i = 0;
	const n = pattern.length;
	while (i < n) {
		const c = pattern[i];
		i++;
		if (c === '{') {
			// Find the matching closing brace, tracking nesting: a scan for
			// the first '}' mis-splits patterns like {a,b{c,d}}.
			let depth = 1;
			let j = i;
			while (j < n) {
				const ch = pattern[j];
				if (ch === '{') depth++;
				else if (ch === '}') {
					depth--;
					if (depth === 0) break;
				}
				j++;
			}
			if (j >= n) {
				// Unbalanced '{': keep the rest literally (including the brace).
				result += pattern.substring(i - 1);
				break;
			}
			const remainder = expandBraces(pattern.substring(j + 1));
			const prefix = result;
			return splitTopLevel(pattern.substring(i, j))
				.flatMap((s) => expandBraces(s))
				.flatMap((s) => remainder.map((r) => `${prefix}${s}${r}`));
		} else {
			result += c;
		}
	}
	return [result];
}

function translate(pattern) {
	let result = '';
	let i = 0;
	const n = pattern.length;
	while (i < n) {
		const c = pattern[i++];
		if (c === '*') {
			let count = 1;
			while (i < n && pattern[i] === '*') {
				count++;
				i++;
			}

			// globstar **
			if (count === 2) {
				// ** followed by / matches only directories
				if (i < n && pattern[i] === '/') {
					i++;
					result += `(?:.*\\/)?`;
				} else {
					result += `.*`;
				}
			} else {
				result += `[^\\/]*`;
			}
		} else if (c === '?') {
			result += '[^\\/]';
		} else if (c === '[') {
			let j = i;
			if (j < n && pattern[j] === '!') j++;
			if (j < n && pattern[j] === ']') j++;
			while (j < n && pattern[j] !== ']') j++;
			if (j >= n) {
				result += '\\[';
			} else {
				// Escape every backslash in the class: a bare '\' inside [...]
				// is interpreted as an escape for the following character, not
				// as a literal backslash.
				let stuff = pattern.substring(i, j).replace(/\\/g, '\\\\');
				i = j + 1;

				// [!...] or [^...]
				if (stuff[0] === '!') {
					stuff = '^' + stuff.substring(1);
				}
				// A literal ']' directly after '[' or '[^' is special in JS regex:
				// '[]' is an empty (never-matching) class and '[^]' matches any
				// character, so escape it to keep it a literal member.
				if (stuff.startsWith(']') || stuff.startsWith('^]')) {
					stuff = stuff.replace(']', '\\]');
				}
				result += '[' + stuff + ']';
			}
		} else {
			// Escape / - \ ^ $ * + ? . ( ) | [ ] { }
			result += c.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
		}
	}
	return `^${result}$`;
}
