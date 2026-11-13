import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DebriefScreen } from "../src/screens/Debrief";
import { ConsentScreen } from "../src/screens/Consent";
import { CheckinScreen } from "../src/screens/Checkin";
import { DemographicsScreen } from "../src/screens/Demographics";
import { QuestionnairesScreen } from "../src/screens/Questionnaires";
import { NeutralResetScreen } from "../src/screens/Interstitials";
import { InductionScreen } from "../src/screens/Induction";
import type { EventLogger } from "../src/logger";

const logger = { log: vi.fn() } as unknown as EventLogger;
const pending = () => new Promise<void>(() => {});

describe("participant screen regressions", () => {
  it("advances only one block after the reset timer expires", () => {
    vi.useFakeTimers();
    try {
      const proceed = vi.fn();
      render(<NeutralResetScreen state="bored" fastMode onContinue={proceed} />);
      expect(screen.getByTestId("reset-continue")).toBeDisabled();
      act(() => vi.advanceTimersByTime(1200));
      fireEvent.click(screen.getByTestId("reset-continue"));
      fireEvent.click(screen.getByTestId("reset-continue"));
      expect(proceed).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("lets completion retry after a rejected finish attempt", async () => {
    const finish = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(<DebriefScreen aborted={false} stopSource={null} reason={null} completionCode={null} busy={false} onFinish={finish} onWithdraw={pending} />);
    await act(async () => fireEvent.click(screen.getByTestId("finish-session")));
    expect(screen.getByRole("alert")).toHaveTextContent(/try again/i);
    await act(async () => fireEvent.click(screen.getByTestId("finish-session")));
    expect(finish).toHaveBeenCalledTimes(2);
  });

  it("prevents duplicate questionnaires and preserves scoring endpoints and menu identity", () => {
    const submit = vi.fn((_responses: Array<Record<string, unknown>>) => pending());
    render(<QuestionnairesScreen sessionId="s" usabilityMenu="A" logger={logger} fastMode busy={false} onSubmit={submit} />);
    fireEvent.click(screen.getByTestId("fill-neutral"));
    fireEvent.click(screen.getByTestId("submit-questionnaires"));
    fireEvent.click(screen.getByTestId("submit-questionnaires"));
    expect(submit).toHaveBeenCalledTimes(1);
    const responses = submit.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(responses.filter((r) => r.instrument === "SUS")).toHaveLength(10);
    expect(responses.filter((r) => r.instrument === "SUS").every((r) => r.menu_id === "A" && r.value === 3)).toBe(true);
    expect(responses.filter((r) => r.instrument === "NASA_TLX").every((r) => r.value === 50)).toBe(true);
  });

  it.each(["gaze_quality_gate_failed", "stopped_by_server", "unexpected_internal_reason"])("explains system stop %s without internal codes or implying participant stopped", (reason) => {
    render(<DebriefScreen aborted stopSource="system" reason={reason} completionCode={null} busy={false} onFinish={vi.fn()} onWithdraw={pending} />);
    expect(screen.queryByText("Thank you for stopping")).not.toBeInTheDocument();
    expect(screen.getByTestId("debrief-screen")).not.toHaveTextContent(reason);
    expect(screen.getByRole("alert")).toHaveTextContent("session");
  });

  it("prevents duplicate consent while the parent has not set busy", () => {
    const submit = vi.fn(pending);
    render(<ConsentScreen onConsent={submit} busy={false} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("consent-continue"));
    fireEvent.click(screen.getByTestId("consent-continue"));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate check-ins", () => {
    const submit = vi.fn(pending);
    render(<CheckinScreen phase="baseline" onSubmit={submit} busy={false} />);
    fireEvent.click(screen.getByTestId("checkin-continue"));
    fireEvent.click(screen.getByTestId("checkin-continue"));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("ignores demographics submit events while busy", () => {
    const submit = vi.fn(pending);
    const { container } = render(<DemographicsScreen onSubmit={submit} busy />);
    for (const select of container.querySelectorAll("select")) {
      fireEvent.change(select, { target: { value: select.options[1]!.value } });
    }
    fireEvent.submit(container.querySelector("form")!);
    expect(submit).not.toHaveBeenCalled();
  });

  it("allows retry after withdrawal fails and does not claim deletion", async () => {
    const withdraw = vi.fn().mockRejectedValue(new Error("offline"));
    render(<DebriefScreen aborted={false} stopSource={null} reason={null} completionCode={null} busy={false} onFinish={vi.fn()} onWithdraw={withdraw} />);
    fireEvent.click(screen.getByText("Withdraw my data"));
    await act(async () => fireEvent.click(screen.getByTestId("confirm-withdraw")));
    expect(screen.getByRole("alert")).toHaveTextContent(/try again/i);
    expect(screen.queryByTestId("withdrawn-screen")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-withdraw")).toBeEnabled();
  });

  it("names and pictures the menu being rated, and pictures every menu in the preference choice", () => {
    render(<QuestionnairesScreen sessionId="s" usabilityMenu="C" logger={logger} fastMode={false} busy={false} onSubmit={pending} />);
    const rated = screen.getByTestId("rated-menu");
    expect(within(rated).getByRole("heading", { name: "Mega menu" })).toBeInTheDocument();
    expect(within(rated).getByRole("img")).toHaveAttribute("src", "/assets/menus/menu-c.jpg");
    const group = screen.getByRole("radiogroup", { name: "Which menu would you choose for another search?" });
    const choices = within(group);
    expect(group.querySelectorAll("img")).toHaveLength(6);
    expect(choices.getByRole("radio", { name: /Radial lattice/ })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByTestId("preferred-menu-F"));
    expect(choices.getByRole("radio", { name: /Radial lattice/ })).toHaveAttribute("aria-checked", "true");
  });

  it("asks NASA-TLX in NASA's own plain questions with both slider ends labelled", () => {
    render(<QuestionnairesScreen sessionId="s" usabilityMenu="A" logger={logger} fastMode={false} busy={false} onSubmit={pending} />);
    fireEvent.click(screen.getByText("Workload", { selector: "button" }));
    const page = screen.getByTestId("nasa-page");
    expect(within(page).getByText("How mentally demanding was the task?")).toBeInTheDocument();
    expect(within(page).getByText("How successful were you in accomplishing what you were asked to do?")).toBeInTheDocument();
    expect(within(page).getAllByText("Very low")).toHaveLength(5);
    expect(within(page).getByText("Perfect")).toBeInTheDocument();
    expect(within(page).getByText("Failure")).toBeInTheDocument();
  });

  it("requires explicit NASA answers including a deliberate midpoint", () => {
    render(<QuestionnairesScreen sessionId="s" usabilityMenu="A" logger={logger} fastMode={false} busy={false} onSubmit={pending} />);
    fireEvent.click(screen.getByText("Workload", { selector: "button" }));
    expect(screen.getByText("Next section →")).toBeDisabled();
    const page = screen.getByTestId("nasa-page");
    for (const slider of within(page).getAllByRole("slider")) fireEvent.change(slider, { target: { value: "55" } });
    expect(screen.getByText("Next section →")).toBeEnabled();
  });

  it("does not submit twice from induction early exit", () => {
    const complete = vi.fn();
    render(<InductionScreen state="bored" blockId="b" fastMode logger={logger} onComplete={complete} onDistressStop={vi.fn()} />);
    fireEvent.click(screen.getByTestId("induction-early-exit"));
    fireEvent.click(screen.getByTestId("induction-early-exit"));
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
