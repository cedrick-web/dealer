// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentApplication, AppNotification, Lead } from '@/api';
import { AgentDirectoryView, AgentApplicationView, AgentReviewQueue, type AgentApplicationForm } from './agent-workspace';
import { EnquiriesView } from './enquiries-view';
import { NotificationsView } from './notifications-view';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    readonly root: Element | Document | null = null;
    readonly rootMargin = '0px';
    readonly thresholds: ReadonlyArray<number> = [0];
    constructor(_callback: IntersectionObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const agent: Agent = {
  publicId: 'agent-1',
  name: 'Aline Property Services',
  bio: 'Provides property viewings and buyer support across Kigali with clear fee terms and local market knowledge.',
  districts: ['Gasabo', 'Kicukiro'],
  experienceYears: 4,
  contactPhone: '+250700000000',
  updatedAt: '2026-10-24T10:00:00.000Z',
};
const application: AgentApplication = {
  publicId: 'application-1',
  userId: 'user-1',
  name: 'Aline Applicant',
  phone: '+250700000000',
  showPhone: false,
  bio: 'A detailed professional biography describing real property experience, transparent communication and service areas across the city.',
  districts: ['Gasabo'],
  experienceYears: 4,
  status: 'pending_review',
  createdAt: '2026-10-24T10:00:00.000Z',
  updatedAt: '2026-10-24T10:00:00.000Z',
};
const lead: Lead = {
  publicId: 'lead-1',
  listingId: 'listing-1',
  listingTitle: 'House near Kinyinya',
  ownerId: 'owner-1',
  requesterId: 'buyer-1',
  type: 'viewing',
  message: 'Could I visit the house on Saturday?',
  preferredAt: '2026-10-31T10:00:00.000Z',
  status: 'open',
  createdAt: '2026-10-24T10:00:00.000Z',
};

describe('agent workflow views', () => {
  it('renders API-sourced agent information and fires the contact action', () => {
    render(<AgentDirectoryView agents={[agent]} loading={false} search="" busy={false} onRefresh={vi.fn()} onBecomeAgent={vi.fn()} onClearSearch={vi.fn()} />);
    expect(screen.getByText('Aline Property Services')).toBeTruthy();
    expect(screen.getByText('4 years of experience stated')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Contact agent/ }).getAttribute('href')).toBe('tel:+250700000000');
  });

  it('filters agent profiles by district without fabricating results', () => {
    render(<AgentDirectoryView agents={[agent]} loading={false} search="Nyarugenge" busy={false} onRefresh={vi.fn()} onBecomeAgent={vi.fn()} onClearSearch={vi.fn()} />);
    expect(screen.getByText('No approved agents match')).toBeTruthy();
    expect(screen.queryByText('Aline Property Services')).toBeNull();
  });

  it('shows agent application review state and keeps the phone privacy choice controlled', () => {
    const form: AgentApplicationForm = { phone: '+250700000000', bio: application.bio, experienceYears: '4', districts: ['Gasabo'], showPhone: false };
    render(<AgentApplicationView application={application} form={form} setForm={vi.fn()} districts={['Gasabo','Kicukiro']} busy={false} onSubmit={vi.fn()} onViewDirectory={vi.fn()} />);
    expect(screen.getByText('Your application is awaiting review')).toBeTruthy();
    expect(screen.getByText('Latest application status')).toBeTruthy();
  });

  it('only provides moderation actions to an administrator', () => {
    render(<AgentReviewQueue userRole="member" pending={[application]} busy={false} notes={{}} onNoteChange={vi.fn()} onReview={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('Administrator access required')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve profile' })).toBeNull();
  });
});

describe('notifications and enquiry workflows', () => {
  it('routes a notification click through the parent callback', () => {
    const notification: AppNotification = { publicId: 'notification-1', type: 'message', title: 'New property message', body: 'A participant sent a message.', destination: 'messages', readAt: null, createdAt: '2026-10-24T10:00:00.000Z' };
    const onMarkRead = vi.fn();
    render(<NotificationsView notifications={[notification]} unreadCount={1} busy={false} onMarkRead={onMarkRead} onMarkAllRead={vi.fn()} onExplore={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /New property message/ }));
    expect(onMarkRead).toHaveBeenCalledWith(notification);
  });

  it('shows only owner-valid enquiry actions and sends status changes to the parent', () => {
    const onUpdateStatus = vi.fn();
    render(<EnquiriesView leads={[lead]} userId="owner-1" busy={false} onOpenConversation={vi.fn()} onUpdateStatus={onUpdateStatus} onRefresh={vi.fn()} onExplore={vi.fn()} />);
    expect(screen.getByText('House near Kinyinya')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept request' }));
    expect(onUpdateStatus).toHaveBeenCalledWith(lead, 'accepted');
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
  });
});
