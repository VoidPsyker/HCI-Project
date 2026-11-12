import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LocalClip } from '../src/components/LocalClip';
import type { MediaSlot } from '../src/content';
it('announces failed media and clears the error when the clip changes', () => {
  const slot = { src: '/missing.mp4' } as MediaSlot;
  const view = render(<LocalClip slot={slot} testId="clip" />);
  fireEvent.error(screen.getByTestId('clip'));
  expect(screen.getByRole('alert')).toHaveTextContent(/researcher/i);
  view.rerender(<LocalClip slot={{ ...slot, src: '/other.mp4' }} testId="clip" />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
