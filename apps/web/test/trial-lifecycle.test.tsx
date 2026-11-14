import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DEFAULT_COLOUR_MAPPING, LEAVES } from '@meridian/taxonomy';
import { SessionChrome } from '../src/components/SessionChrome';
import { TrialRunner, type TrialInstruction } from '../src/components/TrialRunner';
import type { EventLogger } from '../src/logger';
import type { SessionInfo } from '../src/types';

it.each(['STOPPED', 'aborted', 'withdrawn', 'completed'])('hides Stop for terminal status %s', status => {
  render(<SessionChrome session={{ status, session_id: 'test' } as SessionInfo} phase="debrief" blockIndex={0} trialIndex={0} trialCount={3} fastMode={false} onStop={vi.fn()}>Debrief</SessionChrome>);
  expect(screen.queryByTestId('stop-control')).not.toBeInTheDocument();
});

it('closes a pending stop dialog when the session ends', () => {
  const props = { session: { status: 'in_progress', session_id: 'test' } as SessionInfo, phase: 'trial' as const, blockIndex: 0, trialIndex: 0, trialCount: 3, fastMode: false, onStop: vi.fn(), children: 'Trial' };
  const view = render(<SessionChrome {...props} />);
  fireEvent.click(screen.getByTestId('stop-control'));
  view.rerender(<SessionChrome {...props} phase="aborted" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('returns keyboard focus to Stop on Escape', () => {
  render(<SessionChrome session={{ status: 'in_progress', session_id: 'test' } as SessionInfo} phase="trial" blockIndex={0} trialIndex={0} trialCount={3} fastMode={false} onStop={vi.fn()}>Trial</SessionChrome>);
  const stop = screen.getByTestId('stop-control');
  stop.focus();
  fireEvent.click(stop);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(stop).toHaveFocus();
});

it('does not start logging or timers after a pending gaze start unmounts', async () => {
  vi.useFakeTimers();
  try {
    let resolve!: (value: { start_ms: number }) => void;
    const gaze = { beginTrial: vi.fn(() => new Promise<{ start_ms: number }>(done => { resolve = done; })), endTrial: vi.fn(), captureAois: vi.fn() };
    const logger = { beginTrial: vi.fn(), log: vi.fn(), finishTrial: vi.fn() };
    const spec: TrialInstruction = { trialId: 't', blockId: 'b', menuId: 'B', taskId: 'task', targetId: LEAVES[0]!.productId!, taskDescription: 'Find watch', stateLabel: 'mixed', practice: false, trialIndex: 0, trialCount: 3 };
    const view = render(<TrialRunner spec={spec} colourMapping={DEFAULT_COLOUR_MAPPING} logger={logger as unknown as EventLogger} gaze={gaze} fastMode={false} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('start-trial'));
    view.unmount();
    await act(async () => resolve({ start_ms: 0 }));
    expect(logger.beginTrial).not.toHaveBeenCalled();
    expect(gaze.endTrial).toHaveBeenCalledWith(expect.objectContaining({ trial_id: 't' }));
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('advances a finished trial only once even when Continue is activated twice', () => {
  const logger = { beginTrial: vi.fn(), log: vi.fn(), finishTrial: vi.fn() };
  const onComplete = vi.fn();
  const spec: TrialInstruction = { trialId: 't', blockId: 'b', menuId: 'B', taskId: 'task', targetId: LEAVES[0]!.productId!, taskDescription: 'Find watch', stateLabel: 'mixed', practice: false, trialIndex: 0, trialCount: 3 };
  render(<TrialRunner spec={spec} colourMapping={DEFAULT_COLOUR_MAPPING} logger={logger as unknown as EventLogger} fastMode={false} onComplete={onComplete} />);
  fireEvent.click(screen.getByTestId('start-trial'));
  fireEvent.click(screen.getByTestId('give-up'));
  fireEvent.click(screen.getByRole('button', { name: 'Next trial' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next trial' }));
  expect(onComplete).toHaveBeenCalledTimes(1);
});
