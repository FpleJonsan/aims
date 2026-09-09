import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adminSql, COMPETITION_DB, guardCompetition } from "./competition-guard.mjs";

guardCompetition();
const root = resolve(import.meta.dirname, "../migrations");
const files = (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
if (!files.length) throw new Error("Competition reset refused: no migrations found.");

adminSql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${COMPETITION_DB}' AND pid<>pg_backend_pid();\nDROP DATABASE IF EXISTS ${COMPETITION_DB};\nCREATE DATABASE ${COMPETITION_DB};`, "postgres");
for (const file of files) {
  adminSql(await readFile(resolve(root, file), "utf8"));
  process.stdout.write(`Applied ${file}\n`);
}
process.stdout.write(`Competition database ${COMPETITION_DB} rebuilt safely. Run seed:competition next.\n`);
