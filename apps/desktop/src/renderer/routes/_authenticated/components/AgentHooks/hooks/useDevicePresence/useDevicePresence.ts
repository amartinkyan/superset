import { useEffect, useRef } from "react";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import { authClient } from "renderer/lib/auth-client";
import { electronTrpc } from "renderer/lib/electron-trpc";

/**
 * Registers this device once on startup so MCP can verify ownership.
 * No polling — just a single upsert into device_presence.
 */
export function useDevicePresence() {
	const { data: session } = authClient.useSession();
	const { data: deviceInfo } = electronTrpc.auth.getDeviceInfo.useQuery();
	const registeredRef = useRef(false);

	useEffect(() => {
		if (!deviceInfo || !session?.session?.activeOrganizationId) return;
		if (registeredRef.current) return;
		registeredRef.current = true;

		apiTrpcClient.device.registerDevice
			.mutate({
				deviceId: deviceInfo.deviceId,
				deviceName: deviceInfo.deviceName,
				deviceType: "desktop",
			})
			.catch(() => {
				// Registration can fail when offline — will retry on next app launch
				registeredRef.current = false;
			});
	}, [deviceInfo, session?.session?.activeOrganizationId]);

	return {
		deviceInfo,
		isActive: !!deviceInfo && !!session?.session?.activeOrganizationId,
	};
}
