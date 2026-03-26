import { describe, expect, it } from "bun:test";
import type { SelectIntegrationConnection } from "@superset/db/schema";
import {
	resolveSlackConnectionForTeam,
	selectSlackConnectionForTeam,
} from "./resolve-team-connection";

function createConnection(
	organizationId: string,
	updatedAt: string,
): SelectIntegrationConnection {
	return {
		id: `connection-${organizationId}`,
		organizationId,
		connectedByUserId: "user-1",
		provider: "slack",
		accessToken: `token-${organizationId}`,
		refreshToken: null,
		tokenExpiresAt: null,
		externalOrgId: "team-1",
		externalOrgName: "Workspace",
		config: { provider: "slack" },
		createdAt: new Date(updatedAt),
		updatedAt: new Date(updatedAt),
	};
}

describe("selectSlackConnectionForTeam", () => {
	it("returns the newest Slack connection for a team", () => {
		const connection = selectSlackConnectionForTeam([
			createConnection("org-free", "2026-03-25T12:00:00.000Z"),
			createConnection("org-pro", "2026-03-26T12:00:00.000Z"),
		]);

		expect(connection?.organizationId).toBe("org-pro");
	});

	it("uses createdAt as a tiebreaker when updatedAt matches", () => {
		const connection = selectSlackConnectionForTeam([
			{
				...createConnection("org-older", "2026-03-26T12:00:00.000Z"),
				createdAt: new Date("2026-03-25T12:00:00.000Z"),
			},
			{
				...createConnection("org-newer", "2026-03-26T12:00:00.000Z"),
				createdAt: new Date("2026-03-26T12:00:00.000Z"),
			},
		]);

		expect(connection?.organizationId).toBe("org-newer");
	});

	it("returns null when the Slack team is not connected", () => {
		const connection = selectSlackConnectionForTeam([]);

		expect(connection).toBe(null);
	});
});

describe("resolveSlackConnectionForTeam", () => {
	it("prefers the linked organization when duplicates exist", () => {
		const { connection, resolution } = resolveSlackConnectionForTeam({
			connections: [
				createConnection("org-free", "2026-03-25T12:00:00.000Z"),
				createConnection("org-pro", "2026-03-26T12:00:00.000Z"),
			],
			linkedOrganizationId: "org-free",
		});

		expect(connection?.organizationId).toBe("org-free");
		expect(resolution).toBe("linked_organization");
	});

	it("falls back to the latest connection when the linked org is missing", () => {
		const { connection, resolution } = resolveSlackConnectionForTeam({
			connections: [
				createConnection("org-free", "2026-03-25T12:00:00.000Z"),
				createConnection("org-pro", "2026-03-26T12:00:00.000Z"),
			],
			linkedOrganizationId: "org-missing",
		});

		expect(connection?.organizationId).toBe("org-pro");
		expect(resolution).toBe("latest_connection");
	});
});
