import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		AUTH_TOKEN: z.string().min(1),
		CLOUD_API_URL: z.string().url(),
		HOST_DB_PATH: z.string().min(1),
		HOST_MIGRATIONS_FOLDER: z.string().min(1),
		HOST_SERVICE_SECRET: z.string().min(1),
		HOST_SERVICE_PORT: z.coerce.number().int().positive(),
		ORGANIZATION_ID: z.string().default(""),
		DESKTOP_VITE_PORT: z.string().default("5173"),
		KEEP_ALIVE_AFTER_PARENT: z
			.enum(["0", "1"])
			.default("0")
			.transform((v) => v === "1"),
		RELAY_URL: z.string().url().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
