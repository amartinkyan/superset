/**
 * Returns the set of valid audience values for OAuth resource validation.
 *
 * The `@better-auth/oauth-provider` `checkResource` function performs an
 * **exact** Set membership check against these values when a client sends a
 * `resource` parameter during the token exchange.  Every resource URL that
 * clients are expected to request must therefore appear here verbatim.
 */
export function getValidAudiences(apiUrl: string): string[] {
	const base = apiUrl.replace(/\/+$/, "");
	return [
		base,
		`${base}/`,
		// MCP server endpoint – MCP clients send this as the `resource`
		// parameter during the OAuth token exchange (RFC 8707).
		`${base}/api/agent/mcp`,
	];
}
