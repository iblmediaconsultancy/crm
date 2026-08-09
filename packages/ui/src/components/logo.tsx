import type * as React from "react";

const Logo = (props: React.SVGProps<SVGSVGElement>) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={52}
		height={52}
		viewBox="0 0 52 52"
		fill="none"
		{...props}
		aria-label="IBL Command Center"
	>
		<rect width="52" height="52" rx="10" fill="#3d7ef0" />
		<text x="26" y="31" textAnchor="middle" fill="white" fontSize="15" fontWeight="700">IBL</text>
	</svg>
);
export default Logo;
