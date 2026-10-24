import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createSnapshotProvider, SNAPSHOT_PATH } from "../src/lib/snapshot-provider.ts";

try {
  const { values } = parseArgs({
    options: { file: { type: "string", default: SNAPSHOT_PATH } },
  });
  const path = resolve(values.file!);
  const snapshot = await createSnapshotProvider(() => readFile(path, "utf8")).getSnapshot();
  console.log(`Valid NBA Stats snapshot: ${snapshot.season}, ${snapshot.rookies.length} rookies, collected ${snapshot.updatedAt}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
