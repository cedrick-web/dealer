import type { FormEventHandler, Dispatch, SetStateAction } from 'react';
import { ChevronRight, House, LockKeyhole, MessageCircle, RefreshCw, Send } from 'lucide-react';
import type { Conversation, Message } from '@/api';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/app/common';
import { dateLabel } from '@/lib/property-format';

export function MessagingView({
  conversations, selectedConversationId, messages, userId, busy, draft, setDraft,
  onSelectConversation, onRefreshConversations, onReloadMessages, onSendMessage,
}:{
  conversations:Conversation[];
  selectedConversationId:string;
  messages:Message[];
  userId?:string;
  busy:boolean;
  draft:string;
  setDraft:Dispatch<SetStateAction<string>>;
  onSelectConversation:(id:string)=>void;
  onRefreshConversations:()=>void;
  onReloadMessages:()=>void;
  onSendMessage:FormEventHandler<HTMLFormElement>;
}) {
  const selected=conversations.find(conversation=>conversation.publicId===selectedConversationId);
  return (
    <section className="view-content">
      <div className="messages-layout">
        <div className="conversation-list panel">
          <div className="panel-heading">
            <div><h3>Conversations</h3><p>{conversations.length} property threads</p></div>
            <button className="icon-button" onClick={onRefreshConversations} aria-label="Refresh conversations" disabled={busy}><RefreshCw size={16}/></button>
          </div>
          {conversations.map(conversation=><button className={'conversation-item '+(selectedConversationId===conversation.publicId?'selected':'')} key={conversation.publicId} onClick={()=>onSelectConversation(conversation.publicId)}>
            <span className="conversation-avatar"><House size={18}/></span>
            <span className="conversation-text"><b>{conversation.listingTitle}</b><small>{conversation.lastMessage||'No messages yet'}</small><em>{dateLabel(conversation.updatedAt)}</em></span>
            <ChevronRight size={15}/>
          </button>)}
          {!conversations.length&&<p className="inline-empty">Open a published property and choose “Message owner” to start a private conversation.</p>}
        </div>
        <div className="message-pane panel">
          {selected ? (
            <>
              <div className="message-header"><span className="conversation-avatar"><House size={17}/></span><div><b>{selected.listingTitle}</b><small><LockKeyhole size={12}/> Private, authenticated thread</small></div><button className="icon-button" onClick={onReloadMessages} aria-label="Reload messages" disabled={busy}><RefreshCw size={15}/></button></div>
              <div className="message-history">
                {messages.map(message=><div className={'message-bubble '+(message.senderId===userId?'own':'other')} key={message.publicId}><p>{message.text}</p><small>{message.senderId===userId?'You':'Property participant'} · {new Date(message.createdAt).toLocaleString()}</small></div>)}
                {!messages.length&&<div className="message-empty"><MessageCircle size={25}/><b>Start with a clear question.</b><p>Ask about viewing times, property details or the disclosed fee arrangement.</p></div>}
              </div>
              <form className="message-composer" onSubmit={onSendMessage}><Textarea aria-label="Write a message" rows={2} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="Write a message…" maxLength={3000}/><button type="submit" disabled={!draft.trim()||busy} className="btn btn-primary" aria-label="Send message"><Send size={17}/></button></form>
            </>
          ) : (
            <EmptyState icon={MessageCircle} title="Your conversations" body="Choose a conversation on the left, or start one from a property listing."/>
          )}
        </div>
      </div>
    </section>
  );
}
