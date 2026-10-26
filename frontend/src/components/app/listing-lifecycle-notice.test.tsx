// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '@/api';
import { ListingLifecycleNotice } from './listing-lifecycle-notice';

afterEach(cleanup);

const listing: Listing = {
  publicId: 'listing-1', title: 'Three bedroom home in Gasabo',
  description: 'A property listing with sufficient descriptive information for a review.',
  propertyType: 'house', purpose: 'sale',
  location: { district: 'Gasabo', sector: 'Kinyinya' },
  price: { amount: 180000000, currency: 'RWF', period: 'once' },
  status: 'rejected', reviewNote: 'Please provide updated ownership evidence.',
};

describe('listing lifecycle notice', () => {
  it('shows reviewer feedback and offers correction for rejected listings', () => {
    const onEdit = vi.fn();
    const onWithdraw = vi.fn();
    render(<ListingLifecycleNotice listing={listing} onEdit={onEdit} onWithdraw={onWithdraw} />);

    expect(screen.getByText('Not approved')).toBeTruthy();
    expect(screen.getByText('Please provide updated ownership evidence.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Correct & resubmit' }));
    expect(onEdit).toHaveBeenCalledWith(listing);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(onWithdraw).toHaveBeenCalledWith(listing);
  });

  it('does not offer invalid edit or withdraw actions for withdrawn listings', () => {
    render(<ListingLifecycleNotice listing={{ ...listing, status: 'withdrawn' }} onEdit={vi.fn()} onWithdraw={vi.fn()} />);
    expect(screen.getByText('Withdrawn')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit|correct|withdraw/i })).toBeNull();
  });

  it('explains that editing a published listing pauses public visibility', () => {
    render(<ListingLifecycleNotice listing={{ ...listing, status: 'published', reviewNote: '' }} onEdit={vi.fn()} onWithdraw={vi.fn()} />);
    expect(screen.getByText(/Editing it will pause visibility until the revised version is reviewed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit & resubmit' })).toBeTruthy();
  });
});
