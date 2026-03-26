import { WebClient } from "@slack/web-api";
import { db } from "@superset/db/client";
import type { SlackConfig } from "@superset/db/schema";
import {
	integrationConnections,
	members,
	usersSlackUsers,
} from "@superset/db/schema";
import { and, eq, ne } from "drizzle-orm";

import { env } from "@/env";
import { posthog } from "@/lib/analytics";
import { verifySignedState } from "@/lib/oauth-state";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");

	if (error) {
		return Response.redirect(
			`${env.NEXT_PUBLIC_WEB_URL}/integrations/slack?error=oauth_denied`,
		);
	}

	if (!code || !state) {
		return Response.redirect(
			`${env.NEXT_PUBLIC_WEB_URL}/integrations/slack?error=missing_params`,
		);
	}

	const stateData = verifySignedState(state);
	if (!stateData) {
		return Response.redirect(
			`${env.NEXT_PUBLIC_WEB_URL}/integrations/slack?error=invalid_state`,
		);
	}

	const { organizationId, userId } = stateData;

	// Re-verify membership at callback time (state was signed earlier)
	const membership = await db.query.members.findFirst({
		where: and(
			eq(members.organizationId, organizationId),
			eq(members.userId, userId),
		),
	});

	if (!membership) {
		console.error("[slack/callback] Membership verification failed:", {
			organizationId,
			userId,
		});
		return Response.redirect(
			`${env.NEXT_PUBLIC_WEB_URL}/integrations/slack?error=unauthorized`,
		);
	}

	const redirectUri = `${env.NEXT_PUBLIC_API_URL}/api/integrations/slack/callback`;
	const client = new WebClient();

	try {
		const tokenData = await client.oauth.v2.access({
			client_id: env.SLACK_CLIENT_ID,
			client_secret: env.SLACK_CLIENT_SECRET,
			redirect_uri: redirectUri,
			code,
		});

		if (!tokenData.ok || !tokenData.access_token || !tokenData.team) {
			console.error("[slack/callback] Slack API error:", tokenData.error);
			return Response.redirect(
				`${env.NEXT_PUBLIC_WEB_URL}/integrations/slack?error=slack_api_error`,
			);
		}

		const teamId = tokenData.team.id;
		if (!teamId) {
			console.error("[slack/callback] Slack team ID missing in OAuth response");
			return Response.redirect(
				`${env.NEXT_PUBLIC_WEB_URL}/integrations/slack?error=slack_api_error`,
			);
		}

		const config: SlackConfig = {
			provider: "slack",
		};

		await db
			.delete(integrationConnections)
			.where(
				and(
					eq(integrationConnections.provider, "slack"),
					eq(integrationConnections.externalOrgId, teamId),
					ne(integrationConnections.organizationId, organizationId),
				),
			);

		await db
			.insert(integrationConnections)
			.values({
				organizationId,
				connectedByUserId: userId,
				provider: "slack",
				accessToken: tokenData.access_token,
				externalOrgId: teamId,
				externalOrgName: tokenData.team.name,
				config,
			})
			.onConflictDoUpdate({
				target: [
					integrationConnections.organizationId,
					integrationConnections.provider,
				],
				set: {
					accessToken: tokenData.access_token,
					externalOrgId: teamId,
					externalOrgName: tokenData.team.name,
					connectedByUserId: userId,
					config,
					updatedAt: new Date(),
				},
			});

		await db
			.delete(usersSlackUsers)
			.where(
				and(
					eq(usersSlackUsers.teamId, teamId),
					ne(usersSlackUsers.organizationId, organizationId),
				),
			);

		console.log("[slack/callback] Connected workspace:", {
			organizationId,
			teamId,
			teamName: tokenData.team.name,
		});

		posthog.capture({
			distinctId: userId,
			event: "slack_connected",
			properties: { team_id: teamId },
		});

		return Response.redirect(`${env.NEXT_PUBLIC_WEB_URL}/integrations/slack`);
	} catch (error) {
		console.error("[slack/callback] Token exchange failed:", error);
		return Response.redirect(
			`${env.NEXT_PUBLIC_WEB_URL}/integrations/slack?error=token_exchange_failed`,
		);
	}
}
