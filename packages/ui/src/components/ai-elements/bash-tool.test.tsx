import { describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Mock Collapsible to always render content (bypasses closed state)
mock.module("../ui/collapsible", () => ({
	Collapsible: ({
		children,
		className,
	}: {
		children: ReactNode;
		className?: string;
	}) => <div className={className}>{children}</div>,
	CollapsibleContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	CollapsibleTrigger: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

const { BashTool } = await import("./bash-tool");

describe("BashTool", () => {
	describe("code block text should not introduce copy artifacts from wrapping (#2896)", () => {
		const longCommand =
			'grep -E "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$" /var/log/very/long/path/to/some/file/that/makes/this/line/extremely/long.txt | sort | uniq -c | sort -rn | head -50';

		const longOutput =
			"match1@example.com match2@test.org match3@domain.co.uk match4@another-very-long-domain-name.example.com result5@yet-another-extremely-long-subdomain.organization.net";

		it("command area should not use whitespace-pre-wrap with break-all", () => {
			const html = renderToStaticMarkup(
				<BashTool
					command={longCommand}
					state="output-available"
					exitCode={0}
				/>,
			);

			// whitespace-pre-wrap + break-all causes browsers to introduce newlines/spaces
			// when copying visually-wrapped text. Code blocks should scroll horizontally.
			expect(html).not.toContain("whitespace-pre-wrap break-all");
		});

		it("stdout area should not use whitespace-pre-wrap with break-all", () => {
			const html = renderToStaticMarkup(
				<BashTool
					command="echo test"
					stdout={longOutput}
					state="output-available"
					exitCode={0}
				/>,
			);

			// Count occurrences - the class should not appear at all in content areas
			const matches = html.match(/whitespace-pre-wrap break-all/g);
			expect(matches).toBeNull();
		});

		it("stderr area should not use whitespace-pre-wrap with break-all", () => {
			const html = renderToStaticMarkup(
				<BashTool
					command="failing-cmd"
					stderr={longOutput}
					state="output-error"
					exitCode={1}
				/>,
			);

			const matches = html.match(/whitespace-pre-wrap break-all/g);
			expect(matches).toBeNull();
		});

		it("command and output areas should use overflow-x-auto for horizontal scrolling", () => {
			const html = renderToStaticMarkup(
				<BashTool
					command={longCommand}
					stdout={longOutput}
					stderr="some error"
					state="output-error"
					exitCode={1}
				/>,
			);

			// The output container should allow horizontal scrolling
			expect(html).toContain("overflow-x-auto");
		});
	});
});
