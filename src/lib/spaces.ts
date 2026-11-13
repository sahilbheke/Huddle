export type Template = 'fitness' | 'study' | 'work' | 'custom';
export type Role = 'owner' | 'admin' | 'member';

export const TEMPLATES: { key: Template; label: string; blurb: string }[] = [
  { key: 'fitness', label: 'Fitness', blurb: 'Running, cycling, swimming, push-ups, pull-ups, workouts' },
  { key: 'study', label: 'Study', blurb: 'Chapters, questions solved, mock tests, study time' },
  { key: 'work', label: 'Work', blurb: 'Deals closed, client meetings, calls' },
  { key: 'custom', label: 'Other', blurb: 'One simple check-in with a written note' },
];

export const roleLabel = (role: Role) => (role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member');

export type Space = {
  id: string;
  name: string;
  template: Template;
  owner_id: string;
  rest_days_per_week: number;
  posts_per_hour: number;
  chat_enabled: boolean;
  photos_enabled: boolean;
  invite_code: string;
};

/** Accepts a bare code or a whole invite link, and returns the code. */
export function codeFrom(input: string) {
  const trimmed = input.trim();
  const fromLink = trimmed.match(/join\/([a-z0-9]+)/i);
  return (fromLink ? fromLink[1] : trimmed).toLowerCase();
}
