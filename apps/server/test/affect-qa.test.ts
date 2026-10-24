import { describe, expect, it } from "vitest";
import { buildGoNoGo } from "../src/qa";
import type { Repository } from "../src/repository";

const states = ["happy", "frustrated", "confused", "bored"] as const;
const checkins = states.map((state) => ({
  state_label: state,
  meta: {
    phase: "post_induction", happy: 2, frustrated: 2, confused: 2, bored: 2,
    [state]: 6, valence: state === "happy" ? 7 : 4,
    arousal: state === "bored" ? 3 : 5, distress: 0
  }
}));

function criterion(rows: typeof checkins) {
  const repo = {
    listAdminSessions: () => [], allTrials: () => [], allCheckins: () => rows,
    allEvents: () => [], allQuestionnaires: () => []
  } as unknown as Repository;
  return buildGoNoGo(repo).find((item) => item.id === "manipulation");
}

describe("induction QA", () => {
  it("passes all four qualifying inductions from raw ratings", () => {
    expect(criterion(checkins)?.status).toBe("pass");
  });
  it("fails when a high happy rating has incompatible valence", () => {
    expect(criterion(checkins.map((row) => row.state_label === "happy"
      ? { ...row, meta: { ...row.meta, valence: 4 } } : row))?.status).toBe("fail");
  });
  it("does not pass an incomplete set of inductions", () => {
    expect(criterion(checkins.slice(0, 1))?.status).toBe("fail");
    expect(criterion(checkins.map((row) => ({ ...row, meta: { ...row.meta, phase: "post_trials" } })))?.status).toBe("na");
  });
});
