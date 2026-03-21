import { toast } from "@superset/ui/sonner";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { EnrichedPort } from "shared/types";
import type { KillablePort } from "./getPortsToKillForPane";

interface KillPortResult {
	success: boolean;
	error?: string;
}

interface KillPortsResult {
	results: KillPortResult[];
	failedCount: number;
}

export function useKillPort() {
	const killMutation = electronTrpc.ports.kill.useMutation();

	const killPort = async (
		port: Pick<EnrichedPort, "paneId" | "port">,
	): Promise<KillPortResult> => {
		const result = await killMutation.mutateAsync({
			paneId: port.paneId,
			port: port.port,
		});
		if (!result.success) {
			toast.error(`Failed to close port ${port.port}`, {
				description: result.error,
			});
		}

		return result;
	};

	const killPorts = async (ports: KillablePort[]): Promise<KillPortsResult> => {
		if (ports.length === 0) {
			return {
				results: [],
				failedCount: 0,
			};
		}

		const results = await Promise.all(
			ports.map((port) =>
				killMutation.mutateAsync({
					paneId: port.paneId,
					port: port.port,
				}),
			),
		);

		const failedCount = results.filter((result) => !result.success).length;
		if (failedCount > 0) {
			toast.error(`Failed to close ${failedCount} port(s)`);
		}

		return {
			results,
			failedCount,
		};
	};

	return { killPort, killPorts, isPending: killMutation.isPending };
}
