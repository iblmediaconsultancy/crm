"use client";

import {
	createContext,
	type RefObject,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

type MobileNavContextValue = {
	open: boolean;
	setOpen: (open: boolean) => void;
	triggerRef: RefObject<HTMLButtonElement | null>;
};

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const value = useMemo(() => ({ open, setOpen, triggerRef }), [open]);
	return (
		<MobileNavContext.Provider value={value}>
			{children}
		</MobileNavContext.Provider>
	);
}

export function useMobileNav(): MobileNavContextValue {
	const context = useContext(MobileNavContext);
	if (!context) {
		throw new Error("useMobileNav must be used within a MobileNavProvider");
	}
	return context;
}
