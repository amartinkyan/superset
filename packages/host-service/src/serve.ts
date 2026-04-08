import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./env";
import { JwtApiAuthProvider } from "./providers/auth";
import { LocalGitCredentialProvider } from "./providers/git";
import { PskHostAuthProvider } from "./providers/host-auth";
import { LocalModelProvider } from "./providers/model-providers";
import { initTerminalBaseEnv, resolveTerminalBaseEnv } from "./terminal/env";
import { connectRelay } from "./tunnel";

async function main(): Promise<void> {
	const terminalBaseEnv = await resolveTerminalBaseEnv();
	initTerminalBaseEnv(terminalBaseEnv);

	const authToken = process.env.AUTH_TOKEN;
	const cloudApiUrl = process.env.CLOUD_API_URL;

	if (!authToken || !cloudApiUrl) {
		throw new Error("Missing required env vars: AUTH_TOKEN, CLOUD_API_URL");
	}

	const { app, injectWebSocket, api } = createApp({
		config: {
			dbPath: env.HOST_DB_PATH,
			cloudApiUrl,
			migrationsFolder: env.HOST_MIGRATIONS_FOLDER,
			allowedOrigins: env.CORS_ORIGINS ?? [],
		},
		providers: {
			auth: new JwtApiAuthProvider(authToken),
			hostAuth: new PskHostAuthProvider(env.HOST_SERVICE_SECRET),
			credentials: new LocalGitCredentialProvider(),
			modelResolver: new LocalModelProvider(),
		},
	});

	const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
		console.log(`[host-service] listening on http://localhost:${info.port}`);

		const relayUrl = process.env.RELAY_URL;
		if (relayUrl) {
			void connectRelay({
				api,
				relayUrl,
				localPort: info.port,
				getAuthToken: () => process.env.AUTH_TOKEN ?? null,
			});
		}
	});
	injectWebSocket(server);
}

void main().catch((error) => {
	console.error("[host-service] Failed to start:", error);
	process.exit(1);
});
