import { pidAlive } from "./probe-lock.mjs";

const [parentPid, pgid, pollMs] = process.argv.slice(2).map(Number);

const groupAlive = () => pidAlive(-pgid);

const timer = setInterval(() => {
	if (!groupAlive()) {
		clearInterval(timer);
		return;
	}
	if (pidAlive(parentPid)) return;
	clearInterval(timer);
	try {
		process.kill(-pgid, "SIGKILL");
	} catch (error) {
		process.stderr.write(
			`[browser-watchdog] could not kill browser group ${pgid}: ${error}\n`,
		);
	}
}, pollMs);
