// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '@/api';
import { ListingReviewQueue } from './listing-review-queue';

afterEach(cleanup);

const listing: Listing = {
  publicId:'pending-listing-1',
  ownerId:'owner-1',
  title:'House pending review in Gasabo',
  description:'A detailed property description with sufficient information for a human moderation review.',
  propertyType:'house',
  purpose:'sale',
  location:{district:'Gasabo',sector:'Kinyinya'},
  price:{amount:180000000,currency:'RWF',period:'once'},
  status:'pending_review',
  images:[],
};

describe('listing review queue', () => {
  it('does not expose moderation actions to a regular member', () => {
    render(<ListingReviewQueue userRole="member" pending={[listing]} busy={false} notes={{}} onNoteChange={vi.fn()} onReview={vi.fn()} onOpenEvidence={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('Administrator access required')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Approve'})).toBeNull();
  });

  it('sends the selected review decision to the API-owning parent callback', () => {
    const onReview=vi.fn();
    render(<ListingReviewQueue userRole="admin" pending={[listing]} busy={false} notes={{}} onNoteChange={vi.fn()} onReview={onReview} onOpenEvidence={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('House pending review in Gasabo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Approve'}));
    expect(onReview).toHaveBeenCalledWith(listing,'approve');
  });
});
