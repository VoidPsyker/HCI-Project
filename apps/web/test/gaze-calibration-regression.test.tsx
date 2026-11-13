import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi, it, expect } from "vitest";
import { GazeCalibrationScreen } from "../src/screens/GazeCalibration";
import type { GazeController } from "../src/gaze/GazeController";

it("runs calibration after StrictMode effect replay and continues with gaze whatever the error", async () => {
  vi.useFakeTimers();
  const report = { passes: false, angular_available: true, points: [], max_error_deg: 12, mean_error_deg: 8, criterion_deg: 10, target_count: 1, expected_target_count: 9 };
  const controller = {
    beginCalibration: vi.fn(() => [{ id: "one", x_px: 100, y_px: 100, order: 0 }]),
    trainCalibrationTarget: vi.fn(async () => {}),
    validateCalibrationTarget: vi.fn(async () => 5),
    finishCalibration: vi.fn(() => report)
  };
  const onCalibrated = vi.fn();
  render(<StrictMode><div style={{ transform: "scale(0.5)" }}><GazeCalibrationScreen controller={controller as unknown as GazeController} starting={false} startError={null} onRetry={() => {}} onCalibrated={onCalibrated} onSkip={() => {}} /></div></StrictMode>);
  fireEvent.click(screen.getByTestId("gaze-calibration-start"));
  expect(screen.getByTestId("gaze-calibration-target").parentElement).toBe(document.body);
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(controller.trainCalibrationTarget).toHaveBeenCalledTimes(1);
  expect(controller.finishCalibration).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("gaze-calibration-result")).toHaveTextContent("12.00°");
  fireEvent.click(screen.getByRole("button", { name: "Recalibrate" }));
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(controller.beginCalibration).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByTestId("gaze-calibration-continue"));
  expect(onCalibrated).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
