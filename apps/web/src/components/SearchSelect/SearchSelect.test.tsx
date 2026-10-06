import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchSelect, type SelectOption, searchOptions } from './SearchSelect';

const options: SelectOption[] = [
  { value: 'text', label: 'Plain text', keywords: ['text', 'txt'] },
  { value: 'c', label: 'C', keywords: ['c'] },
  { value: 'css', label: 'CSS', keywords: ['css'] },
  { value: 'docker', label: 'Dockerfile', keywords: ['docker', 'dockerfile'] },
  { value: 'typescript', label: 'TypeScript', keywords: ['typescript', 'ts'] },
];

function show(value = 'text') {
  const onChange = vi.fn();
  render(
    <>
      <span id="label">Language</span>
      <SearchSelect
        labelId="label"
        title="Code language"
        searchLabel="Search languages"
        emptyText="No language matches."
        options={options}
        value={value}
        onChange={onChange}
      />
    </>,
  );
  return onChange;
}

const labels = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('searchOptions', () => {
  it('keeps the given order without a search', () => {
    expect(searchOptions(options, '  ')).toEqual(options);
  });
  it('puts an exact name or alias ahead of names that only contain the search', () => {
    expect(searchOptions(options, 'c').map((option) => option.value)).toEqual([
      'c',
      'css',
      'docker',
      'typescript',
    ]);
    expect(searchOptions(options, 'TS')[0]?.value).toBe('typescript');
  });
});

describe('SearchSelect', () => {
  it('names its field with the chosen option and opens the list on it', () => {
    show('css');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Language CSS' }));
    expect(screen.getByRole('dialog', { name: 'Code language' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CSS' })).toHaveAttribute('aria-selected', 'true');
    expect(labels()).toHaveLength(options.length);
  });

  it('narrows the list by a search and takes a tapped option', () => {
    const onChange = show();
    fireEvent.click(screen.getByRole('button', { name: 'Language Plain text' }));
    const search = screen.getByRole('combobox', { name: 'Search languages' });
    fireEvent.change(search, { target: { value: 'dock' } });
    expect(labels()).toEqual(['Dockerfile']);
    fireEvent.click(screen.getByRole('option', { name: 'Dockerfile' }));
    expect(onChange).toHaveBeenCalledWith('docker');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes the best match on Enter and the next ones with the arrow keys', () => {
    const onChange = show();
    fireEvent.click(screen.getByRole('button', { name: 'Language Plain text' }));
    const search = screen.getByRole('combobox', { name: 'Search languages' });
    fireEvent.change(search, { target: { value: 'c' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'CSS' }).id,
    );
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('says when nothing matches and changes nothing when dismissed', () => {
    const onChange = show();
    fireEvent.click(screen.getByRole('button', { name: 'Language Plain text' }));
    const search = screen.getByRole('combobox', { name: 'Search languages' });
    fireEvent.change(search, { target: { value: 'cobol' } });
    expect(screen.getByText('No language matches.')).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
