import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DEPARTMENTS, childrenOf } from '@meridian/taxonomy';
import { MenuLab } from '../src/lab/MenuLab';
it('browser Back closes the product without navigating the obscured menu', () => {
  render(<MenuLab />);
  fireEvent.change(screen.getByLabelText('Menu'), { target: { value: 'B' } });
  const department = DEPARTMENTS[0]!;
  const collection = childrenOf(department.id)[0]!;
  const leaf = childrenOf(collection.id)[0]!;
  const click = (id: string) => fireEvent.click(document.querySelector(`[data-node-id="${id}"]`)!);
  click(department.id); click(collection.id); click(leaf.id);
  expect(screen.getByTestId('product-detail')).toBeInTheDocument();
  expect(screen.getByTestId('menu-b')).toHaveAttribute('inert');
  fireEvent.popState(window);
  expect(screen.queryByTestId('product-detail')).not.toBeInTheDocument();
  expect(document.querySelector(`[data-node-id="${leaf.id}"]`)).not.toBeNull();
});
