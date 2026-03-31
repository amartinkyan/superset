import { describe, expect, test } from "bun:test";
import { getValidAudiences } from "./valid-audiences";

/**
 * Simulates the exact audience validation performed by
 * `@better-auth/oauth-provider`'s internal `checkResource` function.
 *
 * See: node_modules/@better-auth/oauth-provider/dist/index.mjs – checkResource()
 *
 * The library builds a Set from `validAudiences` (plus the auth server
 * baseURL) and rejects any requested `resource` value that is not a member.
 */
function isResourceAccepted(
	validAudiences: string[],
	resource: string,
): boolean {
	const allowed = new Set(validAudiences);
	return allowed.has(resource);
}

describe("getValidAudiences", () => {
	const API_URL = "https://api.superset.sh";

	test("accepts the base API URL", () => {
		const audiences = getValidAudiences(API_URL);
		expect(isResourceAccepted(audiences, "https://api.superset.sh")).toBe(true);
	});

	test("accepts the base API URL with trailing slash", () => {
		const audiences = getValidAudiences(API_URL);
		expect(isResourceAccepted(audiences, "https://api.superset.sh/")).toBe(
			true,
		);
	});

	test("accepts the MCP server endpoint as a valid resource", () => {
		// This is the resource URL that MCP clients (e.g. Claude Code) send
		// during the OAuth token exchange.  Before the fix, this was rejected
		// with "requested resource invalid" because it was not in validAudiences.
		const audiences = getValidAudiences(API_URL);
		expect(
			isResourceAccepted(audiences, "https://api.superset.sh/api/agent/mcp"),
		).toBe(true);
	});

	test("strips trailing slashes from the input URL", () => {
		const audiences = getValidAudiences("https://api.superset.sh/");
		expect(
			isResourceAccepted(audiences, "https://api.superset.sh/api/agent/mcp"),
		).toBe(true);
	});

	test("rejects unknown resource paths", () => {
		const audiences = getValidAudiences(API_URL);
		expect(
			isResourceAccepted(audiences, "https://api.superset.sh/api/unknown"),
		).toBe(false);
	});
});
