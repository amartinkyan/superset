import { db } from "@superset/db/client";
import type { SelectIntegrationConnection } from "@superset/db/schema";
import { integrationConnections, usersSlackUsers } from "@superset/db/schema";
import { and, desc, eq } from "drizzle-orm";

export function selectSlackConnectionForTeam(
	connections: SelectIntegrationConnection[],
) {
	return (
		[...connections].sort((left, right) => {
			const updatedDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
			if (updatedDiff !== 0) {
				return updatedDiff;
			}

			return right.createdAt.getTime() - left.createdAt.getTime();
		})[0] ?? null
	);
}

export function resolveSlackConnectionForTeam({
	connections,
	linkedOrganizationId,
}: {
	connections: SelectIntegrationConnection[];
	linkedOrganizationId?: string | null;
}) {
	if (linkedOrganizationId) {
		const linkedConnection =
			connections.find(
				(connection) => connection.organizationId === linkedOrganizationId,
			) ?? null;

		if (linkedConnection) {
			return {
				connection: linkedConnection,
				resolution: "linked_organization" as const,
			};
		}
	}

	return {
		connection: selectSlackConnectionForTeam(connections),
		resolution: "latest_connection" as const,
	};
}

export async function getSlackConnectionForTeam({
	teamId,
	slackUserId,
}: {
	teamId: string;
	slackUserId?: string;
}) {
	const connections = await db.query.integrationConnections.findMany({
		where: and(
			eq(integrationConnections.provider, "slack"),
			eq(integrationConnections.externalOrgId, teamId),
		),
		orderBy: [
			desc(integrationConnections.updatedAt),
			desc(integrationConnections.createdAt),
		],
	});

	let linkedOrganizationId: string | null = null;

	if (connections.length > 1 && slackUserId) {
		const slackUserLink = await db.query.usersSlackUsers.findFirst({
			where: and(
				eq(usersSlackUsers.slackUserId, slackUserId),
				eq(usersSlackUsers.teamId, teamId),
			),
			columns: { organizationId: true },
		});

		linkedOrganizationId = slackUserLink?.organizationId ?? null;
	}

	const { connection, resolution } = resolveSlackConnectionForTeam({
		connections,
		linkedOrganizationId,
	});

	if (connection && connections.length > 1) {
		console.warn(
			"[slack/resolve-team-connection] Multiple Slack connections found for team; selecting one deterministically.",
			{
				teamId,
				selectedOrganizationId: connection.organizationId,
				organizationIds: connections.map((item) => item.organizationId),
				resolution,
				slackUserId,
			},
		);
	}

	return connection;
}
