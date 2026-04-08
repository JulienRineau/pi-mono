/**
 * Jina Reader API integration.
 *
 * Uses Jina Reader to fetch web pages and convert them to markdown.
 * Jina Reader handles content extraction and provides clean markdown.
 */

export interface FetchResult {
	title: string;
	content: string;
}

/** Metadata lines to strip from Jina Reader response */
const METADATA_PREFIXES = [
	"title:",
	"url:",
	"description:",
	"image:",
	"publishedtime:",
	"author:",
	"domain:",
	"locale:",
	"canonical:",
];

const MAX_TITLE_LENGTH = 100;
const CONTENT_TRUNCATE_LIMIT = 4096;

/**
 * Fetch a URL using Jina Reader and return the content as markdown.
 *
 * @param url The URL to fetch
 * @param signal Optional abort signal
 * @returns Promise resolving to the fetched content
 * @throws Error if the fetch fails
 */
export async function fetchWithJinaReader(url: string, signal?: AbortSignal): Promise<FetchResult> {
	// Jina Reader expects the URL in the path, we need to encode it but not double-encode
	const jinaUrl = `https://r.jina.ai/${url}`;

	const response = await fetch(jinaUrl, {
		signal,
		headers: {
			Accept: "text/markdown, text/plain",
			"X-Return-Format": "markdown",
			"User-Agent": "Mozilla/5.0 (compatible; PiBot/1.0)",
		},
	});

	if (!response.ok) {
		if (response.status === 429) {
			throw new Error("Rate limit exceeded");
		}
		if (response.status === 404) {
			throw new Error("Page not found");
		}
		throw new Error(`Fetch failed: HTTP ${response.status}`);
	}

	const content = await response.text();

	return {
		title: "",
		content,
	};
}

/**
 * Strip metadata prefix lines from Jina Reader content.
 *
 * Jina Reader sometimes adds metadata at the beginning of the response.
 * This function removes those lines.
 *
 * @param content The raw content from Jina Reader
 * @returns The content with metadata stripped
 */
export function stripMetadataPrefix(content: string): string {
	const lines = content.split("\n");
	const result: string[] = [];
	let metadataEnded = false;

	for (const line of lines) {
		const trimmed = line.trim().toLowerCase();

		// Check if this is a metadata line
		const isMetadata = METADATA_PREFIXES.some((prefix) => trimmed.startsWith(prefix));

		if (!isMetadata) {
			metadataEnded = true;
		}

		// Include non-metadata lines and skip metadata lines
		if (metadataEnded && !isMetadata) {
			result.push(line);
		}
	}

	return result.join("\n").trim();
}

/**
 * Extract the title from markdown content.
 *
 * Looks for the first # heading and uses it as the title.
 *
 * @param content The markdown content
 * @param fallbackTitle Optional fallback title
 * @returns The extracted title or fallback
 */
export function extractTitle(content: string, fallbackTitle?: string): string {
	// Look for first markdown heading
	const headingMatch = content.match(/^#\s+(.+)$/m);
	if (headingMatch) {
		let title = headingMatch[1].trim();
		// Remove markdown formatting from title
		title = title.replace(/\*\*(.+?)\*\*/g, "$1");
		title = title.replace(/\*(.+?)\*/g, "$1");
		title = title.replace(/\[(.+?)\]\(.+?\)/g, "$1");
		title = title.replace(/`(.+?)`/g, "$1");
		return title.slice(0, MAX_TITLE_LENGTH);
	}

	// Fallback to provided title or default
	return fallbackTitle ?? "Untitled";
}

/**
 * Derive a title from a URL path.
 *
 * @param url The URL to derive title from
 * @returns A human-readable title derived from the URL, or undefined if no meaningful path
 */
export function deriveTitleFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		const path = parsed.pathname;

		// Get the last meaningful segment
		const segments = path.split("/").filter((s) => s.length > 0);
		if (segments.length === 0) {
			return undefined;
		}

		const lastSegment = segments[segments.length - 1];

		// Remove file extensions
		const withoutExt = lastSegment.replace(/\.[^.]+$/, "");

		// If the remaining segment is just a filename-like string (e.g., "index.html"), return undefined
		if (!withoutExt || /^(index|default|home|page)$/i.test(withoutExt)) {
			return undefined;
		}

		// Convert dash/underscore to spaces, preserve original casing
		const title = withoutExt.replace(/[-_]/g, " ");

		return title;
	} catch {
		return undefined;
	}
}

/**
 * Truncate content to a maximum length.
 *
 * @param content The content to truncate
 * @param maxLength Maximum length
 * @returns Object with truncated content and whether it was truncated
 */
export function truncateContent(
	content: string,
	maxLength: number = CONTENT_TRUNCATE_LIMIT,
): { content: string; truncated: boolean } {
	if (content.length <= maxLength) {
		return { content, truncated: false };
	}

	return {
		content: `${content.slice(0, maxLength)}\n\n[truncated]`,
		truncated: true,
	};
}
