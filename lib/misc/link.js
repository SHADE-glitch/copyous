import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import { UserAgent, getCachePath, makePrivate, PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from '../common/constants.js';

var OutputStreamSpliceFlags = Gio.OutputStreamSpliceFlags;
Gio._promisify(Soup.Session.prototype, 'send_async');
Gio._promisify(Gio.File.prototype, 'replace_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.OutputStream.prototype, 'splice_async');

export async function tryGetMetadata(ext, url, cancellable) {
	const empty = { title: null, description: null, image: null };
	let session = null;
	try {
		// Check if URL is valid
		const uri = GLib.uri_parse(url, GLib.UriFlags.NONE);

		// Create request
		session = new Soup.Session({ user_agent: UserAgent, idle_timeout: 5, timeout: 30 });
		const message = Soup.Message.new_from_uri('GET', uri);

		// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept
		message.request_headers.append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');

		// Send request
		const response = await session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable);
		if (response == null) return empty;
		// A 4xx/5xx body (error page) is not metadata; parsing it would
		// extract a bogus title and cache a bogus image.
		if (message.status_code < 200 || message.status_code >= 300) return empty;

		// Check if the response is an image
		const [contentType] = message.response_headers.get_content_type();
		if (contentType && Gio.content_type_is_a(contentType, 'image/*')) {
			// Since the response has already been received, write image to cache
			const imagePath = getLinkImagePath(ext, url);
			if (imagePath == null) return empty;

			// Write to cache
			if (!imagePath.query_exists(cancellable)) {
				const out = await imagePath.replace_async(
					null,
					false,
					Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
					GLib.PRIORITY_DEFAULT,
					null,
				);
				await out.splice_async(
					response,
					Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
					GLib.PRIORITY_DEFAULT,
					null,
				);
				// The branch is guarded by query_exists, so PRIVATE normally applies to a
				// brand-new file; this covers one that appeared between the two calls.
				makePrivate(imagePath, PRIVATE_FILE_MODE);
			}
			return { title: null, description: null, image: url };
		}

		// Download page
		if (!contentType || !Gio.content_type_is_a(contentType, 'text/html')) return empty;
		const out = Gio.MemoryOutputStream.new_resizable();
		await out.splice_async(
			response,
			OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
			GLib.PRIORITY_DEFAULT,
			cancellable,
		);
		const bytes = out.steal_as_bytes();
		const data = bytes.get_data();
		if (data == null) return empty;

		// Extract metadata
		const text = new TextDecoder().decode(data);

		// This regex is enough for most cases without having to resort to using a HTML parser
		const metaRegex = /<meta\s+(?:property|name)="([^"]*?)"\s+content="([^"]*?)"/gm;
		const reverseMetaRegex = /<meta\s+content="([^"]*?)"\s+(?:property|name)="([^"]*?)"/gm;
		const meta = {};
		for (const match of text.matchAll(metaRegex)) meta[match[1]] = match[2];
		for (const match of text.matchAll(reverseMetaRegex)) meta[match[2]] = match[1];

		// Title
		let title = meta['title'] ?? meta['og:title'] ?? meta['twitter:title'] ?? null;
		if (title == null) {
			const titleRegex = /<title>\s*(.*?)\s*<\/title>/s;
			const titleMatch = text.match(titleRegex);
			title = titleMatch ? titleMatch[1] : null;
		}

		// Description
		let description = meta['description'] ?? meta['og:description'] ?? meta['twitter:description'] ?? null;

		// Image
		let image =
			meta['image'] ??
			meta['og:image'] ??
			meta['og:image:url'] ??
			meta['og:image:secure_url'] ??
			meta['twitter:image'] ??
			null;
		if (image) {
			try {
				// Resolve relative image paths
				image = uri.parse_relative(image, GLib.UriFlags.NONE).to_string();
			} catch {
				image = null;
			}
		}

		// Escape
		title = title ? decodeHtml(title).trim() : null;
		description = description ? decodeHtml(description).trim() : null;
		return { title: title, description: description, image: image };
	} catch (err) {
		// warn: an unreachable host is the ordinary case for a copied link, and the caller
		// falls back to empty metadata. `logger.error` renders a shell CRITICAL, which is the
		// line the health gate counts for the entire session.
		ext.logger.warn('Failed to get metadata', err);
	} finally {
		session?.abort();
	}
	return empty;
}

function decodeHtml(html) {
	return html
		.replace(/&amp;/g, '&') // Pre-check for `&amp;` to fix wrong encoding on many websites
		.replace(/&([^;]+);/g, (_, s) => {
			switch (s) {
				case 'lt':
					return '<';
				case 'gt':
					return '>';
				case 'amp':
					return '&';
				case 'quot':
					return '"';
				case 'apos':
					return "'";
				case 'mdash':
					return '—';
				case 'ndash':
					return '–';
				default:
					return '';
			}
		})
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

export function getLinkImagePath(ext, url) {
	const checksum = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, url.length);
	if (checksum == null) return null;
	const cacheDir = getCachePath(ext);
	if (!cacheDir.query_exists(null)) cacheDir.make_directory_with_parents(null);
	// Unconditional, so a directory that predates this fix gets corrected rather than
	// staying 0775 forever. Costs one chmod next to the query_exists already done here.
	makePrivate(cacheDir, PRIVATE_DIR_MODE);
	return cacheDir.get_child(checksum);
}

export async function tryGetLinkImage(ext, url, cancellable) {
	let session = null;
	try {
		// Check if URL is valid
		const uri = GLib.uri_parse(url, GLib.UriFlags.NONE);

		// Check if image is already cached
		const imagePath = getLinkImagePath(ext, url);
		if (imagePath == null) return null;
		if (imagePath.query_exists(cancellable)) return imagePath;

		// Otherwise download image
		session = new Soup.Session({ user_agent: UserAgent, idle_timeout: 5, timeout: 30 });
		const message = Soup.Message.new_from_uri('GET', uri);

		// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept
		message.request_headers.append(
			'Accept',
			'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
		);

		// Send request
		const response = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
		if (response == null) return null;
		// Reject 4xx/5xx bodies: some servers answer errors with an image
		// content-type, which would poison the cache.
		if (message.status_code < 200 || message.status_code >= 300) return null;
		const data = response.get_data();
		if (data == null) return null;

		// Check if the response is an image
		const [contentType] = message.response_headers.get_content_type();
		if (contentType == null || !contentType.startsWith('image/')) return null;

		// Write to cache. PRIVATE covers a newly created file; the explicit chmod after is
		// what corrects a thumbnail already cached under the old, world-readable mode.
		await imagePath.replace_contents_async(
			data,
			null,
			false,
			Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
			cancellable,
		);
		makePrivate(imagePath, PRIVATE_FILE_MODE);
		return imagePath;
	} catch {
		// warn, same reason as the metadata branch: the row simply goes without its image.
		ext.logger.warn('Failed to get link image');
	} finally {
		session?.abort();
	}
	return null;
}
