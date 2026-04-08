import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";

const defaultMigrationsFolder =
	typeof import.meta.dirname === "string"
		? join(import.meta.dirname, "../drizzle")
		: join(__dirname, "../../drizzle");

const envSchema = z.object({
	HOST_SERVICE_SECRET: z
		.string()
		.min(1)
		.default(randomBytes(32).toString("hex")),
	HOST_DB_PATH: z.string().min(1),
	HOST_MIGRATIONS_FOLDER: z.string().min(1).default(defaultMigrationsFolder),
	CORS_ORIGINS: z
		.string()
		.transform((s) => s.split(",").map((o) => o.trim()))
		.optional(),
	PORT: z.coerce.number().int().positive().default(4879),
});

export const env = envSchema.parse(process.env);
