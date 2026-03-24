import { LinearClient } from "@linear/sdk";
import { db } from "@superset/db/client";
import {
	integrationConnections,
	type SelectIntegrationConnection,
} from "@superset/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "../../../env";

const LINEAR_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const LINEAR_WEBHOOK_URL = `${
	env.LINEAR_PUBLIC_API_URL ?? env.NEXT_PUBLIC_API_URL
}/api/integrations/linear/webhook`;

const EXISTING_WEBHOOKS_QUERY = `
	query ExistingWebhooks {
		webhooks {
			nodes {
				id
				url
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

interface ExistingWebhooksResponse {
	webhooks: {
		nodes: Array<{
			id: string;
			url: string;
			enabled: boolean;
		}>;
	};
}

type Priority = "urgent" | "high" | "medium" | "low" | "none";

export function mapPriorityToLinear(priority: Priority): number {
	switch (priority) {
		case "urgent":
			return 1;
		case "high":
			return 2;
		case "medium":
			return 3;
		case "low":
			return 4;
		default:
			return 0;
	}
}

export function mapPriorityFromLinear(linearPriority: number): Priority {
	switch (linearPriority) {
		case 1:
			return "urgent";
		case 2:
			return "high";
		case 3:
			return "medium";
		case 4:
			return "low";
		default:
			return "none";
	}
}

function shouldRefreshLinearToken(
	connection: SelectIntegrationConnection,
): boolean {
	if (!connection.refreshToken || !connection.tokenExpiresAt) {
		return false;
	}

	return (
		connection.tokenExpiresAt.getTime() <=
		Date.now() + LINEAR_TOKEN_REFRESH_BUFFER_MS
	);
}

async function refreshLinearConnectionToken(
	connection: SelectIntegrationConnection,
): Promise<SelectIntegrationConnection> {
	const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: env.LINEAR_CLIENT_ID,
			client_secret: env.LINEAR_CLIENT_SECRET,
			refresh_token: connection.refreshToken ?? "",
		}),
	});

	if (!tokenResponse.ok) {
		throw new Error("Failed to refresh Linear access token");
	}

	const tokenData = (await tokenResponse.json()) as LinearTokenResponse;
	const tokenExpiresAt = tokenData.expires_in
		? new Date(Date.now() + tokenData.expires_in * 1000)
		: null;

	const [updatedConnection] = await db
		.update(integrationConnections)
		.set({
			accessToken: tokenData.access_token,
			refreshToken: tokenData.refresh_token ?? connection.refreshToken,
			tokenExpiresAt,
			updatedAt: new Date(),
		})
		.where(eq(integrationConnections.id, connection.id))
		.returning();

	if (!updatedConnection) {
		throw new Error("Failed to persist refreshed Linear token");
	}

	return updatedConnection;
}

export async function getLinearClient(
	organizationId: string,
): Promise<LinearClient | null> {
	let connection = await db.query.integrationConnections.findFirst({
		where: and(
			eq(integrationConnections.organizationId, organizationId),
			eq(integrationConnections.provider, "linear"),
		),
	});

	if (!connection) {
		return null;
	}

	if (shouldRefreshLinearToken(connection)) {
		try {
			connection = await refreshLinearConnectionToken(connection);
		} catch (error) {
			console.error("[linear] Failed to refresh access token:", error);
		}
	}

	return new LinearClient({ accessToken: connection.accessToken });
}

export async function getLinearReconnectStatus(
	organizationId: string,
): Promise<{
	needsReconnect: boolean;
	reconnectReason?: "missing_webhook" | "reauth_required";
}> {
	const client = await getLinearClient(organizationId);

	if (!client) {
		return { needsReconnect: false };
	}

	try {
		const response = await client.client.request<
			ExistingWebhooksResponse,
			Record<string, never>
		>(EXISTING_WEBHOOKS_QUERY);

		const hasMatchingWebhook = response.webhooks.nodes.some(
			(webhook) => webhook.enabled && webhook.url === LINEAR_WEBHOOK_URL,
		);

		if (!hasMatchingWebhook) {
			return {
				needsReconnect: true,
				reconnectReason: "missing_webhook",
			};
		}

		return { needsReconnect: false };
	} catch {
		return {
			needsReconnect: true,
			reconnectReason: "reauth_required",
		};
	}
}
