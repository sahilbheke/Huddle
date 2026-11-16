/** Types for direct (one-to-one) messages. */

export type DmSummary = {
  thread_id: string;
  other_id: string;
  other_name: string;
  last_body: string | null;
  last_at: string;
  unread: number;
};

export type DmMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type DmContact = { user_id: string; name: string };

/** 12 Nov, or the time if it was today. */
export function whenShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
