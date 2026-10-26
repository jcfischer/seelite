import { afterAll } from "bun:test";
import { installShippedInterceptorHull } from "../../scripts/lib/shipped-interceptor-hull";
import { authoredHullBuilder, installAuthoredHull } from "../../src/ship-mesh";

export async function useShippedInterceptorHull(): Promise<void> {
	const previous = authoredHullBuilder("interceptor");
	await installShippedInterceptorHull();
	afterAll(() => installAuthoredHull("interceptor", previous));
}
