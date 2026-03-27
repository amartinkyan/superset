import { describe, expect, it } from "bun:test";
import { parsePssFromSmapsContent } from "./index";

/**
 * Sample content from `/proc/<pid>/smaps_rollup` on a real Linux system.
 * The exact set of fields varies by kernel version; what matters is that
 * we can reliably extract the `Pss:` line.
 */
const SAMPLE_SMAPS_ROLLUP = `00400000-7ffd5c1fe000 ---p 00000000 00:00 0                              [rollup]
Rss:              123456 kB
Pss:               98765 kB
Pss_Anon:          54321 kB
Pss_File:          44444 kB
Pss_Shmem:             0 kB
Shared_Clean:      12345 kB
Shared_Dirty:          0 kB
Private_Clean:     67890 kB
Private_Dirty:     11111 kB
Referenced:       100000 kB
Anonymous:         54321 kB
LazyFree:              0 kB
AnonHugePages:         0 kB
ShmemPmdMapped:        0 kB
FilePmdMapped:         0 kB
Shared_Hugetlb:        0 kB
Private_Hugetlb:       0 kB
Swap:                  0 kB
SwapPss:               0 kB
Locked:                0 kB
`;

describe("parsePssFromSmapsContent", () => {
	it("extracts PSS and converts kB to bytes", () => {
		const result = parsePssFromSmapsContent(SAMPLE_SMAPS_ROLLUP);
		// 98765 kB × 1024 = 101,135,360 bytes
		expect(result).toBe(98765 * 1024);
	});

	it("returns null for empty content", () => {
		expect(parsePssFromSmapsContent("")).toBeNull();
	});

	it("returns null when Pss line is missing", () => {
		const content = `Rss:  12345 kB
Shared_Clean: 100 kB
`;
		expect(parsePssFromSmapsContent(content)).toBeNull();
	});

	it("handles zero PSS", () => {
		const content = `Pss:                   0 kB
`;
		expect(parsePssFromSmapsContent(content)).toBe(0);
	});

	it("handles large PSS values", () => {
		// 16 GB in kB
		const content = `Pss:            16777216 kB
`;
		expect(parsePssFromSmapsContent(content)).toBe(16777216 * 1024);
	});
});
