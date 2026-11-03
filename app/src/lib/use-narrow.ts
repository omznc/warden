import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)";

// True below 640 px. The server renders the wide layout. The browser switches after it hydrates.
export function useNarrow(): boolean {
	return useSyncExternalStore(
		(cb) => {
			const m = window.matchMedia(QUERY);
			m.addEventListener("change", cb);
			return () => m.removeEventListener("change", cb);
		},
		() => window.matchMedia(QUERY).matches,
		() => false,
	);
}
