import { observable } from "@trpc/server/observable";
import { env } from "main/env.main";
import {
	getHostServiceManager,
	type HostServiceStatusEvent,
} from "main/lib/host-service-manager";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { loadToken } from "../auth/utils/auth-functions";

export const createHostServiceManagerRouter = () => {
	return router({
		getLocalPort: publicProcedure
			.input(
				z.object({
					organizationId: z.string(),
					organizationName: z.string().optional(),
				}),
			)
			.query(async ({ input }) => {
				const manager = getHostServiceManager();
				const { token } = await loadToken();
				if (!token) {
					throw new Error("No auth token available — user must be logged in");
				}
				return manager.start(input.organizationId, {
					authToken: token,
					cloudApiUrl: env.NEXT_PUBLIC_API_URL,
				});
			}),

		getStatus: publicProcedure
			.input(z.object({ organizationId: z.string() }))
			.query(({ input }) => {
				const manager = getHostServiceManager();
				const status = manager.getStatus(input.organizationId);
				return { status };
			}),

		restart: publicProcedure
			.input(z.object({ organizationId: z.string() }))
			.mutation(async ({ input }) => {
				const manager = getHostServiceManager();
				const { token } = await loadToken();
				if (!token) {
					throw new Error("No auth token available — user must be logged in");
				}
				return manager.restart(input.organizationId, {
					authToken: token,
					cloudApiUrl: env.NEXT_PUBLIC_API_URL,
				});
			}),

		onStatusChange: publicProcedure.subscription(() => {
			return observable<HostServiceStatusEvent>((emit) => {
				const manager = getHostServiceManager();
				const handler = (event: HostServiceStatusEvent) => emit.next(event);
				manager.on("status-changed", handler);
				return () => manager.off("status-changed", handler);
			});
		}),
	});
};
