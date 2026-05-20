/**
 * Contract tests: the W0 sample fixture must validate against the schema
 * on the frontend side using ajv. Mirrors the Python-side contract test.
 */
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import schema from "../../schema/episodes.schema.json" with { type: "json" };
import sample from "../../data/samples/episodes.sample.json" with { type: "json" };

describe("schema contract", () => {
  it("sample fixture validates against episodes.schema.json", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(sample);
    if (!ok) {
      throw new Error(`validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    }
    expect(ok).toBe(true);
  });

  it("year_end is never before year_start", () => {
    interface Episode {
      guid: string;
      year_start: number;
      year_end: number;
    }
    const doc = sample as { episodes: Episode[] };
    for (const ep of doc.episodes) {
      expect(
        ep.year_end,
        `episode ${ep.guid}: year_end ${ep.year_end} < year_start ${ep.year_start}`,
      ).toBeGreaterThanOrEqual(ep.year_start);
    }
  });
});
