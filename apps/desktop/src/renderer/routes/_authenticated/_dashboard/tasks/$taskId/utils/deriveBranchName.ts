import { sanitizeSegment } from "shared/utils/branch";

export function deriveBranchName({
	slug,
	title,
}: {
	slug: string;
	title: string;
}): string {
	const prefix = slug;
	const titleSegment = sanitizeSegment(title, 40);
	return titleSegment ? `${prefix}-${titleSegment}` : prefix;
}
