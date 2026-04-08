/**
 * DuckDuckGo search provider.
 *
 * Fetches search results from DuckDuckGo's HTML interface and parses them
 * into structured search results.
 */

export interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
}

/** Regular expression to decode HTML entities */
const HTML_ENTITY_REGEX = /&#(\d+);|&#x([0-9a-fA-F]+);|&#([a-zA-Z]+);|&([a-zA-Z]+);/g;

/**
 * Decode HTML entities in a string.
 */
function decodeHtmlEntities(str: string): string {
	return str.replace(HTML_ENTITY_REGEX, (_match, dec, hex, namedRef, named) => {
		if (dec !== undefined) {
			return String.fromCharCode(parseInt(dec, 10));
		}
		if (hex !== undefined) {
			return String.fromCharCode(parseInt(hex, 16));
		}
		if (namedRef !== undefined) {
			return decodeNamedEntity(namedRef);
		}
		if (named !== undefined) {
			return decodeNamedEntity(named);
		}
		return _match;
	});
}

/** Map of common HTML named entities */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "\u0026",
	lt: "\u003c",
	gt: "\u003e",
	quot: "\u0022",
	apos: "\u0027",
	nbsp: "\u00a0",
	ndash: "\u2013",
	mdash: "\u2014",
	hellip: "\u2026",
	copy: "\u00a9",
	reg: "\u00ae",
	trade: "\u2122",
	ldquo: "\u201c",
	rdquo: "\u201d",
	lsquo: "\u2018",
	rsquo: "\u2019",
	bull: "\u2022",
	prime: "\u2032",
	Prime: "\u2033",
	deg: "\u00b0",
	plusmn: "\u00b1",
	frac14: "\u00bc",
	frac12: "\u00bd",
	frac34: "\u00be",
	times: "\u00d7",
	divide: "\u00f7",
	forall: "\u2200",
	exist: "\u2203",
	empty: "\u2205",
	infin: "\u221e",
	sum: "\u2211",
	prod: "\u220f",
	part: "\u2202",
	nabla: "\u2207",
	ne: "\u2260",
	le: "\u2264",
	ge: "\u2265",
	mu: "\u03bc",
	alpha: "\u03b1",
	beta: "\u03b2",
	gamma: "\u03b3",
	delta: "\u03b4",
	epsilon: "\u03b5",
	theta: "\u03b8",
	lambda: "\u03bb",
	pi: "\u03c0",
	sigma: "\u03c3",
	phi: "\u03c6",
	omega: "\u03c9",
};

/**
 * Decode a named HTML entity.
 */
function decodeNamedEntity(name: string): string {
	return NAMED_ENTITIES[name] ?? `&${name};`;
}

/**
 * Extract text content from an HTML string, stripping tags.
 */
function extractText(html: string): string {
	// Remove HTML tags
	let text = html.replace(/<[^>]*>/g, "");
	// Decode entities
	text = decodeHtmlEntities(text);
	// Normalize whitespace
	text = text.replace(/\s+/g, " ").trim();
	return text;
}

/**
 * Search DuckDuckGo for the given query.
 *
 * @param query The search query
 * @param maxResults Maximum number of results to return (default: 5)
 * @param signal Optional abort signal
 * @returns Promise resolving to array of search results
 * @throws Error if the network request fails
 */
export async function searchDuckDuckGo(
	query: string,
	maxResults: number = 5,
	signal?: AbortSignal,
): Promise<WebSearchResult[]> {
	const encodedQuery = encodeURIComponent(query);
	const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

	const response = await fetch(url, {
		signal,
		headers: {
			Accept: "text/html",
			"User-Agent": "Mozilla/5.0 (compatible; PiBot/1.0)",
		},
	});

	if (!response.ok) {
		if (response.status === 429) {
			throw new Error("Rate limit exceeded");
		}
		throw new Error(`Search failed: HTTP ${response.status}`);
	}

	const html = await response.text();

	// Parse results from DuckDuckGo HTML
	const results = parseDuckDuckGoHtml(html);

	// Limit to requested number
	return results.slice(0, maxResults);
}

/**
 * Parse DuckDuckGo HTML search results into structured data.
 *
 * @param html The raw HTML from DuckDuckGo
 * @returns Array of search results
 */
export function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
	const results: WebSearchResult[] = [];

	// Pattern to match result__a links
	const resultLinkPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

	// Pattern to match result__snippet links
	const snippetPattern = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

	// Find all result matches
	resultLinkPattern.lastIndex = 0;
	let match: RegExpExecArray | null = resultLinkPattern.exec(html);
	while (match !== null) {
		const url = decodeHtmlEntities(match[1]);
		const titleHtml = match[2];
		const title = extractText(titleHtml);

		if (!title || !url) {
			match = resultLinkPattern.exec(html);
			continue;
		}

		// Find the snippet that follows this result
		// Calculate where to search for snippet (after this result)
		const afterResult = html.slice(match.index + match[0].length);
		const snippetMatch = snippetPattern.exec(afterResult);
		const snippet = snippetMatch ? extractText(snippetMatch[1]) : "";

		results.push({ title, url, snippet });

		// Reset snippet pattern index for next search
		snippetPattern.lastIndex = 0;
		match = resultLinkPattern.exec(html);
	}

	return results;
}
