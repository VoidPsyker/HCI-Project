import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminDashboard } from "../src/admin/AdminDashboard";
import * as api from "../src/api";
import type { AdminSession, QaReport } from "../src/types";

vi.mock("../src/api", () => ({
  getAdminSessions: vi.fn(), getQa: vi.fn(), getGoNoGo: vi.fn(), getGazeSummary: vi.fn(),
  abortAdminSession: vi.fn(), addAdminNote: vi.fn(), createAdminSession: vi.fn(),
  deleteAdminSession: vi.fn(), downloadExport: vi.fn(), downloadGazeExport: vi.fn(), adminRequest: vi.fn()
}));
const session = { session_id: "s1", label: "P01", status: "in_progress", phase: "trial", checkin_distress: null } as AdminSession;
const qa = { sessions: { total: 1, completed: 0, in_progress: 1, aborted: 0 }, counts: {}, criteria: [], data_quality: {}, calibration: { by_task: [], by_menu: [] }, overall: "pass" } as unknown as QaReport;
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.setItem("meridian.admin.password", "test-password");
  vi.mocked(api.getAdminSessions).mockResolvedValue({ sessions: [session] });
  vi.mocked(api.getQa).mockResolvedValue(qa);
  vi.mocked(api.getGoNoGo).mockResolvedValue({ criteria: [], generated_at: "" });
  vi.mocked(api.getGazeSummary).mockRejectedValue(new Error("gaze_session_not_found"));
  vi.mocked(api.adminRequest).mockResolvedValue({ session: { abort_reason: "researcher_stop" }, notes: [] });
});
async function openDetail() {
  const label = await screen.findByText("P01");
  await act(async () => { fireEvent.click(label); });
  return screen.getByTestId("session-detail");
}
describe("researcher dashboard", () => {
  it("updates the open detail and removes it when the session is withdrawn", async () => {
    render(<AdminDashboard />);
    await openDetail();
    vi.mocked(api.getAdminSessions).mockResolvedValue({ sessions: [{ ...session, status: "aborted" }] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(within(screen.getByTestId("session-detail")).getByText("Stopped")).toBeInTheDocument());
    vi.mocked(api.getAdminSessions).mockResolvedValue({ sessions: [] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.queryByTestId("session-detail")).not.toBeInTheDocument());
  });
  it("displays the saved stop reason and disables stopping an ended session", async () => {
    vi.mocked(api.getAdminSessions).mockResolvedValue({ sessions: [{ ...session, status: "aborted" }] });
    render(<AdminDashboard />);
    await openDetail();
    expect(await screen.findByText("researcher_stop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abort & debrief" })).toBeDisabled();
  });
  it("clears private state on sign out and handles a rejected refreshed password", async () => {
    render(<AdminDashboard />);
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.change(screen.getByLabelText("Admin password"), { target: { value: "next-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    await screen.findByText("P01");
    expect(screen.queryByTestId("session-detail")).not.toBeInTheDocument();
    vi.mocked(api.getAdminSessions).mockRejectedValue(new Error("admin_password_required"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("heading", { name: "Admin sign-in" })).toBeInTheDocument();
    expect(sessionStorage.getItem("meridian.admin.password")).toBeNull();
  });
  it("surfaces background polling errors", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    render(<AdminDashboard />);
    await screen.findByText("P01");
    vi.mocked(api.getAdminSessions).mockRejectedValue(new Error("offline"));
    await act(async () => { (interval.mock.calls.filter((call) => call[1] === 10_000)[0]![0] as () => void)(); });
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
  });
  it("keeps sessions usable when QA fails", async () => {
    vi.mocked(api.getQa).mockRejectedValue(new Error("qa_unavailable"));
    vi.mocked(api.getAdminSessions).mockResolvedValue({ sessions: [{ ...session, status: "aborted" }] });
    render(<AdminDashboard />);
    expect(await screen.findByText("P01")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("qa_unavailable");
    expect(screen.getByText("Stopped / withdrawn").parentElement).toHaveTextContent("1");
  });
  it("keeps a failed stop reason and prevents duplicate stop requests", async () => {
    render(<AdminDashboard />);
    await screen.findByText("P01");
    fireEvent.click(screen.getByRole("button", { name: "Abort & debrief" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Equipment issue" } });
    let reject!: (failure: Error) => void;
    vi.mocked(api.abortAdminSession).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    fireEvent.click(screen.getByRole("button", { name: "Stop session" }));
    expect(screen.getByRole("button", { name: "Stop session" })).toBeDisabled();
    await act(async () => { reject(new Error("offline")); });
    expect(screen.getByLabelText("Reason")).toHaveValue("Equipment issue");
    expect(screen.getByRole("button", { name: "Stop session" })).toBeEnabled();
    expect(api.abortAdminSession).toHaveBeenCalledTimes(1);
  });
  it("does not replace a newer session list with a slow poll", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    render(<AdminDashboard />);
    await screen.findByText("P01");
    let resolve!: (value: { sessions: AdminSession[] }) => void;
    vi.mocked(api.getAdminSessions).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => { (interval.mock.calls.filter((call) => call[1] === 10_000)[0]![0] as () => void)(); });
    vi.mocked(api.getAdminSessions).mockResolvedValue({ sessions: [{ ...session, label: "newer" }] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
    await act(async () => { resolve({ sessions: [session] }); });
    expect(screen.getByText("newer")).toBeInTheDocument();
    expect(screen.queryByText("P01")).not.toBeInTheDocument();
  });
  it("reports clipboard rejection", async () => {
    vi.mocked(api.createAdminSession).mockResolvedValue({ participant_url: "/run/new" } as Awaited<ReturnType<typeof api.createAdminSession>>);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<AdminDashboard />);
    await screen.findByText("P01");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create session link" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("Copy it manually");
  });
  it("clears a stale gaze error when no gaze session is found on retry", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    vi.mocked(api.getGazeSummary).mockRejectedValueOnce(new Error("gaze offline"));
    render(<AdminDashboard />);
    await openDetail();
    expect(screen.getByRole("alert")).toHaveTextContent("gaze offline");
    await act(async () => { (interval.mock.calls.filter((call) => call[1] === 10_000).at(-1)![0] as () => void)(); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/No eye-tracking data yet/)).toBeInTheDocument();
  });

  it("shows saved notes and signs out on a rejected action", async () => {
    vi.mocked(api.adminRequest).mockResolvedValue({ session: { abort_reason: null }, notes: [{ note_id: 1, note: "Saved observation", created_at: null }] });
    render(<AdminDashboard />);
    await openDetail();
    expect(screen.getByText(/Saved observation/)).toBeInTheDocument();
    vi.mocked(api.addAdminNote).mockRejectedValue(new Error("admin_password_required"));
    fireEvent.change(screen.getByLabelText("Researcher note"), { target: { value: "new note" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save note" })); });
    expect(screen.getByRole("heading", { name: "Admin sign-in" })).toBeInTheDocument();
  });
  it("requires confirmation before deleting and closes the deleted detail", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(api.deleteAdminSession).mockResolvedValue({});
    render(<AdminDashboard />);
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteAdminSession).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    vi.mocked(api.getAdminSessions).mockResolvedValue({ sessions: [] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete" })); });
    expect(api.deleteAdminSession).toHaveBeenCalledWith("test-password", "s1");
    expect(screen.queryByTestId("session-detail")).not.toBeInTheDocument();
  });

});
