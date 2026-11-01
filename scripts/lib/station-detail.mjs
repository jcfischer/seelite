export async function waitForStationDetail(page) {
	await page.waitForFunction(
		() =>
			(window.__seelite.lateDetailSettled?.() ?? true) ||
			window.__seelite.lateDetailFailure?.() !== undefined,
		undefined,
		{ timeout: 60_000 },
	);
	const failure = await page.evaluate(() =>
		window.__seelite.lateDetailFailure?.(),
	);
	if (failure) throw new Error(`Station detail failed to load: ${failure}`);
}
