/**
 * SSRF (Server-Side Request Forgery) protection utilities.
 *
 * Provides URL validation to block requests to internal/private addresses,
 * preventing attackers from using the agent as a proxy to access internal resources.
 */

/** Error type returned when a URL is blocked by SSRF protection */
export interface BlockedUrlError {
	type: "ssrf";
	message: string;
}

/**
 * Check if an IP address is in a specified CIDR range.
 *
 * @param ip The IP address to check (IPv4 format)
 * @param cidr The CIDR notation (e.g., "192.168.0.0/16")
 */
function isIpInCidr(ip: string, cidr: string): boolean {
	const [range, bits] = cidr.split("/");
	const mask = parseInt(bits, 10);

	const ipNum = ipToNumber(ip);
	const rangeNum = ipToNumber(range);

	if (ipNum === null || rangeNum === null) return false;

	const maskBits = mask === 0 ? 0 : 0xffffffff << (32 - mask);
	return (ipNum & maskBits) === (rangeNum & maskBits);
}

/**
 * Convert an IPv4 address string to a number.
 */
function ipToNumber(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;

	let result = 0;
	for (const part of parts) {
		const num = parseInt(part, 10);
		if (Number.isNaN(num) || num < 0 || num > 255) return null;
		result = (result << 8) | num;
	}
	return result >>> 0; // Convert to unsigned 32-bit
}

/**
 * Check if an IPv6 address falls within a specific CIDR range.
 *
 * @param ipParts Array of 8 hexadecimal parts (16-bit each)
 * @param cidrPrefix The CIDR prefix (e.g., "fe80" for fe80::/10)
 * @param cidrBits Number of bits in the prefix
 */
function isIpv6InPrefix(ipParts: string[], cidrPrefix: string, cidrBits: number): boolean {
	// Parse the prefix into parts
	const prefixParts: number[] = [];
	for (let i = 0; i < 8; i++) {
		const start = i * (cidrBits > 16 ? 4 : cidrBits - i * 16 > 0 ? 4 : 0);
		const end = Math.min(start + 4, cidrPrefix.length);
		if (start < cidrPrefix.length) {
			const hex = cidrPrefix.slice(start, end);
			prefixParts.push(parseInt(hex.padEnd(4, "0"), 16));
		} else {
			prefixParts.push(0);
		}
	}

	// Check each relevant part
	const partsToCheck = Math.ceil(cidrBits / 16);
	for (let i = 0; i < partsToCheck && i < 8; i++) {
		if (i < partsToCheck - 1) {
			// Full 16-bit comparison
			if (ipParts[i] !== prefixParts[i].toString(16).padStart(4, "0")) return false;
		} else {
			// Partial comparison for the last part
			const bitsInLastPart = cidrBits - i * 16;
			const mask = (0xffff << (16 - bitsInLastPart)) >>> 0;
			const ipPartNum = parseInt(ipParts[i], 16);
			const prefixPartNum = prefixParts[i];
			if ((ipPartNum & mask) !== (prefixPartNum & mask)) return false;
		}
	}
	return true;
}

/**
 * Parse an IPv6 address string into its component parts.
 */
function parseIpv6(ip: string): string[] | null {
	// Handle IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
	const ipv4Mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
	if (ipv4Mapped?.[1]) {
		const ipv4Num = ipToNumber(ipv4Mapped[1]);
		if (ipv4Num === null) return null;
		return ["0000", "0000", "0000", "0000", "0000", "ffff", ipv4Num.toString(16).padStart(4, "0")];
	}

	// Remove zone ID if present
	const zoneIndex = ip.indexOf("%");
	if (zoneIndex !== -1) {
		ip = ip.slice(0, zoneIndex);
	}

	// Handle :: expansion
	let normalized = ip;
	if (ip.includes("::")) {
		const parts = ip.split("::");
		const leftParts = parts[0] ? parts[0].split(":") : [];
		const rightParts = parts[1] ? parts[1].split(":") : [];
		const missing = 8 - leftParts.length - rightParts.length;

		const middle = Array(missing).fill("0");
		normalized = [...leftParts, ...middle, ...rightParts].join(":");
	}

	const parts = normalized.split(":");
	if (parts.length !== 8) return null;

	const result: string[] = [];
	for (const p of parts) {
		// Handle leading zeros
		if (p === "") {
			result.push("0");
			continue;
		}
		const num = parseInt(p, 16);
		if (Number.isNaN(num) || num < 0 || num > 0xffff) return null;
		result.push(num.toString(16).padStart(4, "0").toLowerCase());
	}
	return result;
}

/**
 * Check if a hostname/IP should be blocked by SSRF protection.
 *
 * @param hostname The hostname or IP address to check
 */
function isBlockedHostname(hostname: string): boolean {
	const lower = hostname.toLowerCase();

	// Block localhost (case-insensitive)
	if (lower === "localhost" || lower === "localhost.") {
		return true;
	}

	// Block single-label hostnames that could resolve to internal IPs
	// (e.g., "metadata" as used by GCP, "instance-data" by AWS)
	const internalHostnames = ["metadata", "instance-data", "metadata.google", "metadata.google.internal"];
	if (internalHostnames.includes(lower)) {
		return true;
	}

	return false;
}

/**
 * Check if an IP address should be blocked by SSRF protection.
 *
 * @param ip The IP address to check
 */
function isBlockedIp(ip: string): boolean {
	// Check for IPv4
	if (ip.includes(".") && !ip.includes(":")) {
		// Loopback: 127.0.0.0/8 (127.x.x.x)
		if (isIpInCidr(ip, "127.0.0.0/8")) {
			return true;
		}

		// Private networks:
		// 10.0.0.0/8 (10.x.x.x)
		if (isIpInCidr(ip, "10.0.0.0/8")) {
			return true;
		}

		// 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
		if (isIpInCidr(ip, "172.16.0.0/12")) {
			return true;
		}

		// 192.168.0.0/16 (192.168.x.x)
		if (isIpInCidr(ip, "192.168.0.0/16")) {
			return true;
		}

		// Link-local: 169.254.0.0/16 (169.254.x.x) - includes AWS metadata
		if (isIpInCidr(ip, "169.254.0.0/16")) {
			return true;
		}

		// Broadcast: 0.0.0.0/8 (0.x.x.x)
		if (isIpInCidr(ip, "0.0.0.0/8")) {
			return true;
		}

		return false;
	}

	// Check for IPv6
	const ipv6Parts = parseIpv6(ip);
	if (ipv6Parts === null) {
		// If we can't parse it, be conservative and block
		return true;
	}

	// Loopback: ::1
	if (ipv6Parts.join(":") === "0000:0000:0000:0000:0000:0000:0000:0001") {
		return true;
	}

	// IPv4-mapped IPv6: ::ffff:x.x.x.x
	if (ipv6Parts.slice(0, 5).join(":") === "0000:0000:0000:0000:0000" && ipv6Parts[5] === "ffff") {
		const mappedIp = `${parseInt(ipv6Parts[6].slice(0, 2), 16)}.${parseInt(ipv6Parts[6].slice(2), 16)}.${parseInt(ipv6Parts[7].slice(0, 2), 16)}.${parseInt(ipv6Parts[7].slice(2), 16)}`;
		return isBlockedIp(mappedIp);
	}

	// IPv6 link-local: fe80::/10
	if (isIpv6InPrefix(ipv6Parts, "fe80", 10)) {
		return true;
	}

	// IPv6 unique local: fc00::/7 (includes fc00::/8 and fd00::/8)
	if (isIpv6InPrefix(ipv6Parts, "fc", 7)) {
		return true;
	}

	// Unspecified: ::
	if (ipv6Parts.every((p) => p === "0000")) {
		return true;
	}

	return false;
}

/**
 * Check if a URL should be blocked by SSRF protection.
 *
 * @param url The URL to check
 * @returns true if the URL is blocked, false if it's safe to fetch
 */
export function isUrlBlocked(url: URL): boolean {
	const hostname = url.hostname;

	// Check hostname first
	if (isBlockedHostname(hostname)) {
		return true;
	}

	// Check if hostname is an IP address
	const ipPattern = /^[\d.:[\]]+$/;
	if (ipPattern.test(hostname)) {
		// Handle bracketed IPv6
		const ip = hostname.replace(/^\[|\]$/g, "");
		if (isBlockedIp(ip)) {
			return true;
		}
	}

	// Known safe protocols only
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return true;
	}

	return false;
}

/**
 * Validate that a URL is not blocked by SSRF protection.
 *
 * @param url The URL to validate
 * @throws BlockedUrlError if the URL is blocked
 */
export function validateUrlNotBlocked(url: URL): void {
	if (isUrlBlocked(url)) {
		throw {
			type: "ssrf",
			message: "URL not allowed",
		} as BlockedUrlError;
	}
}
