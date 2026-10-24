// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Listing, Lead, Deal } from '@/api';
import { DashboardView } from './dashboard-view';

afterEach(cleanup);

const listing: Listing = {
  publicId:'listing-1',
  ownerId:'owner-1',
  title:'Three bedroom home',
  description:'A detailed property description for the dashboard summary component test.',
  propertyType:'house',
  purpose:'sale',
  location:{district:'Gasabo',sector:'Kinyinya'},
  price:{amount:120000000,currency:'RWF',period:'once'},
  status:'pending_review',
  images:[],
};
const lead: Lead = {
  publicId:'lead-1',listingId:'listing-1',listingTitle:'Three bedroom home',
  ownerId:'owner-1',requesterId:'buyer-1',type:'viewing',
  message:'Request a viewing this weekend.',status:'open',createdAt:'2026-10-24T10:00:00.000Z',
};
const deal: Deal = {
  publicId:'deal-1',listingId:'listing-1',listingTitle:'Three bedroom home',
  participants:['owner-1','buyer-1'],commissionPercent:3,commissionTerms:'Commission terms agreed for test purposes.',
  feeAcceptedBy:['owner-1'],stage:'proposed',history:[],updatedAt:'2026-10-24T10:00:00.000Z',
};

describe('account dashboard', () => {
  it('renders live account counts and the latest listing without inserting inventory', () => {
    render(<DashboardView firstName="Aline" listings={[listing]} savedCount={2} conversationCount={1} deals={[deal]} leads={[lead]} activityTableView={true} onToggleActivityTableView={vi.fn()} onViewListings={vi.fn()} onOpenMessages={vi.fn()} />);
    expect(screen.getByText('Good day, Aline.')).toBeTruthy();
    expect(screen.getByText('Three bedroom home')).toBeTruthy();
    expect(screen.getByText('Your listings').parentElement?.textContent).toContain('1');
    expect(screen.getByText('Saved properties').parentElement?.textContent).toContain('2');
  });

  it('switches recent activity between table and compact list', () => {
    const toggle=vi.fn();
    render(<DashboardView firstName="Aline" listings={[]} savedCount={0} conversationCount={0} deals={[]} leads={[lead]} activityTableView={true} onToggleActivityTableView={toggle} onViewListings={vi.fn()} onOpenMessages={vi.fn()} />);
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/Compact list/}));
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
