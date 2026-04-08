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
	const { app, injectWebSocket, api, deviceClientId, deviceName } = createApp({
		dbPath: env.HOST_DB_PATH,
		hostAuth,
		allowedOrigins: env.CORS_ORIGINS ?? [],
	});

	const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
		console.log(`[host-service] listening on http://localhost:${info.port}`);

		// Register host and connect to relay if configured
		const relayUrl = process.env.RELAY_URL;
		if (api && deviceClientId && deviceName && relayUrl) {
			void registerAndConnect({
				api,
				deviceClientId,
				deviceName,
				relayUrl,
				localPort: info.port,
			});
		}
	});
	injectWebSocket(server);
}

async function registerAndConnect(options: {
	api: NonNullable<ReturnType<typeof createApp>["api"]>;
	deviceClientId: string;
	deviceName: string;
	relayUrl: string;
	localPort: number;
}): Promise<void> {
	try {
		const host = await options.api.device.ensureV2Host.mutate({
			machineId: options.deviceClientId,
			name: options.deviceName,
		});

		console.log(`[host-service] registered as host ${host.id}`);

		const tunnel = new TunnelClient({
			relayUrl: options.relayUrl,
			hostId: host.id,
			getAuthToken: () => process.env.AUTH_TOKEN ?? null,
			localPort: options.localPort,
		});
		tunnel.connect();
	} catch (error) {
		console.error("[host-service] failed to register host:", error);
	}
}

void main().catch((error) => {
	console.error("[host-service] Failed to start:", error);
	process.exit(1);
});
