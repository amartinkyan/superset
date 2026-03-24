import { LinearClient } from "@linear/sdk";
import { db } from "@superset/db/client";
import { integrationConnections, members } from "@superset/db/schema";
import { Client } from "@upstash/qstash";
import { and, eq } from "drizzle-orm";

import { env } from "@/env";
import { verifySignedState } from "@/lib/oauth-state";

const qstash = new Client({ token: env.QSTASH_TOKEN });
const LINEAR_PUBLIC_API_URL =
	env.LINEAR_PUBLIC_API_URL ?? env.NEXT_PUBLIC_API_URL;
const LINEAR_WEBHOOK_URL = `${LINEAR_PUBLIC_API_URL}/api/integrations/linear/webhook`;
const ISSUE_RESOURCE_TYPES = ["Issue"];

const EXISTING_WEBHOOKS_QUERY = `
	query ExistingWebhooks {
		webhooks {
			nodes {
				id
				url
				enabled
				allPublicTeams
				secret
				resourceTypes
				team {
					id
				}
			}
		}
	}
`;

const TEAMS_QUERY = `
	query TeamsForWebhooks {
		teams {
			nodes {
				id
				name
				private
			}
		}
	}
`;

const CREATE_WEBHOOK_MUTATION = `
	mutation CreateWebhook($input: WebhookCreateInput!) {
		webhookCreate(input: $input) {
			success
			webhook {
				id
				enabled
			}
		}
	}
`;

const UPDATE_WEBHOOK_MUTATION = `
	mutation UpdateWebhook($id: String!, $input: WebhookUpdateInput!) {
		webhookUpdate(id: $id, input: $input) {
			success
			webhook {
				id
				enabled
			}
		}
	}
`;

interface LinearTokenResponse {
	access_token: string;
	expires_in?: number;
	refresh_token?: string;
}

interface LinearWebhookRecord {
	id: string;
	url: string;
	enabled: boolean;
	allPublicTeams: boolean | null;
	secret: string | null;
	resourceTypes: string[];
	team: { id: string } | null;
}

interface ExistingWebhooksResponse {
	webhooks: {
		nodes: LinearWebhookRecord[];
	};
}

interface TeamsResponse {
	teams: {
		nodes: Array<{
			id: string;
			name: string;
			private: boolean;
		}>;
	};
}

interface WebhookMutationResponse {
	webhookCreate?: {
		success: boolean;
		webhook: { id: string; enabled: boolean } | null;
	};
	webhookUpdate?: {
		success: boolean;
		webhook: { id: string; enabled: boolean } | null;
	};
}

function buildLinearRedirect(params?: {
	error?: string;
	warning?: string;
}): string {
	const redirectUrl = new URL("/integrations/linear", env.NEXT_PUBLIC_WEB_URL);

	if (params?.error) {
		redirectUrl.searchParams.set("error", params.error);
	}

	if (params?.warning) {
		redirectUrl.searchParams.set("warning", params.warning);
	}

	return redirectUrl.toString();
}

function webhookNeedsUpdate(webhook: LinearWebhookRecord): boolean {
	if (!webhook.enabled) {
		return true;
	}

	if (webhook.url !== LINEAR_WEBHOOK_URL) {
		return true;
	}

	if (webhook.secret !== env.LINEAR_WEBHOOK_SECRET) {
		return true;
	}

	return !ISSUE_RESOURCE_TYPES.every((resourceType) =>
		webhook.resourceTypes.includes(resourceType),
	);
}

async function upsertIssueWebhook(
	linearClient: LinearClient,
	existingWebhook: LinearWebhookRecord | undefined,
	input:
		| {
				allPublicTeams: true;
				label: string;
		  }
		| {
				teamId: string;
				label: string;
		  },
) {
	if (existingWebhook && !webhookNeedsUpdate(existingWebhook)) {
		return;
	}

	if (existingWebhook) {
		const response = await linearClient.client.request<
			WebhookMutationResponse,
			{
				id: string;
				input: {
					enabled: boolean;
					label: string;
					resourceTypes: string[];
					secret: string;
					url: string;
				};
			}
		>(UPDATE_WEBHOOK_MUTATION, {
			id: existingWebhook.id,
			input: {
				enabled: true,
				label: input.label,
				resourceTypes: ISSUE_RESOURCE_TYPES,
				secret: env.LINEAR_WEBHOOK_SECRET,
				url: LINEAR_WEBHOOK_URL,
			},
		});

		if (!response.webhookUpdate?.success) {
			throw new Error("Failed to update Linear webhook");
		}

		return;
	}

	const response = await linearClient.client.request<
		WebhookMutationResponse,
		{
			input: {
				allPublicTeams?: boolean;
				label: string;
				resourceTypes: string[];
				secret: string;
				teamId?: string;
				url: string;
			};
		}
	>(CREATE_WEBHOOK_MUTATION, {
		input: {
			...input,
			resourceTypes: ISSUE_RESOURCE_TYPES,
			secret: env.LINEAR_WEBHOOK_SECRET,
			url: LINEAR_WEBHOOK_URL,
		},
	});

	if (!response.webhookCreate?.success) {
		throw new Error("Failed to create Linear webhook");
	}
}

async function ensureLinearIssueWebhooks(linearClient: LinearClient) {
	const [existingWebhooksResponse, teamsResponse] = await Promise.all([
		linearClient.client.request<
			ExistingWebhooksResponse,
			Record<string, never>
		>(EXISTING_WEBHOOKS_QUERY),
		linearClient.client.request<TeamsResponse, Record<string, never>>(
			TEAMS_QUERY,
		),
	]);

	const existingWebhooks = existingWebhooksResponse.webhooks.nodes.filter(
		(webhook) => webhook.url === LINEAR_WEBHOOK_URL,
	);

	const publicWebhook =
		existingWebhooks.find(
			(webhook) => webhook.allPublicTeams && webhook.enabled,
		) ?? existingWebhooks.find((webhook) => webhook.allPublicTeams);

	await upsertIssueWebhook(linearClient, publicWebhook, {
		allPublicTeams: true,
		label: "Superset Task Sync (public teams)",
	});

	for (const team of teamsResponse.teams.nodes) {
		if (!team.private) {
			continue;
		}

		const existingTeamWebhook =
			existingWebhooks.find(
				(webhook) => webhook.team?.id === team.id && webhook.enabled,
			) ?? existingWebhooks.find((webhook) => webhook.team?.id === team.id);

		await upsertIssueWebhook(linearClient, existingTeamWebhook, {
			teamId: team.id,
			label: `Superset Task Sync (${team.name})`,
		});
	}
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");

	if (error) {
		return Response.redirect(buildLinearRedirect({ error: "oauth_denied" }));
	}

	if (!code || !state) {
		return Response.redirect(buildLinearRedirect({ error: "missing_params" }));
	}

	// Verify signed state (prevents forgery)
	const stateData = verifySignedState(state);
	if (!stateData) {
		return Response.redirect(buildLinearRedirect({ error: "invalid_state" }));
	}

	const { organizationId, userId } = stateData;

	// Re-verify membership at callback time (defense-in-depth)
	const membership = await db.query.members.findFirst({
		where: and(
			eq(members.organizationId, organizationId),
			eq(members.userId, userId),
		),
	});

	if (!membership) {
		console.error("[linear/callback] Membership verification failed:", {
			organizationId,
			userId,
		});
		return Response.redirect(buildLinearRedirect({ error: "unauthorized" }));
	}

	const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: env.LINEAR_CLIENT_ID,
			client_secret: env.LINEAR_CLIENT_SECRET,
			redirect_uri: `${LINEAR_PUBLIC_API_URL}/api/integrations/linear/callback`,
			code,
		}),
	});

	if (!tokenResponse.ok) {
		return Response.redirect(
			buildLinearRedirect({ error: "token_exchange_failed" }),
		);
	}

	const tokenData: LinearTokenResponse = await tokenResponse.json();

	const linearClient = new LinearClient({
		accessToken: tokenData.access_token,
	});
	const viewer = await linearClient.viewer;
	const linearOrg = await viewer.organization;

	const tokenExpiresAt = tokenData.expires_in
		? new Date(Date.now() + tokenData.expires_in * 1000)
		: null;
	let warning: string | undefined;

	try {
		await ensureLinearIssueWebhooks(linearClient);
	} catch (error) {
		console.error("[linear/callback] Failed to ensure issue webhooks:", error);
		warning = "webhook_setup_failed";
	}

	await db
		.insert(integrationConnections)
		.values({
			organizationId,
			connectedByUserId: userId,
			provider: "linear",
			accessToken: tokenData.access_token,
			refreshToken: tokenData.refresh_token ?? null,
			tokenExpiresAt,
			externalOrgId: linearOrg.id,
			externalOrgName: linearOrg.name,
		})
		.onConflictDoUpdate({
			target: [
				integrationConnections.organizationId,
				integrationConnections.provider,
			],
			set: {
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token ?? null,
				tokenExpiresAt,
				externalOrgId: linearOrg.id,
				externalOrgName: linearOrg.name,
				connectedByUserId: userId,
				updatedAt: new Date(),
			},
		});

	try {
		await qstash.publishJSON({
			url: `${env.NEXT_PUBLIC_API_URL}/api/integrations/linear/jobs/initial-sync`,
			body: { organizationId, creatorUserId: userId },
			retries: 3,
		});
	} catch (error) {
		console.error("Failed to queue initial sync job:", error);
		return Response.redirect(
			buildLinearRedirect({ warning: "sync_queued_failed" }),
		);
	}

	return Response.redirect(buildLinearRedirect({ warning }));
}
