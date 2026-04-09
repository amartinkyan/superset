import { describe, expect, it } from "bun:test";
import { buildProtectedResourceMetadata } from "@/lib/oauth-metadata";

/**
 * Replicates the resource validation logic from better-auth's oauthProvider
 * `checkResource` function. During the OAuth token exchange, when a client
 * sends a `resource` parameter, better-auth checks every resource URL against
 * the configured `validAudiences` set. If any resource is not in the set,
 * the request is rejected with "requested resource invalid".
 *
 * See: @better-auth/oauth-provider checkResource() implementation
 */
function wouldRejectResource(
	resource: string,
	validAudiences: string[],
): boolean {
	const validSet = new Set(validAudiences);
	return !validSet.has(resource);
}

describe("MCP OAuth resource validation (#3293)", () => {
	const API_URL = "https://api.superset.sh";

	it("rejects MCP resource URL when only base API URL is in validAudiences (bug scenario)", () => {
		// Before the fix: validAudiences only had the base URL
		const oldValidAudiences = [API_URL, `${API_URL}/`];

		// The MCP resource URL is what clients send as the `resource` parameter
		// during the OAuth token exchange (discovered from the protected resource
		// metadata at /.well-known/oauth-protected-resource/api/agent/mcp)
		const mcpResource = `${API_URL}/api/agent/mcp`;

		// This caused "requested resource invalid" for Claude Code and Codex
		expect(wouldRejectResource(mcpResource, oldValidAudiences)).toBe(true);
	});

	it("accepts MCP resource URL when it is included in validAudiences (fix)", () => {
		// After the fix: validAudiences includes the MCP endpoint URL
		const fixedValidAudiences = [
			API_URL,
			`${API_URL}/`,
			`${API_URL}/api/agent/mcp`,
		];

		const mcpResource = `${API_URL}/api/agent/mcp`;
		expect(wouldRejectResource(mcpResource, fixedValidAudiences)).toBe(false);
	});

	it("protected resource metadata returns MCP endpoint as the resource URL", () => {
		// The MCP endpoint advertises its resource URL via the well-known endpoint.
		// This is the URL that MCP clients extract and send as the `resource`
		// parameter during the OAuth token exchange.
		const request = new Request(`${API_URL}/api/agent/mcp`);
		const metadata = buildProtectedResourceMetadata(request, "/api/agent/mcp", {
			authorizationServerUrl: API_URL,
			resourceName: "Superset MCP Server",
		});

		// The resource URL matches the MCP endpoint path
		expect(metadata.resource).toBe(`${API_URL}/api/agent/mcp`);

		// This resource URL MUST be in validAudiences for the token exchange
		// to succeed. The authorization server metadata points clients here.
		expect(metadata.authorization_servers).toEqual([API_URL]);
	});
});
