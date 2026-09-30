import Gio from 'gi://Gio';

import { ItemType } from '../../common/constants.js';
import { formatFile } from './fileItem.js';
import { commonDirectory } from './filesItem.js';

// The texts an entry is matched against by a search query.
//
// This used to live in each item class' search() override, which read them off the
// widget it had just built (`this._file.text`, `this._files`, `this._formattedFiles`).
// That tied filtering to materialization: an entry with no actor could not be filtered.
// Every one of those values is a pure function of the entry, so deriving them here lets
// the container filter entries it has not built an actor for.
//
// Must stay in lockstep with what each item type displays -- the File and Files cases
// deliberately reproduce the constructors' own formatting rather than re-deriving it.
export function searchTextsFor(entry) {
	switch (entry.type) {
		case ItemType.Image:
			// ImageItem matched on the entry alone (title and pinned/tag/type are
			// appended by matchesEntry itself); it contributed no content text.
			return [];
		case ItemType.File:
			return fileTexts(entry);
		case ItemType.Files:
			return filesTexts(entry);
		case ItemType.Link:
			return linkTexts(entry);
		default:
			// Text, Code, Character and Color all used the base ClipboardItem.search().
			return [entry.content];
	}
}

// Gio.File.new_for_uri() throws on a malformed URI. The item constructors would have
// thrown too, so such an entry never reached the list -- except that entry.content is
// mutable (inline edit), and a throw here would abort the whole search pass instead of
// one item. Fall back to the raw content.
function fileTexts(entry) {
	const path = entry.content.substring('file://'.length);
	try {
		return [path, formatFile(Gio.File.new_for_uri(entry.content))];
	} catch {
		return [path];
	}
}

function filesTexts(entry) {
	try {
		const files = entry.content
			.split('\n')
			.map((f) => Gio.File.new_for_uri(f))
			.filter((f) => f.get_path() !== null);
		const common = commonDirectory(files);
		if (!common) return [];
		const texts = files.map((f) => f.get_path()?.toLowerCase() ?? '');
		// FilesItem only added the formatted names when the common directory rendered
		// with a leading '~'.
		if (formatFile(common).startsWith('~')) {
			for (const f of files) texts.push(formatFile(f).toLowerCase());
		}
		return texts;
	} catch {
		return [];
	}
}

function linkTexts(entry) {
	const metadata = { title: null, description: null, image: null, ...entry.metadata };
	const texts = [entry.content];
	if (metadata.title) texts.push(metadata.title);
	if (metadata.description) texts.push(metadata.description);
	return texts;
}
