import { describe, expect, test } from "bun:test";
import { deriveBranchName } from "./deriveBranchName";

describe("deriveBranchName", () => {
	test("preserves case of slug", () => {
		expect(deriveBranchName({ slug: "FEAT-123", title: "my feature" })).toBe(
			"FEAT-123-my-feature",
		);
	});

	test("preserves mixed case slug", () => {
		expect(deriveBranchName({ slug: "AAA-1", title: "dummy feature" })).toBe(
			"AAA-1-dummy-feature",
		);
	});

	test("returns slug alone when title sanitizes to empty", () => {
		expect(deriveBranchName({ slug: "FEAT-1", title: "   " })).toBe("FEAT-1");
	});

	test("handles lowercase slugs unchanged", () => {
		expect(deriveBranchName({ slug: "feat-123", title: "test" })).toBe(
			"feat-123-test",
		);
	});
});
