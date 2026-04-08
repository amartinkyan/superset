"use client";

import { motion } from "framer-motion";

interface SelectorPillProps {
	label: string;
	active?: boolean;
	onSelect?: () => void;
}

export function SelectorPill({
	label,
	active = false,
	onSelect,
}: SelectorPillProps) {
	return (
		<motion.button
			type="button"
			onMouseEnter={onSelect}
			onClick={onSelect}
			className={`
				inline-flex items-center justify-center py-2 text-xs sm:text-sm whitespace-nowrap cursor-pointer shrink-0
				${
					active
						? "bg-[#4A3525] border-2 text-[#FCDC5F]"
						: "bg-[#3D2817] border-2 text-foreground/50 hover:bg-[#4A3525] hover:text-foreground/70"
				}
			`}
			style={{
				fontFamily: "var(--font-geist-pixel-square)",
				borderColor: active
					? "#FCDC5F #8B6542 #8B6542 #FCDC5F"
					: "#6B4D30 #2C1A0E #2C1A0E #6B4D30",
			}}
			animate={{
				paddingLeft: active ? 18 : 12,
				paddingRight: active ? 18 : 12,
			}}
			transition={{ duration: 0.2, ease: "easeOut" }}
		>
			{label}
		</motion.button>
	);
}
