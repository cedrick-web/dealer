// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { AdminAuditView } from './admin-audit-view';

vi.mock('@/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api')>();
  return { ...actual, api: { ...actual.api, adminAudit: vi.fn() } };
});

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const events = [{
  eventId: 'event-1',
  type: 'document.reviewed',
  subjectId: 'document-public-id-123456',
  actorId: 'admin-public-id-123456',
  decision: 'approve',
  note: 'Reviewed uploaded title document',
  evidenceHash: 'a'.repeat(64),
  createdAt: '2026-10-26T08:00:00.000Z',
}];

describe('admin audit view', () => {
  it('renders sanitized audit metadata and digest without exposing file content', async () => {
    vi.mocked(api.adminAudit).mockResolvedValue({ data: events, limit: 100, count: 1 });
    render(<AdminAuditView />);

    expect(await screen.findByText('document.reviewed')).toBeTruthy();
    expect(screen.getByText('approve')).toBeTruthy();
    expect(screen.getByText('Reviewed uploaded title document')).toBeTruthy();
    expect(screen.getByText('aaaaaaaaaaaa…')).toBeTruthy();
    expect(screen.queryByText('ci.pdf')).toBeNull();
    expect(api.adminAudit).toHaveBeenCalledWith({ limit: 100 });
  });

  it('applies the exact event type filter without resetting it to all events', async () => {
    vi.mocked(api.adminAudit).mockResolvedValue({ data: events, limit: 100, count: 1 });
    render(<AdminAuditView />);

    await screen.findByText('document.reviewed');
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by exact event type' }), { target: { value: 'document.reviewed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }));

    await waitFor(() => expect(api.adminAudit).toHaveBeenLastCalledWith({ limit: 100, type: 'document.reviewed' }));
    expect(screen.getByText('document.reviewed')).toBeTruthy();
  });

  it('shows a recoverable error if the protected endpoint rejects the request', async () => {
    vi.mocked(api.adminAudit).mockRejectedValue(new Error('Administrator access required'));
    render(<AdminAuditView />);

    expect(await screen.findByText('Audit feed unavailable')).toBeTruthy();
    expect(screen.getByText('Administrator access required')).toBeTruthy();
  });
});
