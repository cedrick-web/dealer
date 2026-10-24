// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@/api';
import { DealWorkspaceView } from './deal-workspace';

afterEach(cleanup);

const deal: Deal = {
  publicId: 'deal-1',
  listingId: 'listing-1',
  listingTitle: 'Three-bedroom house in Gasabo',
  participants: ['owner-1','buyer-1'],
  commissionPercent: 3,
  commissionTerms: 'Three percent of the agreed transaction price, payable according to the written agreement signed by both parties.',
  feeAcceptedBy: ['owner-1','buyer-1'],
  completionConfirmedBy: ['owner-1'],
  stage: 'agreement',
  history: [{stage:'proposed',actorId:'owner-1',at:'2026-10-20T10:00:00.000Z',note:'Terms drafted'}],
  updatedAt: '2026-10-24T10:00:00.000Z',
};

describe('deal workspace', () => {
  it('explains two-party completion and allows only the other party to confirm', () => {
    const onUpdateStage = vi.fn();
    render(<DealWorkspaceView deals={[deal]} userId="buyer-1" busy={false} onAcceptFee={vi.fn()} onUpdateStage={onUpdateStage} onFindProperty={vi.fn()} />);
    expect(screen.getByText('The other participant has confirmed completion')).toBeTruthy();
    const milestone = screen.getByLabelText('Update milestone');
    expect(Array.from((milestone as HTMLSelectElement).options).some(option => option.value === 'completed')).toBe(true);
    fireEvent.change(milestone, {target:{value:'completed'}});
    expect(onUpdateStage).toHaveBeenCalledWith(deal, 'completed');
  });

  it('does not offer a duplicate completion confirmation to the party who already confirmed', () => {
    render(<DealWorkspaceView deals={[deal]} userId="owner-1" busy={false} onAcceptFee={vi.fn()} onUpdateStage={vi.fn()} onFindProperty={vi.fn()} />);
    const milestone = screen.getByLabelText('Update milestone') as HTMLSelectElement;
    expect(Array.from(milestone.options).some(option => option.value === 'completed')).toBe(false);
    expect(screen.getByText('Your completion confirmation is saved')).toBeTruthy();
  });

  it('does not allow commission acknowledgement once a deal is completed', () => {
    render(<DealWorkspaceView deals={[{...deal,stage:'completed'}]} userId="buyer-1" busy={false} onAcceptFee={vi.fn()} onUpdateStage={vi.fn()} onFindProperty={vi.fn()} />);
    expect((screen.getByRole('button',{name:/Accepted/}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });
});
