// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './badge';
import { Button } from './button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { cn } from '@/lib/utils';

afterEach(cleanup);

describe('shared UI primitives', () => {
  it('renders an accessible button and preserves its click contract', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Approve listing</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Approve listing' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes semantic badge state without custom application markup', () => {
    render(<Badge variant="success">Published</Badge>);
    expect(screen.getByText('Published').getAttribute('data-slot')).toBe('badge');
  });

  it('renders a semantic table with headers and row values', () => {
    render(
      <Table>
        <TableHeader><TableRow><TableHead>Property</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell>Sector house</TableCell><TableCell>Pending review</TableCell></TableRow></TableBody>
      </Table>,
    );
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Property' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Sector house' })).toBeTruthy();
  });

  it('merges conflicting Tailwind classes instead of emitting duplicates', () => {
    const merged = cn('px-2 py-1 text-xs', 'px-4 text-sm');
    expect(merged).toContain('px-4');
    expect(merged).toContain('text-sm');
    expect(merged).not.toContain('px-2');
    expect(merged).not.toContain('text-xs');
  });
});
