import { describe, expect, test } from "bun:test";
import { terminalPresetSchema } from "./zod";

describe("terminalPresetSchema", () => {
	const basePreset = {
		id: "test-id",
		name: "Test Preset",
		cwd: "./src",
		commands: ["bun dev"],
	};

	test("accepts a preset without an icon field", () => {
		const result = terminalPresetSchema.safeParse(basePreset);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.icon).toBeUndefined();
		}
	});

	test("accepts a preset with an emoji icon", () => {
		const result = terminalPresetSchema.safeParse({
			...basePreset,
			icon: "🚀",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.icon).toBe("🚀");
		}
	});

	test("accepts a preset with a built-in icon key", () => {
		const result = terminalPresetSchema.safeParse({
			...basePreset,
			icon: "claude",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.icon).toBe("claude");
		}
	});

	test("accepts a preset with an empty string icon", () => {
		const result = terminalPresetSchema.safeParse({
			...basePreset,
			icon: "",
		});
		expect(result.success).toBe(true);
	});
});
