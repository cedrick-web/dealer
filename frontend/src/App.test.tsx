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
    expect(screen.getByRole('button', { name: 'Rent' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Buy' })).toBeTruthy();
  });
});
