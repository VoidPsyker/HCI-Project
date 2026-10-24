import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GazeSetupScreen } from "../../src/screens/GazeSetup";

it("requires new physical measurements after the viewport changes", () => {
  render(<GazeSetupScreen onSubmit={vi.fn()} busy={false} error={null} />);
  fireEvent.change(screen.getByTestId("gaze-width-mm"), { target: { value: "530" } });
  fireEvent.change(screen.getByTestId("gaze-height-mm"), { target: { value: "300" } });
  fireEvent.change(screen.getByTestId("gaze-distance-mm"), { target: { value: "600" } });
  fireEvent.click(screen.getByTestId("gaze-measured-confirm"));
  fireEvent.click(screen.getByTestId("gaze-windowed-confirm"));
  expect(screen.getByTestId("gaze-setup-continue")).toBeEnabled();
  fireEvent(window, new Event("resize"));
  expect(screen.getByTestId("gaze-setup-continue")).toBeDisabled();
  expect(screen.getByTestId("gaze-measured-confirm")).not.toBeChecked();
  expect(screen.getByTestId("gaze-width-mm")).toHaveValue(null);
});
