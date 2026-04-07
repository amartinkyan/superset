import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./env";
import { PskHostAuthProvider } from "./providers/host-auth";
import { initTerminalBaseEnv, resolveTerminalBaseEnv } from "./terminal/env";
import { TunnelClient } from "./tunnel";

async function main(): Promise<void> {
	const terminalBaseEnv = await resolveTerminalBaseEnv();
	initTerminalBaseEnv(terminalBaseEnv);

	const hostAuth = new PskHostAuthProvider(env.HOST_SERVICE_SECRET);
	const { app, injectWebSocket } = createApp({
		dbPath: env.HOST_DB_PATH,
		hostAuth,
		allowedOrigins: env.CORS_ORIGINS ?? [],
	});

	const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
		console.log(`[host-service] listening on http://localhost:${info.port}`);

		// Connect to relay if configured
		const relayUrl = process.env.RELAY_URL;
		const tunnelSecret = process.env.RELAY_TUNNEL_SECRET;
		const hostId = process.env.HOST_ID;
		if (relayUrl && tunnelSecret && hostId) {
			const tunnel = new TunnelClient({
				relayUrl,
				hostId,
				tunnelSecret,
				localPort: info.port,
			});
			tunnel.connect();
		}
	});
	injectWebSocket(server);
}

void main().catch((error) => {
	console.error("[host-service] Failed to start:", error);
	process.exit(1);
});
