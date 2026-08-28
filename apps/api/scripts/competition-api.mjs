import { guardCompetition, pointRuntimeToCompetition } from "./competition-guard.mjs";

pointRuntimeToCompetition();
guardCompetition({ requireRuntimeUrls: true });
await import("../dist/src/main.js");
