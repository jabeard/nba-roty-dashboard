import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { SNAPSHOT_PATH } from "../src/lib/snapshot-provider.ts";
import { validateSnapshot } from "../src/lib/snapshot.ts";

try {
  const { values } = parseArgs({
    options: { file: { type: "string", default: SNAPSHOT_PATH } },
  });
  const path = resolve(values.file!);
  const snapshot = validateSnapshot(JSON.parse(await readFile(path, "utf8")));
  console.log(`Valid NBA Stats snapshot: ${snapshot.season}, ${snapshot.rookies.length} rookies, collected ${snapshot.updatedAt}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
