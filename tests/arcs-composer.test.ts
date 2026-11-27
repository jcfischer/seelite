import { describe, expect, test } from "bun:test";
import {
	ARC_MAX_STEPS,
	ARC_MIN_STEPS,
	type Arc,
	type ArcWorld,
	HEALING_HOME,
	flownLyOf,
	nextStep,
	openArc,
	recordStep,
	refuseStep,
	systemsOf,
} from "../src/arcs";
import { carrierKey, systemIndexOfKey } from "../src/carrier-key";
import { type DeficitMap, recordTrade } from "../src/deficits";
import { generateGalaxy, type SystemRecord } from "../src/galaxy";
import { HULL_SPECS, PLAYER_BASELINE_HULL } from "../src/hull";
import { canPostJobs } from "../src/jobs";
import { bountyTargetOf } from "../src/pirate-relay";
import { type Station, generateContents } from "../src/system";
import { newWorld } from "../src/world-state";

const BASE = 0x5ee11e;
const JUMP = HULL_SPECS[PLAYER_BASELINE_HULL].tankLy;
const HOLD = HULL_SPECS[PLAYER_BASELINE_HULL].holdT;

/** The world `scripts/measure-arcs.ts` sweeps: a generated galaxy, a relay
 *  environment and the baseline hull's reach and hold. */
const sweepWorld = (seed: number, deficits: DeficitMap = {}): ArcWorld => {
	const galaxy = generateGalaxy(seed, 0);
	const env = newWorld(seed).galaxies[0];
	return {
		galaxyIndex: 0,
		systems: galaxy.systems,
		contentsOf: generateContents,
		deficits,
		gameTimeMin: 0,
		maxJump: JUMP,
		holdT: HOLD,
		bountyTargetOf: (record) =>
			bountyTargetOf(record, generateContents(record), env, 0),
	};
};

const seededWorld = (seed: number) => {
	const record = generateGalaxy(seed, 0).systems[
		(seed - BASE) % generateGalaxy(seed, 0).systems.length
	];
	const station = generateContents(record).stations.find(canPostJobs)!;
	const key = carrierKey(record.index, station.localCarrierId);
	const deficits = recordTrade({}, key, {
		goodName: "Food",
		units: 12,
		gameTimeMin: 0,
		holdT: 20,
	});
	return { record, station, key, world: sweepWorld(seed, deficits) };
};

const stepText = (step: {
	offer: {
		id: string;
		family: string;
		requester: { carrierKey: string };
		reportAt: { carrierKey: string };
		rewardCr: number;
	};
	flownLy: number;
	rerouted: boolean;
}): string =>
	`step|${step.offer.id}|${step.offer.family}|${step.offer.requester.carrierKey}|${step.offer.reportAt.carrierKey}|${step.offer.rewardCr}|${step.flownLy.toFixed(4)}|${step.rerouted}`;

const nextText = (arc: Arc, world: ArcWorld): string => {
	const next = nextStep(arc, world);
	if (next.kind === "step") return stepText(next);
	if (next.kind === "answer") return `answer|${next.bonusCr}|${next.text}`;
	return `none|${next.reason}`;
};

/** One seeded world's whole life: the opening, every step, the outcome, and
 *  what `nextStep` says at each point against the *unstocked* world (the
 *  drift arm). Regenerate the expectation by running the same walk. */
export const playLine = (seed: number): string => {
	const { record, station, world } = seededWorld(seed);
	const opening = openArc(world, record, station);
	if (!opening.ok) return `${seed}|refused|${opening.reason}`;
	let arc = opening.arc;
	const steps: string[] = [];
	const drift: string[] = [];
	for (let guard = 0; guard < 8; guard++) {
		drift.push(nextText(arc, sweepWorld(seed)));
		const next = nextStep(arc, world);
		if (next.kind !== "step") {
			steps.push(
				next.kind === "answer"
					? `answer|${next.bonusCr}|${next.text}`
					: `none|${next.reason}`,
			);
			break;
		}
		steps.push(stepText(next));
		arc = recordStep(arc, next);
	}
	const openingText = `${arc.kind}|${arc.question}|${arc.requester.carrierKey}|${arc.requesterName}|${arc.answerFamily}|${arc.answerPayoutCr}|${arc.foreseen.join(",")}`;
	const families = [...new Set(arc.taken.map((s) => s.family))].sort().join("+");
	return `${seed}|opened|${openingText}|${steps.join(";")}|${families}|${systemsOf(arc.taken).size}|${flownLyOf(arc).toFixed(4)}|drift:${drift.join(";")}`;
};

/** The seeds `scripts/measure-arcs.ts` sweeps, pinned. They are the D10
 *  evidence: both question kinds, arcs of three, four and five steps, and the
 *  worlds where no route answers the question. */
const SWEPT_SEEDS = [
	6218014, 6218016, 6218017, 6218018, 6218020, 6218022, 6218025, 6218027,
	6218030, 6218033, 6218037, 6218040, 6218042, 6218045, 6218047, 6218050,
	6218053, 6218058, 6218064, 6218069, 6218158, 6218164, 6218184, 6218209,
	6218078, 6218086, 6218101,
];

const GOLDEN = [
	"6218014|opened|unexplained-shortage|Why is ORANREAR short of Food?|0:station-trade|ORANREAR|procurement|430|request-v1/0/0/station-refinery/bounty-1,request-v1/0/55/station-refinery/bounty-1,request-v1/0/0/station-trade/procurement-1|step|request-v1/0/0/station-refinery/bounty-1|bounty|0:station-refinery|0:station-refinery|400|0.0000|false;step|request-v1/0/55/station-refinery/bounty-1|bounty|55:station-refinery|55:station-refinery|400|6.0885|false;step|request-v1/0/0/station-trade/procurement-1|procurement|0:station-trade|0:station-trade|52|6.0885|false;answer|430|Answered: Why is ORANREAR short of Food?|bounty+procurement|2|12.1771|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|430|Answered: Why is ORANREAR short of Food?",
	"6218016|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of INCETEUS?|2:station-trade|BIRIATVE|bounty|500|request-v1/0/178/station-trade/bounty-1,request-v1/0/183/station-refinery/courier-1,request-v1/0/2/station-trade/bounty-1|step|request-v1/0/178/station-trade/bounty-1|bounty|178:station-trade|178:station-trade|400|3.9360|false;step|request-v1/0/183/station-refinery/courier-1|courier|183:station-refinery|183:station-trade|197|3.6366|false;step|request-v1/0/2/station-trade/bounty-1|bounty|2:station-trade|2:station-trade|400|5.0517|false;answer|500|Answered: Who is sending raiders down the cruise lanes out of INCETEUS?|bounty+courier|3|12.6244|drift:step|request-v1/0/178/station-trade/bounty-1|bounty|178:station-trade|178:station-trade|400|3.9360|false;step|request-v1/0/183/station-refinery/courier-1|courier|183:station-refinery|183:station-trade|197|3.6366|false;step|request-v1/0/2/station-trade/bounty-1|bounty|2:station-trade|2:station-trade|400|5.0517|false;answer|500|Answered: Who is sending raiders down the cruise lanes out of INCETEUS?",
	"6218017|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of ERENZA?|3:station-trade|ANDI|bounty|500|request-v1/0/3/station-refinery/courier-1,request-v1/0/254/station-shipyard/bounty-1,request-v1/0/3/station-trade/bounty-1|step|request-v1/0/3/station-refinery/courier-1|courier|3:station-refinery|3:station-trade|197|0.0000|false;step|request-v1/0/254/station-shipyard/bounty-1|bounty|254:station-shipyard|254:station-shipyard|400|4.4207|false;step|request-v1/0/3/station-trade/bounty-1|bounty|3:station-trade|3:station-trade|400|4.4207|false;answer|500|Answered: Who is sending raiders down the cruise lanes out of ERENZA?|bounty+courier|2|8.8414|drift:step|request-v1/0/3/station-refinery/courier-1|courier|3:station-refinery|3:station-trade|197|0.0000|false;step|request-v1/0/254/station-shipyard/bounty-1|bounty|254:station-shipyard|254:station-shipyard|400|4.4207|false;step|request-v1/0/3/station-trade/bounty-1|bounty|3:station-trade|3:station-trade|400|4.4207|false;answer|500|Answered: Who is sending raiders down the cruise lanes out of ERENZA?",
	"6218018|opened|unexplained-shortage|Why is RIZA short of Food?|4:station-trade|RIZA|procurement|310|request-v1/0/183/station-trade/bounty-1,request-v1/0/207/station-trade/courier-1,request-v1/0/4/station-trade/procurement-1|step|request-v1/0/183/station-trade/bounty-1|bounty|183:station-trade|183:station-trade|400|3.8889|false;step|request-v1/0/207/station-trade/courier-1|courier|207:station-trade|207:station-shipyard|112|4.0440|false;step|request-v1/0/4/station-trade/procurement-1|procurement|4:station-trade|4:station-trade|106|6.1906|false;answer|310|Answered: Why is RIZA short of Food?|bounty+courier+procurement|3|14.1234|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|310|Answered: Why is RIZA short of Food?",
	"6218020|opened|unexplained-shortage|Why is ANISESCE short of Food?|6:station-trade|ANISESCE|procurement|450|request-v1/0/234/station-trade/bounty-1,request-v1/0/113/station-shipyard/bounty-1,request-v1/0/6/station-trade/procurement-1|step|request-v1/0/234/station-trade/bounty-1|bounty|234:station-trade|234:station-trade|400|1.0366|false;step|request-v1/0/113/station-shipyard/bounty-1|bounty|113:station-shipyard|113:station-shipyard|400|3.5958|false;step|request-v1/0/6/station-trade/procurement-1|procurement|6:station-trade|6:station-trade|106|2.5712|false;answer|450|Answered: Why is ANISESCE short of Food?|bounty+procurement|3|7.2036|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|450|Answered: Why is ANISESCE short of Food?",
	"6218022|opened|unexplained-shortage|Why is ENTEIS short of Food?|8:station-trade|ENTEIS|procurement|430|request-v1/0/160/station-refinery/bounty-1,request-v1/0/160/station-trade/bounty-1,request-v1/0/8/station-trade/procurement-1|step|request-v1/0/160/station-refinery/bounty-1|bounty|160:station-refinery|160:station-refinery|400|2.8257|false;step|request-v1/0/160/station-trade/bounty-1|bounty|160:station-trade|160:station-trade|400|0.0000|false;step|request-v1/0/8/station-trade/procurement-1|procurement|8:station-trade|8:station-trade|52|2.8257|false;answer|430|Answered: Why is ENTEIS short of Food?|bounty+procurement|2|5.6514|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|430|Answered: Why is ENTEIS short of Food?",
	"6218025|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of INCEANRA?|11:station-trade|SOCEED|bounty|470|request-v1/0/137/station-trade/bounty-1,request-v1/0/117/station-refinery/courier-1,request-v1/0/11/station-trade/bounty-1|step|request-v1/0/137/station-trade/bounty-1|bounty|137:station-trade|137:station-trade|400|5.5835|false;step|request-v1/0/117/station-refinery/courier-1|courier|117:station-refinery|137:station-trade|149|5.2753|false;step|request-v1/0/11/station-trade/bounty-1|bounty|11:station-trade|11:station-trade|400|5.5835|false;answer|470|Answered: Who is sending raiders down the cruise lanes out of INCEANRA?|bounty+courier|3|16.4423|drift:step|request-v1/0/137/station-trade/bounty-1|bounty|137:station-trade|137:station-trade|400|5.5835|false;step|request-v1/0/117/station-refinery/courier-1|courier|117:station-refinery|137:station-trade|149|5.2753|false;step|request-v1/0/11/station-trade/bounty-1|bounty|11:station-trade|11:station-trade|400|5.5835|false;answer|470|Answered: Who is sending raiders down the cruise lanes out of INCEANRA?",
	"6218027|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of MAARRI?|13:station-trade|LADIVE|bounty|390|request-v1/0/81/station-trade/courier-1,request-v1/0/81/station-refinery/courier-1,request-v1/0/13/station-trade/bounty-1|step|request-v1/0/81/station-trade/courier-1|courier|81:station-trade|81:station-refinery|112|4.4095|false;step|request-v1/0/81/station-refinery/courier-1|courier|81:station-refinery|242:station-trade|259|3.4173|false;step|request-v1/0/13/station-trade/bounty-1|bounty|13:station-trade|13:station-trade|400|5.7093|false;answer|390|Answered: Who is sending raiders down the cruise lanes out of MAARRI?|bounty+courier|3|13.5361|drift:step|request-v1/0/81/station-trade/courier-1|courier|81:station-trade|81:station-refinery|112|4.4095|false;step|request-v1/0/81/station-refinery/courier-1|courier|81:station-refinery|242:station-trade|259|3.4173|false;step|request-v1/0/13/station-trade/bounty-1|bounty|13:station-trade|13:station-trade|400|5.7093|false;answer|390|Answered: Who is sending raiders down the cruise lanes out of MAARRI?",
	"6218030|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of RIONXEGE?|16:station-trade|RAEDQU|bounty|360|request-v1/0/16/station-trade/procurement-1,request-v1/0/84/station-refinery/courier-1,request-v1/0/16/station-refinery/bounty-1|step|request-v1/0/16/station-trade/procurement-1|procurement|16:station-trade|16:station-trade|63|0.0000|false;step|request-v1/0/84/station-refinery/courier-1|courier|84:station-refinery|16:station-refinery|250|5.9350|false;step|request-v1/0/16/station-refinery/bounty-1|bounty|16:station-refinery|16:station-refinery|400|0.0000|false;answer|360|Answered: Who is sending raiders down the cruise lanes out of RIONXEGE?|bounty+courier+procurement|2|5.9350|drift:step|request-v1/0/16/station-refinery/courier-1|courier|16:station-refinery|148:station-trade|191|5.6730|true;step|request-v1/0/84/station-refinery/courier-1|courier|84:station-refinery|16:station-refinery|250|5.9350|false;step|request-v1/0/16/station-refinery/bounty-1|bounty|16:station-refinery|16:station-refinery|400|0.0000|false;answer|360|Answered: Who is sending raiders down the cruise lanes out of RIONXEGE?",
	"6218033|opened|unexplained-shortage|Why is ENARRI short of Food?|19:station-trade|ENARRI|procurement|360|request-v1/0/19/station-refinery/courier-1,request-v1/0/198/station-trade/bounty-1,request-v1/0/19/station-trade/procurement-1|step|request-v1/0/19/station-refinery/courier-1|courier|19:station-refinery|157:station-trade|219|1.2284|false;step|request-v1/0/198/station-trade/bounty-1|bounty|198:station-trade|198:station-trade|400|3.3165|false;step|request-v1/0/19/station-trade/procurement-1|procurement|19:station-trade|19:station-trade|106|4.3475|false;answer|360|Answered: Why is ENARRI short of Food?|bounty+courier+procurement|3|8.8924|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|360|Answered: Why is ENARRI short of Food?",
	"6218037|opened|unexplained-shortage|Why is SOONRIVE short of Food?|23:station-trade|SOONRIVE|procurement|450|request-v1/0/237/station-trade/bounty-1,request-v1/0/226/station-refinery/bounty-1,request-v1/0/23/station-trade/procurement-1|step|request-v1/0/237/station-trade/bounty-1|bounty|237:station-trade|237:station-trade|400|3.4387|false;step|request-v1/0/226/station-refinery/bounty-1|bounty|226:station-refinery|226:station-refinery|400|0.7982|false;step|request-v1/0/23/station-trade/procurement-1|procurement|23:station-trade|23:station-trade|106|4.1715|false;answer|450|Answered: Why is SOONRIVE short of Food?|bounty+procurement|3|8.4084|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|450|Answered: Why is SOONRIVE short of Food?",
	"6218040|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of EDCETEBE?|26:station-trade|BEBEER|bounty|520|request-v1/0/16/station-trade/bounty-1,request-v1/0/218/station-trade/courier-1,request-v1/0/26/station-trade/bounty-1|step|request-v1/0/16/station-trade/bounty-1|bounty|16:station-trade|16:station-trade|400|2.0353|false;step|request-v1/0/218/station-trade/courier-1|courier|218:station-trade|16:station-trade|243|5.1305|false;step|request-v1/0/26/station-trade/bounty-1|bounty|26:station-trade|26:station-trade|400|2.0353|false;answer|520|Answered: Who is sending raiders down the cruise lanes out of EDCETEBE?|bounty+courier|3|9.2011|drift:step|request-v1/0/16/station-trade/bounty-1|bounty|16:station-trade|16:station-trade|400|2.0353|false;step|request-v1/0/218/station-trade/courier-1|courier|218:station-trade|16:station-trade|243|5.1305|false;step|request-v1/0/26/station-trade/bounty-1|bounty|26:station-trade|26:station-trade|400|2.0353|false;answer|520|Answered: Who is sending raiders down the cruise lanes out of EDCETEBE?",
	"6218042|opened|unexplained-shortage|Why is BEBEMABE short of Food?|28:station-trade|BEBEMABE|procurement|430|request-v1/0/17/station-trade/bounty-1,request-v1/0/122/station-trade/bounty-1,request-v1/0/28/station-trade/procurement-1|step|request-v1/0/17/station-trade/bounty-1|bounty|17:station-trade|17:station-trade|400|2.6288|false;step|request-v1/0/122/station-trade/bounty-1|bounty|122:station-trade|122:station-trade|400|4.7465|false;step|request-v1/0/28/station-trade/procurement-1|procurement|28:station-trade|28:station-trade|52|3.4184|false;answer|430|Answered: Why is BEBEMABE short of Food?|bounty+procurement|3|10.7937|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|430|Answered: Why is BEBEMABE short of Food?",
	"6218045|opened|unexplained-shortage|Why is USEDTIDI short of Food?|31:station-trade|USEDTIDI|procurement|170|request-v1/0/229/station-shipyard/courier-1,request-v1/0/229/station-trade/courier-1,request-v1/0/31/station-trade/procurement-1|step|request-v1/0/229/station-shipyard/courier-1|courier|229:station-shipyard|229:station-trade|112|5.8115|false;step|request-v1/0/229/station-trade/courier-1|courier|229:station-trade|179:station-trade|149|2.6277|false;step|request-v1/0/31/station-trade/procurement-1|procurement|31:station-trade|31:station-trade|74|5.9855|false;answer|170|Answered: Why is USEDTIDI short of Food?|courier+procurement|3|14.4246|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|170|Answered: Why is USEDTIDI short of Food?",
	"6218047|opened|unexplained-shortage|Why is ATZALE short of Food?|33:station-trade|ATZALE|procurement|330|request-v1/0/20/station-trade/bounty-1,request-v1/0/211/station-trade/courier-1,request-v1/0/33/station-trade/procurement-1|step|request-v1/0/20/station-trade/bounty-1|bounty|20:station-trade|20:station-trade|400|4.1601|false;step|request-v1/0/211/station-trade/courier-1|courier|211:station-trade|20:station-trade|205|13.2179|false;step|request-v1/0/33/station-trade/procurement-1|procurement|33:station-trade|33:station-trade|52|4.1601|false;answer|330|Answered: Why is ATZALE short of Food?|bounty+courier+procurement|3|21.5381|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|330|Answered: Why is ATZALE short of Food?",
	"6218050|opened|unexplained-shortage|Why is REREATSO short of Food?|36:station-trade|REREATSO|procurement|430|request-v1/0/113/station-trade/bounty-1,request-v1/0/170/station-refinery/bounty-1,request-v1/0/36/station-trade/procurement-1|step|request-v1/0/113/station-trade/bounty-1|bounty|113:station-trade|113:station-trade|400|4.9245|false;step|request-v1/0/170/station-refinery/bounty-1|bounty|170:station-refinery|170:station-refinery|400|4.5624|false;step|request-v1/0/36/station-trade/procurement-1|procurement|36:station-trade|36:station-trade|63|5.2473|false;answer|430|Answered: Why is REREATSO short of Food?|bounty+procurement|3|14.7342|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|430|Answered: Why is REREATSO short of Food?",
	"6218053|opened|unexplained-shortage|Why is MAZAGEED short of Food?|39:station-trade|MAZAGEED|procurement|440|request-v1/0/233/station-refinery/bounty-1,request-v1/0/233/station-trade/bounty-1,request-v1/0/39/station-trade/procurement-1|step|request-v1/0/233/station-refinery/bounty-1|bounty|233:station-refinery|233:station-refinery|400|4.5804|false;step|request-v1/0/233/station-trade/bounty-1|bounty|233:station-trade|233:station-trade|400|0.0000|false;step|request-v1/0/39/station-trade/procurement-1|procurement|39:station-trade|39:station-trade|84|4.5804|false;answer|440|Answered: Why is MAZAGEED short of Food?|bounty+procurement|2|9.1608|drift:none|no route reaches the answer from here;none|no route reaches the answer from here;none|no route reaches the answer from here;answer|440|Answered: Why is MAZAGEED short of Food?",
	"6218058|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of ATBETE?|44:station-trade|LAXEIN|bounty|670|request-v1/0/160/station-trade/bounty-1,request-v1/0/29/station-refinery/bounty-1,request-v1/0/29/station-trade/courier-1,request-v1/0/44/station-trade/bounty-1|step|request-v1/0/160/station-trade/bounty-1|bounty|160:station-trade|160:station-trade|400|6.4450|false;step|request-v1/0/29/station-refinery/bounty-1|bounty|29:station-refinery|29:station-refinery|400|1.4399|false;step|request-v1/0/29/station-trade/courier-1|courier|29:station-trade|27:station-refinery|144|2.2899|false;step|request-v1/0/44/station-trade/bounty-1|bounty|44:station-trade|44:station-trade|400|6.7541|false;answer|670|Answered: Who is sending raiders down the cruise lanes out of ATBETE?|bounty+courier|4|16.9289|drift:step|request-v1/0/160/station-trade/bounty-1|bounty|160:station-trade|160:station-trade|400|6.4450|false;step|request-v1/0/29/station-refinery/bounty-1|bounty|29:station-refinery|29:station-refinery|400|1.4399|false;step|request-v1/0/29/station-trade/courier-1|courier|29:station-trade|27:station-refinery|144|2.2899|false;step|request-v1/0/44/station-trade/bounty-1|bounty|44:station-trade|44:station-trade|400|6.7541|false;answer|670|Answered: Who is sending raiders down the cruise lanes out of ATBETE?",
	"6218064|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of EDTIENUS?|50:station-trade|BELELAVE|bounty|880|request-v1/0/21/station-refinery/bounty-1,request-v1/0/21/station-shipyard/bounty-1,request-v1/0/212/station-shipyard/bounty-1,request-v1/0/212/station-trade/courier-1,request-v1/0/50/station-trade/bounty-1|step|request-v1/0/21/station-refinery/bounty-1|bounty|21:station-refinery|21:station-refinery|400|4.4262|false;step|request-v1/0/21/station-shipyard/bounty-1|bounty|21:station-shipyard|21:station-shipyard|400|0.0000|false;step|request-v1/0/212/station-shipyard/bounty-1|bounty|212:station-shipyard|212:station-shipyard|400|3.5668|false;step|request-v1/0/212/station-trade/courier-1|courier|212:station-trade|21:station-shipyard|162|3.5668|false;step|request-v1/0/50/station-trade/bounty-1|bounty|50:station-trade|50:station-trade|400|4.4262|false;answer|880|Answered: Who is sending raiders down the cruise lanes out of EDTIENUS?|bounty+courier|3|15.9859|drift:step|request-v1/0/152/station-trade/bounty-1|bounty|152:station-trade|152:station-trade|400|4.6375|true;step|request-v1/0/21/station-shipyard/bounty-1|bounty|21:station-shipyard|21:station-shipyard|400|0.0000|false;step|request-v1/0/212/station-shipyard/bounty-1|bounty|212:station-shipyard|212:station-shipyard|400|3.5668|false;step|request-v1/0/212/station-trade/courier-1|courier|212:station-trade|21:station-shipyard|162|3.5668|false;step|request-v1/0/50/station-trade/bounty-1|bounty|50:station-trade|50:station-trade|400|4.4262|false;answer|880|Answered: Who is sending raiders down the cruise lanes out of EDTIENUS?",
	"6218069|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of CEREZA?|55:station-trade|LABEED|bounty|930|request-v1/0/176/station-refinery/bounty-1,request-v1/0/107/station-trade/bounty-1,request-v1/0/176/station-shipyard/bounty-1,request-v1/0/176/station-trade/courier-1,request-v1/0/55/station-trade/bounty-1|step|request-v1/0/176/station-refinery/bounty-1|bounty|176:station-refinery|176:station-refinery|400|2.0919|false;step|request-v1/0/107/station-trade/bounty-1|bounty|107:station-trade|107:station-trade|400|2.3210|false;step|request-v1/0/176/station-shipyard/bounty-1|bounty|176:station-shipyard|176:station-shipyard|400|2.3210|false;step|request-v1/0/176/station-trade/courier-1|courier|176:station-trade|156:station-trade|260|3.4925|false;step|request-v1/0/55/station-trade/bounty-1|bounty|55:station-trade|55:station-trade|400|3.1417|false;answer|930|Answered: Who is sending raiders down the cruise lanes out of CEREZA?|bounty+courier|4|13.3680|drift:step|request-v1/0/176/station-refinery/bounty-1|bounty|176:station-refinery|176:station-refinery|400|2.0919|false;step|request-v1/0/176/station-shipyard/bounty-1|bounty|176:station-shipyard|176:station-shipyard|400|0.0000|true;step|request-v1/0/176/station-shipyard/bounty-1|bounty|176:station-shipyard|176:station-shipyard|400|2.3210|false;step|request-v1/0/176/station-trade/courier-1|courier|176:station-trade|156:station-trade|260|3.4925|false;step|request-v1/0/55/station-trade/bounty-1|bounty|55:station-trade|55:station-trade|400|3.1417|false;answer|930|Answered: Who is sending raiders down the cruise lanes out of CEREZA?",
	"6218158|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of TEVE?|144:station-trade|INABEER|bounty|700|request-v1/0/73/station-refinery/bounty-1,request-v1/0/200/station-refinery/courier-1,request-v1/0/73/station-trade/bounty-1,request-v1/0/144/station-trade/bounty-1|step|request-v1/0/73/station-refinery/bounty-1|bounty|73:station-refinery|73:station-refinery|400|6.6666|false;step|request-v1/0/200/station-refinery/courier-1|courier|200:station-refinery|200:station-trade|197|3.5996|false;step|request-v1/0/73/station-trade/bounty-1|bounty|73:station-trade|73:station-trade|400|3.5996|false;step|request-v1/0/144/station-trade/bounty-1|bounty|144:station-trade|144:station-trade|400|6.6666|false;answer|700|Answered: Who is sending raiders down the cruise lanes out of TEVE?|bounty+courier|3|20.5324|drift:step|request-v1/0/73/station-refinery/bounty-1|bounty|73:station-refinery|73:station-refinery|400|6.6666|false;step|request-v1/0/200/station-refinery/courier-1|courier|200:station-refinery|200:station-trade|197|3.5996|false;step|request-v1/0/73/station-trade/bounty-1|bounty|73:station-trade|73:station-trade|400|3.5996|false;step|request-v1/0/144/station-trade/bounty-1|bounty|144:station-trade|144:station-trade|400|6.6666|false;answer|700|Answered: Who is sending raiders down the cruise lanes out of TEVE?",
	"6218164|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of INXEXE?|150:station-trade|MAXELE|bounty|680|request-v1/0/59/station-trade/bounty-1,request-v1/0/104/station-trade/bounty-1,request-v1/0/149/station-trade/courier-1,request-v1/0/150/station-trade/bounty-1|step|request-v1/0/59/station-trade/bounty-1|bounty|59:station-trade|59:station-trade|400|4.0803|false;step|request-v1/0/104/station-trade/bounty-1|bounty|104:station-trade|104:station-trade|400|2.3031|false;step|request-v1/0/149/station-trade/courier-1|courier|149:station-trade|104:station-trade|159|6.7116|false;step|request-v1/0/150/station-trade/bounty-1|bounty|150:station-trade|150:station-trade|400|6.3675|false;answer|680|Answered: Who is sending raiders down the cruise lanes out of INXEXE?|bounty+courier|4|19.4626|drift:step|request-v1/0/104/station-trade/bounty-1|bounty|104:station-trade|104:station-trade|400|6.3675|true;step|request-v1/0/104/station-trade/bounty-1|bounty|104:station-trade|104:station-trade|400|2.3031|false;step|request-v1/0/149/station-trade/courier-1|courier|149:station-trade|104:station-trade|159|6.7116|false;step|request-v1/0/150/station-trade/bounty-1|bounty|150:station-trade|150:station-trade|400|6.3675|false;answer|680|Answered: Who is sending raiders down the cruise lanes out of INXEXE?",
	"6218184|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of EREN?|170:station-trade|MAESRE|bounty|750|request-v1/0/134/station-trade/bounty-1,request-v1/0/36/station-trade/bounty-1,request-v1/0/125/station-trade/courier-1,request-v1/0/170/station-trade/bounty-1|step|request-v1/0/134/station-trade/bounty-1|bounty|134:station-trade|134:station-trade|400|3.1454|false;step|request-v1/0/36/station-trade/bounty-1|bounty|36:station-trade|36:station-trade|400|5.4684|false;step|request-v1/0/125/station-trade/courier-1|courier|125:station-trade|191:station-shipyard|291|11.9765|false;step|request-v1/0/170/station-trade/bounty-1|bounty|170:station-trade|170:station-trade|400|5.4987|false;answer|750|Answered: Who is sending raiders down the cruise lanes out of EREN?|bounty+courier|5|26.0890|drift:step|request-v1/0/134/station-trade/bounty-1|bounty|134:station-trade|134:station-trade|400|3.1454|false;step|request-v1/0/36/station-trade/bounty-1|bounty|36:station-trade|36:station-trade|400|5.4684|false;step|request-v1/0/125/station-trade/courier-1|courier|125:station-trade|191:station-shipyard|291|11.9765|false;step|request-v1/0/170/station-trade/bounty-1|bounty|170:station-trade|170:station-trade|400|5.4987|false;answer|750|Answered: Who is sending raiders down the cruise lanes out of EREN?",
	"6218209|opened|raiders-on-route|Who is sending raiders down the cruise lanes out of RIANLE?|195:station-trade|QUERSOUS|bounty|700|request-v1/0/24/station-trade/bounty-1,request-v1/0/167/station-trade/courier-1,request-v1/0/61/station-trade/bounty-1,request-v1/0/195/station-trade/bounty-1|step|request-v1/0/24/station-trade/bounty-1|bounty|24:station-trade|24:station-trade|400|6.4199|false;step|request-v1/0/167/station-trade/courier-1|courier|167:station-trade|167:station-refinery|197|4.2002|false;step|request-v1/0/61/station-trade/bounty-1|bounty|61:station-trade|61:station-trade|400|6.7917|false;step|request-v1/0/195/station-trade/bounty-1|bounty|195:station-trade|195:station-trade|400|3.0617|false;answer|700|Answered: Who is sending raiders down the cruise lanes out of RIANLE?|bounty+courier|4|20.4735|drift:step|request-v1/0/24/station-trade/bounty-1|bounty|24:station-trade|24:station-trade|400|6.4199|false;step|request-v1/0/167/station-trade/courier-1|courier|167:station-trade|167:station-refinery|197|4.2002|false;step|request-v1/0/61/station-trade/bounty-1|bounty|61:station-trade|61:station-trade|400|6.7917|false;step|request-v1/0/195/station-trade/bounty-1|bounty|195:station-trade|195:station-trade|400|3.0617|false;answer|700|Answered: Who is sending raiders down the cruise lanes out of RIANLE?",
	"6218078|refused|no route of 3-6 steps answers unexplained-shortage; no route of 3-6 steps answers raiders-on-route",
	"6218086|refused|no route of 3-6 steps answers unexplained-shortage; no route of 3-6 steps answers raiders-on-route",
	"6218101|refused|no route of 3-6 steps answers unexplained-shortage; no route of 3-6 steps answers raiders-on-route",
];

describe("the pinned sweep", () => {
	test("every seeded world plays out exactly as measured", () => {
		expect(SWEPT_SEEDS.map(playLine)).toEqual(GOLDEN);
	});
});

/** Three systems on an equilateral triangle 3.5 ly a side: each reaches the
 *  other two and nothing else at a 4 ly jump. */
const TRIANGLE = [
	[0, 0, 0],
	[3.5, 0, 0],
	[1.75, 3.031088913245535, 0],
] as const;

const TRADE: Station = generateContents(
	generateGalaxy(BASE, 0).systems[0],
).stations.find((s) => s.type === "trade")!;

interface Mini {
	government?: number;
	jump?: number;
	deficitT?: number;
	deficitAt?: (index: number) => number;
	bountyAt?: readonly number[];
	/** Moves the station's own draws, so a second world at the same place has a
	 *  different coin and berth seed. */
	salt?: number;
	/** The stations a system carries; the default is its one trade station. */
	stationsAt?: (index: number, trade: Station) => Station[];
	/** Replaces the stocked shelf a system gets by default. */
	goodsAt?: (index: number) => Record<string, number>;
}

/** A system placed on the x axis, one trade station each, and (by default) a
 *  stocked shelf everywhere so procurement binds. */
const mini = (
	positions: readonly (readonly [number, number, number])[],
	options: Mini = {},
): { systems: SystemRecord[]; world: ArcWorld; stationOf: (i: number) => Station } => {
	const {
		government = 4,
		jump = 4,
		deficitT = 12,
		deficitAt = () => deficitT,
		bountyAt = [],
		salt = 0,
		stationsAt,
		goodsAt,
	} = options;
	const systems = positions.map((pos, index) => ({
		...generateGalaxy(BASE, 0).systems[index + 1],
		index,
		pos: { x: pos[0], y: pos[1], z: pos[2] },
		name: `MINI ${index}`,
		government,
	}));
	const stationOf = (index: number): Station => ({
		...TRADE,
		localCarrierId: `mini-${index}`,
		name: `MINI ${index} TRADE`,
		berthSeed: TRADE.berthSeed + salt,
		assemblySeed: TRADE.assemblySeed + salt,
	});
	const contents = (record: SystemRecord) => ({
		...generateContents(record),
		stations: stationsAt?.(record.index, stationOf(record.index)) ?? [
			stationOf(record.index),
		],
	});
	const deficits: DeficitMap = {};
	for (const record of systems) {
		const goods = goodsAt?.(record.index) ?? { Food: deficitAt(record.index) };
		const row: Record<string, number> = {};
		for (const [good, units] of Object.entries(goods))
			if (units > 0) row[good] = units;
		if (Object.keys(row).length === 0) continue;
		deficits[carrierKey(record.index, stationOf(record.index).localCarrierId)] = {
			goods: row,
			updatedAt: 0,
		};
	}
	const targets = new Set(bountyAt);
	const world: ArcWorld = {
		galaxyIndex: 0,
		systems,
		contentsOf: contents,
		deficits,
		gameTimeMin: 0,
		maxJump: jump,
		holdT: HOLD,
		bountyTargetOf: (record) =>
			targets.has(record.index)
				? {
						carrierKey: carrierKey(record.index, "mini-relay"),
						name: "a relay",
						watchedStationName: `MINI ${record.index} TRADE`,
					}
				: null,
	};
	return { systems, world, stationOf };
};

describe("openArc's refusals", () => {
	test("a station that posts no work is refused by name", () => {
		const { systems, world, stationOf } = mini([[0, 0, 0], [3, 0, 0]]);
		const outpost: Station = {
			...stationOf(0),
			type: "outpost",
			name: "MINI OUTPOST",
		};
		expect(openArc(world, systems[0], outpost)).toEqual({
			ok: false,
			reason: "MINI OUTPOST posts no work",
		});
	});

	test("a system at peace with a full shelf has no question to ask", () => {
		const { systems, world, stationOf } = mini([
			[0, 0, 0],
			[3, 0, 0],
			[6, 0, 0],
			[9, 0, 0],
		], { deficitT: 0 });
		expect(openArc(world, systems[0], stationOf(0))).toEqual({
			ok: false,
			reason: "MINI 0 TRADE has no question to ask",
		});
	});

	test("a question with no route in the budget names the budget and the kind", () => {
		const { systems, world, stationOf } = mini([[0, 0, 0]], {
			jump: 4,
			deficitT: 12,
		});
		expect(openArc(world, systems[0], stationOf(0))).toEqual({
			ok: false,
			reason: "no route of 3-6 steps answers unexplained-shortage",
		});
	});
});

describe("the question kinds", () => {
	test("raiders open where the leg chance is at least the midpoint", () => {
		// raiderLegChance(3) is 0.4286, above the 0.4 midpoint; government 4 is
		// 0.3714, below it.
		const violent = mini(TRIANGLE, {
			government: 3,
			bountyAt: [0],
			deficitT: 0,
		});
		const opened = openArc(
			violent.world,
			violent.systems[0],
			violent.stationOf(0),
		);
		expect(opened.ok && opened.arc.kind).toBe("raiders-on-route");
		expect(opened.ok && opened.arc.answerFamily).toBe("bounty");
		expect(opened.ok && opened.arc.question).toBe(
			"Who is sending raiders down the cruise lanes out of MINI 0?",
		);

		const calm = mini(TRIANGLE, {
			government: 4,
			bountyAt: [0],
			deficitT: 0,
		});
		expect(openArc(calm.world, calm.systems[0], calm.stationOf(0))).toEqual({
			ok: false,
			reason: "MINI 0 TRADE has no question to ask",
		});
	});

	test("both questions at one desk: the coin decides which is asked", () => {
		const kinds = new Set<string>();
		for (let salt = 0; salt < 12; salt++) {
			const both = mini(TRIANGLE, {
				government: 3,
				bountyAt: [0],
				deficitT: 12,
				salt,
			});
			const opened = openArc(both.world, both.systems[0], both.stationOf(0));
			if (!opened.ok) throw new Error(`no arc for salt ${salt}`);
			kinds.add(opened.arc.kind);
		}
		expect([...kinds].sort()).toEqual([
			"raiders-on-route",
			"unexplained-shortage",
		]);
	});

	test("a shortage opens at twice the procurement floor and not a tonne under", () => {
		const atFloor = mini(TRIANGLE, { deficitT: 8 });
		const opened = openArc(atFloor.world, atFloor.systems[0], atFloor.stationOf(0));
		expect(opened.ok && opened.arc.kind).toBe("unexplained-shortage");
		expect(opened.ok && opened.arc.answerFamily).toBe("procurement");

		const under = mini(TRIANGLE, { deficitT: 7.99 });
		expect(openArc(under.world, under.systems[0], under.stationOf(0))).toEqual({
			ok: false,
			reason: "MINI 0 TRADE has no question to ask",
		});
	});

	test("a legal tonne good with the largest deficit names the question", () => {
		const { systems, world, stationOf } = mini(TRIANGLE);
		const key = carrierKey(0, "mini-0");
		const richer: ArcWorld = {
			...world,
			deficits: {
				...world.deficits,
				[key]: { goods: { Food: 9, Machinery: 21 }, updatedAt: 0 },
			},
		};
		const opened = openArc(richer, systems[0], stationOf(0));
		expect(opened.ok && opened.arc.question).toBe(
			"Why is MINI 0 TRADE short of Machinery?",
		);
	});

	test("a tie between two goods names the one the shelf lists first", () => {
		const { systems, world, stationOf } = mini(TRIANGLE);
		const key = carrierKey(0, "mini-0");
		const tied: ArcWorld = {
			...world,
			deficits: { ...world.deficits, [key]: { goods: { Food: 12, Machinery: 12 }, updatedAt: 0 } },
		};
		const opened = openArc(tied, systems[0], stationOf(0));
		expect(opened.ok && opened.arc.question).toBe(
			"Why is MINI 0 TRADE short of Food?",
		);
	});
});

describe("steps a station cannot post", () => {
	test("a neighbour that posts no work offers no step", () => {
		const outpost: Station = {
			...TRADE,
			type: "outpost",
			localCarrierId: "mini-1-outpost",
			name: "MINI 1 OUTPOST",
		};
		const world = mini(TRIANGLE, {
			stationsAt: (index, trade) =>
				index === 1 ? [trade, outpost] : [trade],
		});
		const opened = openArc(world.world, world.systems[0], world.stationOf(0));
		expect(opened.ok).toBe(true);
		const next = opened.ok ? nextStep(opened.arc, world.world) : null;
		expect(next?.kind).toBe("step");
		expect(
			next?.kind === "step" && next.offer.requester.carrierKey,
		).not.toBe(carrierKey(1, "mini-1-outpost"));
	});
});

describe("the arcs D10 refuses", () => {
	test("a route inside one system is not a route", () => {
		const refinery: Station = {
			...TRADE,
			type: "refinery",
			localCarrierId: "mini-0-refinery",
			name: "MINI 0 REFINERY",
		};
		const shipyard: Station = {
			...TRADE,
			type: "shipyard",
			localCarrierId: "mini-0-shipyard",
			name: "MINI 0 SHIPYARD",
		};
		const oneSystem = mini([[0, 0, 0]], {
			stationsAt: (_index, trade) => [trade, refinery, shipyard],
			goodsAt: () => ({ Food: 12 }),
		});
		expect(
			openArc(oneSystem.world, oneSystem.systems[0], oneSystem.stationOf(0)),
		).toEqual({
			ok: false,
			reason: "no route of 3-6 steps answers unexplained-shortage",
		});
	});

	test("a black market's illegal and non-tonne shelves cannot be the shortage", () => {
		const blackMarket: Station = {
			...TRADE,
			type: "refinery",
			blackMarket: true,
			localCarrierId: "mini-0-black",
			name: "MINI 0 BLACK",
		};
		const shelf = mini(TRIANGLE, {
			stationsAt: (index, trade) =>
				index === 0 ? [trade, blackMarket] : [trade],
		});
		const stocked: ArcWorld = {
			...shelf.world,
			deficits: {
				...shelf.world.deficits,
				[carrierKey(0, "mini-0-black")]: {
					goods: { Slaves: 40, Gold: 40, Food: 12 },
					updatedAt: 0,
				},
			},
		};
		const opened = openArc(stocked, shelf.systems[0], blackMarket);
		expect(opened.ok && opened.arc.question).toBe(
			"Why is MINI 0 BLACK short of Food?",
		);
	});
});

describe("nextStep's plan", () => {
	test("the first step is the nearest offer, and its budget reaches the reported station", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const first = nextStep(opening.arc, world);
		if (first.kind !== "step") throw new Error("no step");
		expect(first.rerouted).toBe(false);
		expect(first.flownLy).toBe(0);
		expect(systemIndexOfKey(first.offer.requester.carrierKey)).toBe(record.index);
	});

	test("a world that lost the planned step reroutes to one that still binds", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const withoutRelays: ArcWorld = { ...world, bountyTargetOf: () => null };
		const next = nextStep(opening.arc, withoutRelays);
		expect(next.kind).toBe("step");
		if (next.kind !== "step") return;
		expect(next.rerouted).toBe(true);
		expect(next.offer.id).not.toBe(opening.arc.foreseen[0]);
	});

	test("a world with no answer left says no route reaches it", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const empty: ArcWorld = {
			...world,
			systems: [record],
			maxJump: JUMP,
		};
		expect(nextStep(opening.arc, empty)).toEqual({
			kind: "none",
			reason: "no route reaches the answer from here",
		});
	});

	test("an arc with no system for its requester throws", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const elsewhere = {
			...opening.arc,
			requester: { ...opening.arc.requester, carrierKey: carrierKey(9999, "x") },
		};
		expect(() => nextStep(elsewhere, world)).toThrow("arcs: no system 9999");
	});

	test("the answer is named once the mark has landed", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const answer = {
			...opening.arc,
			taken: [
				{
					offerId: "x",
					family: opening.arc.answerFamily,
					requester: opening.arc.requester,
					reportAt: opening.arc.requester,
					payCr: 0,
					distanceLy: 0,
				},
			],
		};
		expect(nextStep(answer, world)).toEqual({
			kind: "answer",
			bonusCr: opening.arc.answerPayoutCr,
			text: `Answered: ${opening.arc.question}`,
		});
	});

	test("an arc that spent its steps unanswered says so", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const spent = {
			...opening.arc,
			taken: Array.from({ length: ARC_MAX_STEPS }, (_, i) => ({
				offerId: `spent-${i}`,
				family: "courier" as const,
				requester: opening.arc.requester,
				reportAt: opening.arc.requester,
				payCr: 0,
				distanceLy: 0,
			})),
		};
		expect(nextStep(spent, world)).toEqual({
			kind: "none",
			reason: "the arc spent its steps unanswered",
		});
	});

	test("with one step left in the budget only the answer is planned", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const refinery = {
			galaxyIndex: 0,
			carrierKey: carrierKey(record.index, "station-refinery"),
		};
		const taken = Array.from({ length: ARC_MAX_STEPS - 1 }, (_, i) => ({
			offerId: `flown-${i}`,
			family: i === 0 ? ("bounty" as const) : ("courier" as const),
			requester: { galaxyIndex: 0, carrierKey: carrierKey(i + 40, "x") },
			reportAt: refinery,
			payCr: 0,
			distanceLy: 0,
		}));
		const next = nextStep({ ...opening.arc, taken }, world);
		expect(next.kind).toBe("step");
		if (next.kind !== "step") return;
		expect(next.offer.requester.carrierKey).toBe(
			opening.arc.requester.carrierKey,
		);
	});

	test("a procured answer is only the requester's own desk", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const elsewhere = {
			...opening.arc.requester,
			carrierKey: carrierKey(record.index, "another-desk"),
		};
		const step = {
			offerId: "x",
			family: opening.arc.answerFamily,
			requester: elsewhere,
			reportAt: elsewhere,
			payCr: 0,
			distanceLy: 0,
		};
		expect(nextStep({ ...opening.arc, taken: [step] }, world).kind).not.toBe(
			"answer",
		);
		const own = { ...step, requester: opening.arc.requester };
		expect(nextStep({ ...opening.arc, taken: [own] }, world).kind).toBe("answer");
	});

	test("the plan keeps its foreseen step when a nearer one appears", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const foreseen = opening.arc.foreseen[0];
		const stocked: ArcWorld = {
			...world,
			systems: [
				...world.systems,
				{
					...world.systems[0],
					index: 200,
					name: "NEAR DESK",
					pos: { x: 0.5, y: 0, z: 0 },
				},
			],
			deficits: {
				...world.deficits,
				[carrierKey(200, "station-trade")]: {
					goods: { Food: 30 },
					updatedAt: 0,
				},
			},
		};
		const next = nextStep(opening.arc, stocked);
		expect(next.kind === "step" && next.offer.id).toBe(foreseen);
		expect(next.kind === "step" && next.rerouted).toBe(false);
	});
});

describe("the arc's shape", () => {
	test("systemsOf counts both the requester and the report world", () => {
		const step = (requester: number, reportAt: number) => ({
			offerId: `${requester}-${reportAt}`,
			family: "courier" as const,
			requester: { galaxyIndex: 0, carrierKey: carrierKey(requester, "a") },
			reportAt: { galaxyIndex: 0, carrierKey: carrierKey(reportAt, "b") },
			payCr: 1,
			distanceLy: 1,
		});
		expect([...systemsOf([step(3, 1), step(1, 4)])].sort()).toEqual([1, 3, 4]);
	});

	test("flownLyOf sums every step's leg", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const first = nextStep(opening.arc, world);
		if (first.kind !== "step") throw new Error("no step");
		expect(flownLyOf(recordStep(opening.arc, first))).toBeCloseTo(first.flownLy, 10);
		expect(flownLyOf(opening.arc)).toBe(0);
	});

	test("recordStep appends the step and leaves the arc it was given alone", () => {
		const { record, station, world } = seededWorld(6218014);
		const opening = openArc(world, record, station);
		if (!opening.ok) throw new Error("no arc");
		const first = nextStep(opening.arc, world);
		if (first.kind !== "step") throw new Error("no step");
		const one = recordStep(opening.arc, first);
		expect(opening.arc.taken).toEqual([]);
		expect(one.taken).toEqual([
			{
				offerId: first.offer.id,
				family: first.offer.family,
				requester: first.offer.requester,
				reportAt: first.offer.reportAt,
				payCr: first.offer.rewardCr,
				distanceLy: first.flownLy,
			},
		]);
	});
});

describe("D6's healing homes", () => {
	test("only the families whose mark the world heals may be a step", () => {
		expect(HEALING_HOME).toEqual({
			courier: true,
			procurement: true,
			bounty: true,
			salvage: false,
		});
		expect(refuseStep({ family: "bounty" })).toBeNull();
		expect(refuseStep({ family: "salvage" })).toBe(
			"the salvage mark has no home the world heals",
		);
	});
});
