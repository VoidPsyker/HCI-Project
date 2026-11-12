import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_COLOUR_MAPPING, DEPARTMENTS, childrenOf } from '@meridian/taxonomy';
import { MenuE } from '../src/menus/MenuE';
import { MenuD } from '../src/menus/MenuD';

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
});

it('disables outgoing icon-grid choices during their exit animation so they cannot change the new path', () => {
  render(<MenuE menuId="E" colourMapping={DEFAULT_COLOUR_MAPPING} onEvent={vi.fn()} onLeafSelect={vi.fn()} />);
  const outgoing = document.querySelector(`[data-node-id="${DEPARTMENTS[1]!.id}"]`)!;
  fireEvent.click(document.querySelector(`[data-node-id="${DEPARTMENTS[0]!.id}"]`)!);
  expect(outgoing).toBeDisabled();
  fireEvent.click(outgoing);
  expect(document.querySelector(`[data-hit-target][data-node-id="${DEPARTMENTS[1]!.id}"]`)).toBeNull();
  expect(document.querySelector(`[data-hit-target][data-node-id="${childrenOf(DEPARTMENTS[0]!.id)[0]!.id}"]`)).not.toBeNull();
});

it('opens tile children before animation completion so Back cannot be overwritten by a delayed navigation', () => {
  render(<MenuD menuId="D" colourMapping={DEFAULT_COLOUR_MAPPING} onEvent={vi.fn()} onLeafSelect={vi.fn()} />);
  fireEvent.keyDown(document.querySelector(`[data-node-id="${DEPARTMENTS[0]!.id}"]`)!, { key: 'Enter' });
  expect(document.querySelector(`[data-node-id="${childrenOf(DEPARTMENTS[0]!.id)[0]!.id}"]`)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Meridian home' }));
  expect(document.querySelector(`[data-node-id="${DEPARTMENTS[0]!.id}"]`)).not.toBeNull();
});

import { MenuA } from '../src/menus/MenuA';
import { MenuB } from '../src/menus/MenuB';
import { MenuC } from '../src/menus/MenuC';
import { MenuF } from '../src/menus/MenuF';

it.each([['A', MenuA], ['B', MenuB], ['C', MenuC], ['D', MenuD], ['E', MenuE], ['F', MenuF]] as const)(
  'menu %s selects the intended leaf with keyboard input', (menuId, Menu) => {
    const onLeafSelect = vi.fn();
    render(<Menu menuId={menuId} colourMapping={DEFAULT_COLOUR_MAPPING} onEvent={vi.fn()} onLeafSelect={onLeafSelect} />);
    const department = DEPARTMENTS[0]!;
    const collection = childrenOf(department.id)[0]!;
    const leaf = childrenOf(collection.id)[0]!;
    const activate = (id: string) => {
      const element = document.querySelector(`[data-node-id="${id}"]`)!;
      if (menuId === 'D' || menuId === 'F' || (menuId === 'A' && id === department.id)) fireEvent.keyDown(element, { key: 'Enter' });
      else fireEvent.click(element, { detail: 0 });
    };
    activate(department.id);
    if (menuId !== 'C') activate(collection.id);
    activate(leaf.id);
    expect(onLeafSelect).toHaveBeenCalledExactlyOnceWith(leaf, 'keyboard');
  }
);

it('cancels tile transitions when disabled or unmounted', () => {
  const props = { menuId: 'D' as const, colourMapping: DEFAULT_COLOUR_MAPPING, onEvent: vi.fn(), onLeafSelect: vi.fn() };
  const view = render(<MenuD {...props} />);
  const scene = document.querySelector('svg.d-svg > g') as SVGGElement & { __transition?: unknown };
  fireEvent.keyDown(document.querySelector(`[data-node-id="${DEPARTMENTS[0]!.id}"]`)!, { key: 'Enter' });
  expect(scene.__transition).toBeDefined();
  view.rerender(<MenuD {...props} disabled />);
  expect(scene.__transition).toBeUndefined();
  expect(scene.getAttribute('transform')).toBeNull();
  view.rerender(<MenuD {...props} />);
  fireEvent.keyDown(document.querySelector(`[data-node-id="${childrenOf(DEPARTMENTS[0]!.id)[0]!.id}"]`)!, { key: 'Enter' });
  expect(scene.__transition).toBeDefined();
  view.unmount();
  expect(scene.__transition).toBeUndefined();
});
