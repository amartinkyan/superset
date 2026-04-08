"use client";

import { useState } from "react";
import { DownloadButton } from "../DownloadButton";
import { WaitlistModal } from "../WaitlistModal";

export function CTASection() {
	const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);

	return (
		<>
			<section className="relative py-32 px-8 lg:px-[30px]">
				{/* Enchantment glow */}
				<div
					className="absolute inset-0 flex items-center justify-center pointer-events-none"
					aria-hidden="true"
				>
					<div
						className="w-[400px] h-[400px] opacity-20"
						style={{
							background:
								"radial-gradient(circle, #6B3FA0 0%, #502D80 30%, transparent 70%)",
						}}
					/>
				</div>
				<div className="relative max-w-7xl mx-auto flex flex-col items-center text-center">
					<h2
						className="text-[32px] lg:text-[40px] font-normal tracking-normal leading-[1.3em] text-foreground mb-8"
						style={{ fontFamily: "var(--font-geist-pixel-grid)" }}
					>
						Get Superset Today
					</h2>
					<div>
						<DownloadButton onJoinWaitlist={() => setIsWaitlistOpen(true)} />
					</div>
				</div>
			</section>
			<WaitlistModal
				isOpen={isWaitlistOpen}
				onClose={() => setIsWaitlistOpen(false)}
			/>
		</>
	);
}
