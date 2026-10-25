import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { trainForecastModel, validateHistoricalRace } from "../src/lib/forecast.ts";
import { validateSnapshot } from "../src/lib/snapshot.ts";

export async function main() {
  const { values } = parseArgs({
    options: { input: { type: "string" }, output: { type: "string", default: "data/forecast-model.json" } },
  });
  if (!values.input) throw new Error("--input is required.");
  const input: unknown = JSON.parse(await readFile(resolve(values.input), "utf8"));
  if (!Array.isArray(input)) throw new Error("Expected an array of historical races.");
  const history = input.map((value: unknown) => {
    const race = validateHistoricalRace(value);
    if (race.snapshot.rookies.length > 0) validateSnapshot(race.snapshot);
    return race;
  });
  const model = trainForecastModel(history);
  const output = resolve(values.output!);
  await mkdir(dirname(output), { recursive: true });
  const staging = `${output}.${process.pid}.pending`;
  let created = false;
  try {
    await writeFile(staging, `${JSON.stringify(model, null, 2)}\n`, { flag: "wx" });
    created = true;
    await rename(staging, output);
  } finally {
    if (created) await unlink(staging).catch(() => {});
  }
  console.log(`Trained through ${model.trainedThrough}; ${model.validation.seasonCount} out-of-time seasons. Small sample; not proof of calibration.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Forecast training failed: check arguments, readable JSON, complete chronological fields and writable output. No model published.");
    process.exitCode = 1;
  });
}
