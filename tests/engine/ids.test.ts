import { describe, expect, it } from "vitest";
import {
  slugify,
  createProjectId,
  hashPaperId,
  createGapId,
  createIdeaId,
  createGraveyardEntryId,
  createAssumptionId,
  createEvidenceId,
  createExperimentId,
  createReviewId,
} from "../../src/engine/ids.js";

describe("slugify", () => {
  it("lowercases, strips punctuation, and joins with hyphens", () => {
    expect(slugify("How can RL become, more efficient?!")).toBe("how-can-rl-become-more");
  });

  it("truncates to maxWords", () => {
    expect(slugify("one two three four five six seven", 3)).toBe("one-two-three");
  });

  it("falls back to 'project' for empty input", () => {
    expect(slugify("???")).toBe("project");
  });
});

describe("createProjectId", () => {
  it("matches <slug>-<8 hex chars>", () => {
    const id = createProjectId("Sample efficient model-based RL");
    expect(id).toMatch(/^sample-efficient-model-based-rl-[0-9a-f]{8}$/);
  });

  it("produces different ids for the same problem on repeated calls", () => {
    const a = createProjectId("same problem");
    const b = createProjectId("same problem");
    expect(a).not.toBe(b);
  });
});

describe("hashPaperId", () => {
  it("is deterministic for the same title and year", () => {
    const a = hashPaperId("Some Paper Title", 2024);
    const b = hashPaperId("Some Paper Title", 2024);
    expect(a).toBe(b);
  });

  it("differs for a different title", () => {
    const a = hashPaperId("Some Paper Title", 2024);
    const b = hashPaperId("A Different Title", 2024);
    expect(a).not.toBe(b);
  });

  it("starts with 'hash:'", () => {
    expect(hashPaperId("Title", null)).toMatch(/^hash:[0-9a-f]{16}$/);
  });
});

describe("createGapId", () => {
  it("zero-pads to 3 digits", () => {
    expect(createGapId(1)).toBe("gap-001");
    expect(createGapId(42)).toBe("gap-042");
  });
});

describe("createIdeaId", () => {
  it("zero-pads to 3 digits", () => {
    expect(createIdeaId(1)).toBe("idea-001");
    expect(createIdeaId(42)).toBe("idea-042");
  });
});

describe("createGraveyardEntryId", () => {
  it("matches graveyard-NNN", () => {
    expect(createGraveyardEntryId(1)).toBe("graveyard-001");
  });
});

describe("createAssumptionId", () => {
  it("matches assumption-NNN", () => {
    expect(createAssumptionId(3)).toBe("assumption-003");
  });
});

describe("createEvidenceId", () => {
  it("matches evidence-NNN", () => {
    expect(createEvidenceId(12)).toBe("evidence-012");
  });
});

describe("createExperimentId", () => {
  it("formats with zero-padded index", () => {
    expect(createExperimentId(1)).toBe("experiment-001");
    expect(createExperimentId(12)).toBe("experiment-012");
  });
});

describe("createReviewId", () => {
  it("formats with zero-padded index", () => {
    expect(createReviewId(1)).toBe("review-001");
  });
});
