// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

describe('Dealer application shell', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return jsonResponse({ status: 'ok', service: 'komisiyoneri-api', database: 'connected' });
      }
      if (url.includes('/api/v1/districts')) {
        return jsonResponse({ data: ['Gasabo', 'Kicukiro', 'Nyarugenge'] });
      }
      if (url.includes('/api/v1/agents')) {
        return jsonResponse({ data: [] });
      }
      if (/\/api\/v1\/listings\/[^/?]+$/.test(url)) {
        return jsonResponse({ data: {
          publicId: 'listing-share-123',
          ownerId: 'owner-1',
          title: 'Shareable Kigali apartment',
          description: 'A directly addressable listing for route regression coverage.',
          propertyType: 'apartment',
          purpose: 'rent',
          location: { district: 'Gasabo', sector: 'Remera' },
          price: { amount: 250000, currency: 'RWF', period: 'month' },
          status: 'published',
          images: [],
        } });
      }
      if (url.includes('/api/v1/listings')) {
        return jsonResponse({ data: [], page: 1, limit: 60, total: 0, hasMore: false });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders a usable desktop and mobile navigation shell', () => {
    render(<App />);
    expect(screen.getByRole('navigation', { name: 'Quick navigation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Notifications, 0 unread/ })).toBeTruthy();
    expect(screen.getByText('DEALER')).toBeTruthy();
  });

  it('keeps workspace navigation in the URL and supports browser history', async () => {
    window.history.replaceState({}, '', '/messages');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Private conversations/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to discover' }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { name: /Find a property with a clearer record/i })).toBeTruthy();
    window.history.pushState({}, '', '/messages');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { name: /Private conversations/i })).toBeTruthy();
  });

  it('loads a shareable property URL directly and keeps it addressable after refresh', async () => {
    window.history.replaceState({}, '', '/property/listing-share-123');
    const { unmount } = render(<App />);
    expect(await waitFor(() => expect(screen.getAllByText('Shareable Kigali apartment').length).toBeGreaterThan(0))).toBeTruthy();
    expect(window.location.pathname).toBe('/property/listing-share-123');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/listings/listing-share-123'),
      expect.anything(),
    );
    unmount();
    window.history.replaceState({}, '', '/property/listing-share-123');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Shareable Kigali apartment' })).toBeTruthy();
    expect(window.location.pathname).toBe('/property/listing-share-123');
  });

  it('does not present imaginary homes when the API has no published inventory', async () => {
    render(<App />);
    expect(await screen.findByText('No published properties match yet')).toBeTruthy();
    expect(screen.queryByText('Contemporary family home in a quiet neighborhood')).toBeNull();
    expect(screen.getByText(/Only published listings from the API appear here/)).toBeTruthy();
  });

  it('sends the maximum RWF budget to the API instead of filtering only the first page locally', async () => {
    render(<App />);
    await screen.findByText('No published properties match yet');
    const budget = screen.getByLabelText('Maximum price in Rwandan francs');
    fireEvent.change(budget, { target: { value: '100000000' } });
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('maxPrice=100000000'),
        expect.anything(),
      );
    });
  });

  it('uses empty results honestly while allowing the buy and rent filter controls', async () => {
    render(<App />);
    await screen.findByText('No published properties match yet');
    screen.getByRole('tab', { name: 'Rent' }).click();
    expect(screen.getByRole('tab', { name: 'Rent' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Buy' })).toBeTruthy();
  });
});
