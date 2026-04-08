import type { ChildProcess } from "node:child_process";
import * as childProcess from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { app } from "electron";
import { env as sharedEnv } from "shared/env.shared";
import { getProcessEnvWithShellPath } from "../../lib/trpc/routers/workspaces/utils/shell-env";
import { SUPERSET_HOME_DIR } from "./app-environment";
import { getDeviceName, getHashedDeviceId } from "./device-info";
import {
	type HostServiceManifest,
	isProcessAlive,
	listManifests,
	manifestDir,
	readManifest,
	removeManifest,
} from "./host-service-manifest";
import { HOOK_PROTOCOL_VERSION } from "./terminal/env";

/** Minimum host-service version this app can work with. */
const _MIN_HOST_SERVICE_VERSION = "0.0.0";

export type HostServiceStatus =
	| "starting"
	| "running"
	| "degraded"
	| "restarting"
	| "stopped";

export interface HostServiceStatusEvent {
	organizationId: string;
	status: HostServiceStatus;
	previousStatus: HostServiceStatus | null;
}

export interface SpawnConfig {
	authToken: string;
	cloudApiUrl: string;
}

interface HostServiceProcess {
	process: ChildProcess | null;
	pid: number | null;
	port: number;
	secret: string;
	status: HostServiceStatus;
	restartCount: number;
	organizationId: string;
	startedAt: number;
	spawnConfig: SpawnConfig | null;
}

const MAX_RESTART_DELAY = 30_000;
const BASE_RESTART_DELAY = 1_000;
const HEALTH_POLL_INTERVAL = 200;
const HEALTH_POLL_TIMEOUT = 10_000;
const ADOPTED_LIVENESS_INTERVAL = 5_000;

async function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				const { port } = addr;
				server.close(() => resolve(port));
			} else {
				server.close(() => reject(new Error("Could not get port")));
			}
		});
		server.on("error", reject);
	});
}

async function pollHealthCheck(
	endpoint: string,
	secret: string,
	timeoutMs = HEALTH_POLL_TIMEOUT,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 2_000);
			const res = await fetch(`${endpoint}/trpc/health.check`, {
				signal: controller.signal,
				headers: { Authorization: `Bearer ${secret}` },
			});
			clearTimeout(timeout);
			if (res.ok) return true;
		} catch {
			// Not ready yet
		}
		await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL));
	}
	return false;
}

export class HostServiceManager extends EventEmitter {
	private instances = new Map<string, HostServiceProcess>();
	private pendingStarts = new Map<string, Promise<number>>();
	private scheduledRestarts = new Map<string, ReturnType<typeof setTimeout>>();
	private adoptedLivenessTimers = new Map<
		string,
		ReturnType<typeof setInterval>
	>();
	private scriptPath = path.join(__dirname, "host-service.js");

	async start(
		organizationId: string,
		config: SpawnConfig,
	): Promise<{ port: number; secret: string }> {
		const existing = this.instances.get(organizationId);
		if (existing?.status === "running") {
			return { port: existing.port, secret: existing.secret };
		}

		const pending = this.pendingStarts.get(organizationId);
		if (pending) {
			const port = await pending;
			const secret = this.instances.get(organizationId)?.secret ?? "";
			return { port, secret };
		}

		this.cancelScheduledRestart(organizationId);

		const startPromise = this.doStart(organizationId, config);
		this.pendingStarts.set(organizationId, startPromise);

		try {
			const port = await startPromise;
			const secret = this.instances.get(organizationId)?.secret ?? "";
			return { port, secret };
		} finally {
			this.pendingStarts.delete(organizationId);
		}
	}

	private async doStart(
		organizationId: string,
		config: SpawnConfig,
	): Promise<number> {
		// Try adopting a running service first
		const adopted = await this.tryAdopt(organizationId, config);
		if (adopted !== null) return adopted;

		return this.spawn(organizationId, config);
	}

	stop(organizationId: string): void {
		const instance = this.instances.get(organizationId);
		this.cancelScheduledRestart(organizationId);
		this.stopAdoptedLivenessCheck(organizationId);

		if (!instance) return;

		const previousStatus = instance.status;
		instance.status = "stopped";

		if (instance.process) {
			instance.process.kill("SIGTERM");
		} else if (instance.pid) {
			try {
				process.kill(instance.pid, "SIGTERM");
			} catch {}
		}

		this.instances.delete(organizationId);
		removeManifest(organizationId);
		this.emitStatus(organizationId, "stopped", previousStatus);
	}

	stopAll(): void {
		for (const [id] of this.instances) {
			this.stop(id);
		}
	}

	releaseAll(): void {
		for (const [id] of this.instances) {
			this.stopAdoptedLivenessCheck(id);
		}
		this.instances.clear();
		for (const timer of this.scheduledRestarts.values()) {
			clearTimeout(timer);
		}
		this.scheduledRestarts.clear();
	}

	async discoverAndAdoptAll(config: SpawnConfig): Promise<void> {
		const manifests = listManifests();
		for (const manifest of manifests) {
			if (this.instances.has(manifest.organizationId)) continue;
			try {
				await this.tryAdopt(manifest.organizationId, config);
			} catch {
				removeManifest(manifest.organizationId);
			}
		}
	}

	async restart(
		organizationId: string,
		config?: SpawnConfig,
	): Promise<{ port: number; secret: string }> {
		const savedConfig =
			config ?? this.instances.get(organizationId)?.spawnConfig;
		if (!savedConfig) {
			throw new Error("No config available for restart");
		}
		this.stop(organizationId);
		return this.start(organizationId, savedConfig);
	}

	getConnection(
		organizationId: string,
	): { port: number; secret: string } | null {
		const instance = this.instances.get(organizationId);
		if (!instance || instance.status !== "running") return null;
		return { port: instance.port, secret: instance.secret };
	}

	getStatus(organizationId: string): HostServiceStatus {
		if (this.pendingStarts.has(organizationId)) return "starting";
		return this.instances.get(organizationId)?.status ?? "stopped";
	}

	hasActiveInstances(): boolean {
		for (const instance of this.instances.values()) {
			if (instance.status === "running" || instance.status === "starting")
				return true;
		}
		return this.pendingStarts.size > 0;
	}

	getActiveOrganizationIds(): string[] {
		return [...this.instances.entries()]
			.filter(([, i]) => i.status !== "stopped")
			.map(([id]) => id);
	}

	// ── Adoption ──────────────────────────────────────────────────────

	private async tryAdopt(
		organizationId: string,
		config: SpawnConfig,
	): Promise<number | null> {
		const manifest = this.readAndValidateManifest(organizationId);
		if (!manifest) return null;

		const url = new URL(manifest.endpoint);
		const port = Number(url.port);

		const instance: HostServiceProcess = {
			process: null,
			pid: manifest.pid,
			port,
			secret: manifest.authToken,
			status: "running",
			restartCount: 0,
			organizationId,
			startedAt: manifest.startedAt,
			spawnConfig: config,
		};
		this.instances.set(organizationId, instance);
		this.startAdoptedLivenessCheck(organizationId, manifest.pid, config);

		console.log(
			`[host-service:${organizationId}] Adopted pid=${manifest.pid} port=${port}`,
		);
		this.emitStatus(organizationId, "running", null);
		return port;
	}

	private readAndValidateManifest(
		organizationId: string,
	): HostServiceManifest | null {
		const manifest = readManifest(organizationId);
		if (!manifest) return null;

		if (!isProcessAlive(manifest.pid)) {
			removeManifest(organizationId);
			return null;
		}

		return manifest;
	}

	// ── Spawn ─────────────────────────────────────────────────────────

	private async spawn(
		organizationId: string,
		config: SpawnConfig,
	): Promise<number> {
		const previousInstance = this.instances.get(organizationId);
		const restartCount = previousInstance?.restartCount ?? 0;

		const port = await findFreePort();
		const secret = randomBytes(32).toString("hex");

		const instance: HostServiceProcess = {
			process: null,
			pid: null,
			port,
			secret,
			status: "starting",
			restartCount,
			organizationId,
			startedAt: Date.now(),
			spawnConfig: config,
		};
		this.instances.set(organizationId, instance);
		this.emitStatus(organizationId, "starting", null);

		const env = await this.buildEnv(organizationId, port, secret, config);
		const child = childProcess.spawn(process.execPath, [this.scriptPath], {
			stdio: ["ignore", "pipe", "pipe"],
			env,
		});
		instance.process = child;
		instance.pid = child.pid ?? null;

		child.stdout?.on("data", (data: Buffer) => {
			console.log(`[host-service:${organizationId}] ${data.toString().trim()}`);
		});
		child.stderr?.on("data", (data: Buffer) => {
			console.error(
				`[host-service:${organizationId}] ${data.toString().trim()}`,
			);
		});
		child.on("exit", (code) => {
			console.log(`[host-service:${organizationId}] exited with code ${code}`);
			const current = this.instances.get(organizationId);
			if (!current || current.process !== child || current.status === "stopped")
				return;

			current.status = "degraded";
			this.emitStatus(organizationId, "degraded", "running");
			this.scheduleRestart(organizationId);
		});
		child.unref();

		const endpoint = `http://127.0.0.1:${port}`;
		const healthy = await pollHealthCheck(endpoint, secret);
		if (!healthy) {
			child.kill("SIGTERM");
			this.instances.delete(organizationId);
			throw new Error(
				`Host service failed to start within ${HEALTH_POLL_TIMEOUT}ms`,
			);
		}

		instance.status = "running";
		instance.restartCount = 0;

		console.log(`[host-service:${organizationId}] listening on port ${port}`);
		this.emitStatus(organizationId, "running", "starting");
		return port;
	}

	private async buildEnv(
		organizationId: string,
		port: number,
		secret: string,
		config: SpawnConfig,
	): Promise<Record<string, string>> {
		const orgDir = manifestDir(organizationId);

		return getProcessEnvWithShellPath({
			...(process.env as Record<string, string>),
			ELECTRON_RUN_AS_NODE: "1",
			ORGANIZATION_ID: organizationId,
			DEVICE_CLIENT_ID: getHashedDeviceId(),
			DEVICE_NAME: getDeviceName(),
			HOST_SERVICE_SECRET: secret,
			HOST_SERVICE_PORT: String(port),
			HOST_MANIFEST_DIR: orgDir,
			KEEP_ALIVE_AFTER_PARENT: "1",
			HOST_DB_PATH: path.join(orgDir, "host.db"),
			HOST_MIGRATIONS_FOLDER: app.isPackaged
				? path.join(process.resourcesPath, "resources/host-migrations")
				: path.join(app.getAppPath(), "../../packages/host-service/drizzle"),
			DESKTOP_VITE_PORT: String(sharedEnv.DESKTOP_VITE_PORT),
			SUPERSET_HOME_DIR: SUPERSET_HOME_DIR,
			SUPERSET_AGENT_HOOK_PORT: String(sharedEnv.DESKTOP_NOTIFICATIONS_PORT),
			SUPERSET_AGENT_HOOK_VERSION: HOOK_PROTOCOL_VERSION,
			AUTH_TOKEN: config.authToken,
			CLOUD_API_URL: config.cloudApiUrl,
		});
	}

	// ── Liveness ──────────────────────────────────────────────────────

	private startAdoptedLivenessCheck(
		organizationId: string,
		pid: number,
		_config: SpawnConfig,
	): void {
		this.stopAdoptedLivenessCheck(organizationId);
		const timer = setInterval(() => {
			if (!isProcessAlive(pid)) {
				clearInterval(timer);
				this.adoptedLivenessTimers.delete(organizationId);
				const instance = this.instances.get(organizationId);
				if (instance && instance.status !== "stopped") {
					console.log(
						`[host-service:${organizationId}] Adopted process ${pid} died`,
					);
					instance.status = "degraded";
					this.emitStatus(organizationId, "degraded", "running");
					this.instances.delete(organizationId);
					removeManifest(organizationId);
					this.scheduleRestart(organizationId);
				}
			}
		}, ADOPTED_LIVENESS_INTERVAL);
		this.adoptedLivenessTimers.set(organizationId, timer);
	}

	private stopAdoptedLivenessCheck(organizationId: string): void {
		const timer = this.adoptedLivenessTimers.get(organizationId);
		if (timer) {
			clearInterval(timer);
			this.adoptedLivenessTimers.delete(organizationId);
		}
	}

	// ── Restart ───────────────────────────────────────────────────────

	private cancelScheduledRestart(organizationId: string): void {
		const timer = this.scheduledRestarts.get(organizationId);
		if (timer) {
			clearTimeout(timer);
			this.scheduledRestarts.delete(organizationId);
		}
	}

	private scheduleRestart(organizationId: string): void {
		const instance = this.instances.get(organizationId);
		this.cancelScheduledRestart(organizationId);

		const restartCount = instance?.restartCount ?? 0;
		const delay = Math.min(
			BASE_RESTART_DELAY * 2 ** restartCount,
			MAX_RESTART_DELAY,
		);

		console.log(
			`[host-service:${organizationId}] restarting in ${delay}ms (attempt ${restartCount + 1})`,
		);

		const timer = setTimeout(() => {
			this.scheduledRestarts.delete(organizationId);
			const config = instance?.spawnConfig;
			if (config) {
				this.spawn(organizationId, config).catch((err) => {
					console.error(
						`[host-service:${organizationId}] restart failed:`,
						err,
					);
				});
			}
		}, delay);
		this.scheduledRestarts.set(organizationId, timer);
	}

	private emitStatus(
		organizationId: string,
		status: HostServiceStatus,
		previousStatus: HostServiceStatus | null,
	): void {
		this.emit("status-changed", {
			organizationId,
			status,
			previousStatus,
		} satisfies HostServiceStatusEvent);
	}
}

let manager: HostServiceManager | null = null;

export function getHostServiceManager(): HostServiceManager {
	if (!manager) {
		manager = new HostServiceManager();
	}
	return manager;
}
