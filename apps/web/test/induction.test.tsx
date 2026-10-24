import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EventLogger } from "../src/logger";
import { InductionScreen } from "../src/screens/Induction";

function setup(state: "frustrated" | "bored") {
  const log = vi.fn();
  const onComplete = vi.fn();
  const onDistressStop = vi.fn();
  render(
    <InductionScreen
      state={state}
      blockId="block-1"
      fastMode={false}
      logger={{ log } as unknown as EventLogger}
      onComplete={onComplete}
      onDistressStop={onDistressStop}
    />
  );
  const ends = () => log.mock.calls.filter(([event]) => event.event_type === "induction_end");
  return { log, onComplete, onDistressStop, ends };
}

describe("InductionScreen", () => {
  it("leaves the induction_end of a stop to the runner, so it is logged once", () => {
    const { onDistressStop, ends } = setup("frustrated");
    fireEvent.click(screen.getByTestId("induction-stop"));
    expect(onDistressStop).toHaveBeenCalledTimes(1);
    expect(ends()).toHaveLength(0);
  });

  it("caps the frustrating search at three attempts and resets the filter each time", () => {
    const { log } = setup("frustrated");
    for (let attempt = 0; attempt < 3; attempt++) {
      fireEvent.change(screen.getByTestId("induction-filter"), { target: { value: "42 mm" } });
      fireEvent.click(screen.getByTestId("induction-search"));
      expect(screen.getByTestId("induction-filter")).toHaveValue("Any");
    }
    expect(screen.getByTestId("induction-search")).toBeDisabled();
    expect(screen.getByTestId("induction-search-result")).toHaveTextContent("No results.");
    expect(log.mock.calls.filter(([event]) => event.event_type === "search_attempt")).toHaveLength(3);
  });

  it("lets the bored participant leave early and logs it once", () => {
    const { onComplete, ends } = setup("bored");
    fireEvent.click(screen.getByTestId("induction-early-exit"));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(ends()).toHaveLength(1);
    expect(ends()[0]![0].meta).toMatchObject({ completed: false, early_exit: true });
  });
});
