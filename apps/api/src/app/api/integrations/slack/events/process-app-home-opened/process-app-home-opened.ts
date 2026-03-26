import { db } from "@superset/db/client";
import { usersSlackUsers } from "@superset/db/schema";
import { and, eq } from "drizzle-orm";
import { getSlackConnectionForTeam } from "../../utils/resolve-team-connection";
import { generateConnectUrl } from "../utils/generate-connect-url";
import { createSlackClient } from "../utils/slack-client";
import { buildHomeView } from "./build-home-view";

interface ProcessAppHomeOpenedParams {
	event: { user: string; tab: string };
	teamId: string;
	eventId: string;
}

export async function processAppHomeOpened({
	event,
	teamId,
}: ProcessAppHomeOpenedParams): Promise<void> {
	const connection = await getSlackConnectionForTeam({
		teamId,
		slackUserId: event.user,
	});

	if (!connection) {
		console.error(
			"[slack/process-app-home-opened] No connection found for team:",
			teamId,
		);
		return;
	}

	const slackUserLink = await db.query.usersSlackUsers.findFirst({
		where: and(
			eq(usersSlackUsers.slackUserId, event.user),
			eq(usersSlackUsers.teamId, teamId),
			eq(usersSlackUsers.organizationId, connection.organizationId),
		),
		with: { user: true },
	});

	const isUserLinked = !!slackUserLink;
	const userName = slackUserLink?.user?.name;

	const connectUrl = isUserLinked
		? undefined
		: generateConnectUrl({
				slackUserId: event.user,
				teamId,
				organizationId: connection.organizationId,
			});

	const slack = createSlackClient(connection.accessToken);

	await slack.views.publish({
		user_id: event.user,
		view: buildHomeView({
			modelPreference: slackUserLink?.modelPreference ?? undefined,
			externalOrgName: connection.externalOrgName ?? undefined,
			isUserLinked,
			userName: userName ?? undefined,
			connectUrl,
		}),
	});
}
