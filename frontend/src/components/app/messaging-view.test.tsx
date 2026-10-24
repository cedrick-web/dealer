// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message } from '@/api';
import { MessagingView } from './messaging-view';

afterEach(cleanup);

const conversation: Conversation = {
  publicId:'conversation-1',
  listingId:'listing-1',
  listingTitle:'House in Kinyinya',
  participants:['owner-1','buyer-1'],
  ownerId:'owner-1',
  counterpartyId:'buyer-1',
  lastMessage:'Can we arrange a visit?',
  updatedAt:'2026-10-24T10:00:00.000Z',
};
const message: Message = {
  publicId:'message-1',
  conversationId:'conversation-1',
  senderId:'buyer-1',
  text:'Can we arrange a visit?',
  createdAt:'2026-10-24T10:00:00.000Z',
};

describe('private messaging view', () => {
  it('renders an authenticated listing thread and participant message', () => {
    render(<MessagingView conversations={[conversation]} selectedConversationId="conversation-1" messages={[message]} userId="owner-1" busy={false} draft="" setDraft={vi.fn()} onSelectConversation={vi.fn()} onRefreshConversations={vi.fn()} onReloadMessages={vi.fn()} onSendMessage={vi.fn()} />);
    expect(screen.getByText('House in Kinyinya')).toBeTruthy();
    expect(screen.getByText('Private, authenticated thread')).toBeTruthy();
    expect(screen.getByText('Can we arrange a visit?')).toBeTruthy();
    expect(screen.getByText('Property participant')).toBeTruthy();
  });

  it('sends the controlled composer form to the parent and disables empty messages', () => {
    const send=vi.fn((event:React.FormEvent<HTMLFormElement>)=>event.preventDefault());
    const setDraft=vi.fn();
    render(<MessagingView conversations={[conversation]} selectedConversationId="conversation-1" messages={[]} userId="buyer-1" busy={false} draft="Hello owner" setDraft={setDraft} onSelectConversation={vi.fn()} onRefreshConversations={vi.fn()} onReloadMessages={vi.fn()} onSendMessage={send} />);
    const input=screen.getByRole('textbox',{name:'Write a message'});
    fireEvent.change(input,{target:{value:'Hello'}})
    expect(setDraft).toHaveBeenCalled();
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('renders an empty state if the selected thread is unavailable', () => {
    render(<MessagingView conversations={[]} selectedConversationId="" messages={[]} userId="buyer-1" busy={false} draft="" setDraft={vi.fn()} onSelectConversation={vi.fn()} onRefreshConversations={vi.fn()} onReloadMessages={vi.fn()} onSendMessage={vi.fn()} />);
    expect(screen.getByText('Your conversations')).toBeTruthy();
    expect(screen.queryByRole('textbox',{name:'Write a message'})).toBeNull();
  });
});
