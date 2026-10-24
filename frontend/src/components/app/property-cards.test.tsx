// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Listing } from '@/api';
import { PropertyImage } from './property-cards';

afterEach(cleanup);

const listing: Listing = {
  publicId: 'listing-without-photos',
  ownerId: 'owner-1',
  title: 'Property listing without photos',
  description: 'A complete description with no seller-uploaded photographs attached to this property listing.',
  propertyType: 'house',
  purpose: 'sale',
  location: {district:'Gasabo',sector:'Kinyinya'},
  price: {amount:120000000,currency:'RWF',period:'once'},
  status: 'published',
  images: [],
};

describe('property image provenance', () => {
  it('shows an explicit no-photo state without generating stock image URLs', () => {
    render(<PropertyImage item={listing} />);
    expect(screen.getByText('No seller photo')).toBeTruthy();
    expect(screen.getByText('No seller photo has been uploaded')).toBeTruthy();
    expect(screen.queryByText(/Unsplash|illustrative image/i)).toBeNull();
  });
});
