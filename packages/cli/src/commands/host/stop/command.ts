import { CLIError, command } from "@superset/cli-framework";
import { readConfig } from "../../../lib/config";
import {
	isProcessAlive,
	readManifest,
	removeManifest,
} from "../../../lib/host/manifest";

export default command({
	description: "Stop the host service daemon",
	run: async () => {
		const config = readConfig();

		if (!config.activeOrg) {
			throw new CLIError("No active organization", "Run: superset org switch");
		}

		const { id: organizationId, name: orgName } = config.activeOrg;
		const manifest = readManifest(organizationId);

		if (!manifest) {
			return {
				data: { running: false },
				message: `No host service running for ${orgName}`,
			};
		}

		if (isProcessAlive(manifest.pid)) {
			try {
				process.kill(manifest.pid, "SIGTERM");
			} catch (error) {
				throw new CLIError(
					`Failed to stop host service (pid ${manifest.pid}): ${
						error instanceof Error ? error.message : "unknown error"
					}`,
				);
			}
		}

		removeManifest(organizationId);

		return {
			data: { pid: manifest.pid, organizationId },
			message: `Stopped host service for ${orgName}`,
		};
	},
});
