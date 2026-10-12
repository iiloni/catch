import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { Combobox } from './Combobox';

vi.mock('@/lib/haptics', () => ({ haptics: { selection: vi.fn() } }));

function Field({ options }: { options: string[] }) {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="model">Model</label>
      <Combobox id="model" value={value} onChange={setValue} options={options} listLabel="Models" />
    </>
  );
}
const options = ['nomic-embed-text', 'qwen-embedding', 'bge-m3'];

it('takes any text, and suggests the options that contain it', () => {
  render(<Field options={options} />);
  const field = screen.getByRole('combobox', { name: 'Model' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.change(field, { target: { value: 'embed' } });
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'nomic-embed-text',
    'qwen-embedding',
  ]);
  fireEvent.change(field, { target: { value: 'my-own-model' } });
  expect(field).toHaveValue('my-own-model');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('picks with the pointer or the keyboard, then offers every option again', () => {
  render(<Field options={options} />);
  const field = screen.getByRole('combobox', { name: 'Model' });
  fireEvent.change(field, { target: { value: 'bge' } });
  fireEvent.click(screen.getByRole('option', { name: 'bge-m3' }));
  expect(field).toHaveValue('bge-m3');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')).toHaveLength(3);
  expect(screen.getByRole('option', { name: 'bge-m3' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(field).toHaveValue('qwen-embedding');
  fireEvent.click(screen.getByRole('button', { name: 'Models' }));
  expect(screen.getAllByRole('option')).toHaveLength(3);
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('is a plain field without options, and shows options that arrive', () => {
  const view = render(<Field options={[]} />);
  expect(screen.queryByRole('button', { name: 'Models' })).not.toBeInTheDocument();
  view.rerender(<Field options={options} />);
  expect(screen.getAllByRole('option')).toHaveLength(3);
});
