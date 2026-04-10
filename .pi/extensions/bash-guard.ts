/**
 * Bash Guard Extension
 *
 * Blocks destructive bash commands (git checkout --force, git clean, git reset --hard, etc.)
 * for all pi sessions. Enforced at the tool_call event level — the LLM cannot bypass it.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DESTRUCTIVE_PATTERNS: { pattern: RegExp; description: string }[] = [
	{ pattern: /git\s+checkout\s.*--force/, description: "git checkout --force" },
	{ pattern: /git\s+clean\s+-[fdxX]/, description: "git clean with force flag" },
	{ pattern: /git\s+reset\s+--hard/, description: "git reset --hard" },
	{ pattern: /git\s+push\s.*--force/, description: "git push --force" },
	{ pattern: /git\s+push\s.*\s-f\b/, description: "git push -f" },
	{ pattern: /git\s+branch\s+-D\b/, description: "git branch -D (force delete)" },
	{ pattern: /git\s+stash\s+(drop|clear)/, description: "git stash drop/clear" },
	{ pattern: /\brm\s+-r[f ]*\s+[/~.](\s|$)/, description: "rm -rf on root/home/cwd" },
];

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const cmd = (event.input as any).command as string;
		if (!cmd) return;

		for (const { pattern, description } of DESTRUCTIVE_PATTERNS) {
			if (pattern.test(cmd)) {
				return {
					block: true,
					reason: `Blocked: "${description}" is a destructive command. Use a non-destructive alternative or run it manually in the terminal.`,
				};
			}
		}
	});
}
