import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryWriter, truncateUtf8ToLastBytes } from "./terminal-history";

// We test the debounced write behavior by counting actual disk writes.
// The HistoryWriter should batch multiple write() calls into fewer disk flushes.

let testDir: string;

beforeEach(async () => {
	testDir = await fs.mkdtemp(join(tmpdir(), "terminal-history-test-"));
});

afterEach(async () => {
	await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
});

describe("truncateUtf8ToLastBytes", () => {
	test("returns full string when under limit", () => {
		expect(truncateUtf8ToLastBytes("hello", 100)).toBe("hello");
	});

	test("truncates to last N bytes", () => {
		const result = truncateUtf8ToLastBytes("abcdefgh", 4);
		expect(result).toBe("efgh");
	});

	test("handles multi-byte UTF-8 without breaking", () => {
		// '€' is 3 bytes in UTF-8
		const input = "abc€def";
		const result = truncateUtf8ToLastBytes(input, 6);
		// Should not break the € character
		expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(6);
		expect(result).toBe("€def");
	});

	test("returns empty for zero maxBytes", () => {
		expect(truncateUtf8ToLastBytes("hello", 0)).toBe("");
	});
});

describe("HistoryWriter debounced writes", () => {
	test("multiple rapid writes are batched and eventually flushed to disk", async () => {
		// Monkey-patch the directory resolution to use our temp dir
		const workspaceId = "ws-test";
		const paneId = "pane-test";

		// Create a writer — we need to work around the directory resolution
		// by creating the writer and checking that data is eventually persisted
		const writer = new HistoryWriter(workspaceId, paneId, "/tmp", 80, 24);

		// Override internal paths to use test dir
		const historyDir = join(testDir, workspaceId, paneId);
		await fs.mkdir(historyDir, { recursive: true });

		// Use reflection to set internal paths
		(writer as any).dir = historyDir;
		(writer as any).scrollbackPath = join(historyDir, "scrollback.bin");
		(writer as any).metaPath = join(historyDir, "meta.json");

		await writer.init();

		// Write 100 small chunks rapidly — this simulates terminal output
		for (let i = 0; i < 100; i++) {
			writer.write(`line ${i}\n`);
		}

		// The writes should be buffered, not immediately flushed
		// Wait for the debounce interval to flush
		await new Promise((resolve) => setTimeout(resolve, 3000));

		// Now flush and close
		await writer.flush();
		await writer.close();

		// All data should be present on disk
		const content = await fs.readFile(
			join(historyDir, "scrollback.bin"),
			"utf8",
		);
		for (let i = 0; i < 100; i++) {
			expect(content).toContain(`line ${i}\n`);
		}
	});

	test("flush() forces immediate write of buffered data", async () => {
		const workspaceId = "ws-test";
		const paneId = "pane-flush";
		const writer = new HistoryWriter(workspaceId, paneId, "/tmp", 80, 24);

		const historyDir = join(testDir, workspaceId, paneId);
		await fs.mkdir(historyDir, { recursive: true });

		(writer as any).dir = historyDir;
		(writer as any).scrollbackPath = join(historyDir, "scrollback.bin");
		(writer as any).metaPath = join(historyDir, "meta.json");

		await writer.init();

		writer.write("buffered data\n");
		await writer.flush();

		const content = await fs.readFile(
			join(historyDir, "scrollback.bin"),
			"utf8",
		);
		expect(content).toContain("buffered data\n");

		await writer.close();
	});

	test("close() flushes all remaining buffered data", async () => {
		const workspaceId = "ws-test";
		const paneId = "pane-close";
		const writer = new HistoryWriter(workspaceId, paneId, "/tmp", 80, 24);

		const historyDir = join(testDir, workspaceId, paneId);
		await fs.mkdir(historyDir, { recursive: true });

		(writer as any).dir = historyDir;
		(writer as any).scrollbackPath = join(historyDir, "scrollback.bin");
		(writer as any).metaPath = join(historyDir, "meta.json");

		await writer.init();

		writer.write("data before close\n");
		// Close immediately — should flush the buffer before closing
		await writer.close();

		const content = await fs.readFile(
			join(historyDir, "scrollback.bin"),
			"utf8",
		);
		expect(content).toContain("data before close\n");
	});

	test("respects MAX_HISTORY_BYTES cap", async () => {
		const workspaceId = "ws-test";
		const paneId = "pane-cap";
		const writer = new HistoryWriter(workspaceId, paneId, "/tmp", 80, 24);

		const historyDir = join(testDir, workspaceId, paneId);
		await fs.mkdir(historyDir, { recursive: true });

		(writer as any).dir = historyDir;
		(writer as any).scrollbackPath = join(historyDir, "scrollback.bin");
		(writer as any).metaPath = join(historyDir, "meta.json");

		await writer.init();

		// Write more than 5MB
		const bigChunk = "x".repeat(1024 * 1024); // 1MB
		for (let i = 0; i < 6; i++) {
			writer.write(bigChunk);
		}

		await writer.close();

		const stat = await fs.stat(join(historyDir, "scrollback.bin"));
		// Should be at most 5MB
		expect(stat.size).toBeLessThanOrEqual(5 * 1024 * 1024);
	});

	test("write buffer reduces number of stream.write calls", async () => {
		const workspaceId = "ws-test";
		const paneId = "pane-batch";
		const writer = new HistoryWriter(workspaceId, paneId, "/tmp", 80, 24);

		const historyDir = join(testDir, workspaceId, paneId);
		await fs.mkdir(historyDir, { recursive: true });

		(writer as any).dir = historyDir;
		(writer as any).scrollbackPath = join(historyDir, "scrollback.bin");
		(writer as any).metaPath = join(historyDir, "meta.json");

		await writer.init();

		// Spy on the stream.write calls
		const stream = (writer as any).stream;
		let streamWriteCount = 0;
		const originalWrite = stream.write.bind(stream);
		stream.write = (...args: any[]) => {
			streamWriteCount++;
			return originalWrite(...args);
		};

		// Write 50 small chunks rapidly
		for (let i = 0; i < 50; i++) {
			writer.write(`chunk ${i}\n`);
		}

		// Force flush
		await writer.flush();
		await writer.close();

		// With debouncing, the number of actual stream.write calls should be
		// significantly less than 50. The writes are batched.
		expect(streamWriteCount).toBeLessThan(50);

		// But all data should still be present
		const content = await fs.readFile(
			join(historyDir, "scrollback.bin"),
			"utf8",
		);
		for (let i = 0; i < 50; i++) {
			expect(content).toContain(`chunk ${i}\n`);
		}
	});
});
