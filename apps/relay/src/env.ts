import { z } from "zod";

const envSchema = z.object({
	PORT: z.coerce.number().int().positive().default(8080),
	AUTH_URL: z.string().url(),
	DATABASE_URL: z.string().min(1),
	RELAY_TUNNEL_SECRET: z.string().min(32),
	REQUEST_TIMEOUT_MS: z.coerce.number().default(30_000),
});

export const env = envSchema.parse(process.env);
