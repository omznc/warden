import { createStart } from "@tanstack/react-start";
import { authMiddleware, requestGuard } from "@/server/middleware";

export const startInstance = createStart(() => ({
	requestMiddleware: [requestGuard],
	functionMiddleware: [authMiddleware],
}));
