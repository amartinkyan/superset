import { getDeviceName, getHashedDeviceId } from "@superset/shared/device-info";
import type { ApiClient } from "../types";
import { TunnelClient } from "./tunnel-client";

export interface ConnectRelayOptions {
	api: ApiClient;
	relayUrl: string;
	localPort: number;
	getAuthToken: () => string | null;
}

export async function connectRelay(
	options: ConnectRelayOptions,
): Promise<TunnelClient | null> {
	try {
		const host = await options.api.device.ensureV2Host.mutate({
			machineId: getHashedDeviceId(),
			name: getDeviceName(),
		});
		console.log(`[host-service] registered as host ${host.id}`);

		const tunnel = new TunnelClient({
			relayUrl: options.relayUrl,
			hostId: host.id,
			getAuthToken: options.getAuthToken,
			localPort: options.localPort,
		});
		tunnel.connect();
		return tunnel;
	} catch (error) {
		console.error("[host-service] failed to register/connect relay:", error);
		return null;
	}
}
