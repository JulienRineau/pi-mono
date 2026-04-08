/**
 * Shared parameter validation for subagent tools.
 *
 * Produces error messages that tell the model exactly what went wrong,
 * what it sent, and what it probably meant — so it can self-correct.
 */

/** Simple Levenshtein distance for short strings. */
function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
		}
	}
	return dp[m][n];
}

/**
 * Build a clear error message for missing/wrong parameters.
 *
 * Example output:
 *   Error in spec(update-status): missing spec_path.
 *     Required: spec_path, status
 *     Received: spec_name="add-web-browser-tools", status="ready"
 *     Hint: did you mean spec_path instead of spec_name?
 */
export function paramError(
	toolName: string,
	action: string,
	required: string[],
	params: Record<string, unknown>,
	allKnownParams?: string[],
): string {
	const received = Object.entries(params).filter(([k, v]) => v !== undefined && k !== "action");
	const receivedKeys = received.map(([k]) => k);
	const missing = required.filter((r) => params[r] === undefined || params[r] === "");

	const lines: string[] = [];

	// Header
	lines.push(`Error in ${toolName}(${action}): missing ${missing.join(", ")}.`);

	// Required
	lines.push(`  Required: ${required.join(", ")}`);

	// Received
	if (received.length > 0) {
		const pairs = received.map(([k, v]) => {
			const val = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
			return `${k}=${val}`;
		});
		lines.push(`  Received: ${pairs.join(", ")}`);
	} else {
		lines.push(`  Received: (none)`);
	}

	// Hints: for each received-but-not-required param, suggest the closest missing param.
	// This catches both truly unknown params AND known params used for the wrong action
	// (e.g., spec_name is valid for "save" but wrong for "update-status" which needs spec_path).
	const notRequired = receivedKeys.filter((k) => !required.includes(k));
	const hints: string[] = [];

	for (const key of notRequired) {
		let bestMatch = "";
		let bestDist = Infinity;
		for (const req of missing) {
			const dist = levenshtein(key, req);
			if (dist < bestDist) {
				bestDist = dist;
				bestMatch = req;
			}
		}
		// Suggest if edit distance is reasonable (< half the longer string)
		const maxLen = Math.max(key.length, bestMatch.length);
		if (bestMatch && bestDist <= Math.ceil(maxLen / 2)) {
			hints.push(`did you mean ${bestMatch} instead of ${key}?`);
		}
	}

	if (hints.length > 0) {
		lines.push(`  Hint: ${hints.join("; ")}`);
	}

	return lines.join("\n");
}

/**
 * Get the base directory for nightshift artifacts (plans, reviews, reports).
 * When PI_NIGHTSHIFT_RUN_DIR is set (by nightshift tool), uses the run directory.
 * Otherwise falls back to ctx.cwd.
 */
export function getArtifactBaseDir(cwd: string): string {
	return process.env.PI_NIGHTSHIFT_RUN_DIR || cwd;
}
