/**
 * Workspace Service — Desktop Entry Point
 *
 * Starts the host-service HTTP server on a port assigned by the coordinator.
 * The coordinator polls health.check to know when it's ready.
 *
 * When KEEP_ALIVE_AFTER_PARENT=1, the service stays running even if the
 * parent Electron process exits (out-of-app durability mode).
 */

import { serve } from "@hono/node-server";
import {
	createApp,
	JwtApiAuthProvider,
	LocalGitCredentialProvider,
	LocalModelProvider,
	PskHostAuthProvider,
} from "@superset/host-service";
import {
	initTerminalBaseEnv,
	resolveTerminalBaseEnv,
} from "@superset/host-service/terminal-env";
import { connectRelay } from "@superset/host-service/tunnel";
import { removeManifest, writeManifest } from "main/lib/host-service-manifest";
import { env } from "./env";

async function main(): Promise<void> {
	const terminalBaseEnv = await resolveTerminalBaseEnv();
	initTerminalBaseEnv(terminalBaseEnv);

	const { app, injectWebSocket, api } = createApp({
		config: {
			dbPath: env.HOST_DB_PATH,
			cloudApiUrl: env.CLOUD_API_URL,
			migrationsFolder: env.HOST_MIGRATIONS_FOLDER,
			allowedOrigins: [
				`http://localhost:${env.DESKTOP_VITE_PORT}`,
				`http://127.0.0.1:${env.DESKTOP_VITE_PORT}`,
			],
		},
		providers: {
			auth: new JwtApiAuthProvider(env.AUTH_TOKEN),
			hostAuth: new PskHostAuthProvider(env.HOST_SERVICE_SECRET),
			credentials: new LocalGitCredentialProvider(),
			modelResolver: new LocalModelProvider(),
		},
	});

	const startedAt = Date.now();
	const server = serve(
		{ fetch: app.fetch, port: env.HOST_SERVICE_PORT, hostname: "127.0.0.1" },
		(info: { port: number }) => {
			if (env.ORGANIZATION_ID) {
				try {
					writeManifest({
						pid: process.pid,
						endpoint: `http://127.0.0.1:${info.port}`,
						authToken: env.HOST_SERVICE_SECRET,
						startedAt,
						organizationId: env.ORGANIZATION_ID,
					});
				} catch (error) {
					console.error("[host-service] Failed to write manifest:", error);
				}
			}

			if (env.RELAY_URL) {
				void connectRelay({
					api,
					relayUrl: env.RELAY_URL,
					localPort: info.port,
					getAuthToken: () => process.env.AUTH_TOKEN ?? null,
				});
			}
		},
	);
	injectWebSocket(server);

	const shutdown = () => {
		if (env.ORGANIZATION_ID) {
			removeManifest(env.ORGANIZATION_ID);
		}
		server.close();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	if (!env.KEEP_ALIVE_AFTER_PARENT) {
		const parentPid = process.ppid;
		const parentCheck = setInterval(() => {
			try {
				process.kill(parentPid, 0);
			} catch {
				clearInterval(parentCheck);
				console.log("[host-service] Parent process exited, shutting down");
				shutdown();
			}
		}, 2000);
		parentCheck.unref();
	}
}

void main().catch((error) => {
	console.error("[host-service] Failed to start:", error);
	process.exit(1);
});
