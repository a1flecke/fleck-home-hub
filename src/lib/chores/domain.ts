export type ChoreState = 'todo' | 'pending_verification' | 'needs_rework' | 'verified';
export type ChoreAction = 'submit' | 'verify' | 'rework';
export type ChoreRole = 'parent' | 'kid';

export function transition(state: ChoreState, action: ChoreAction, role: ChoreRole): ChoreState {
  if ((state === 'todo' || state === 'needs_rework') && action === 'submit' && role === 'kid') return 'pending_verification';
  if (state === 'pending_verification' && role === 'parent') {
    if (action === 'verify') return 'verified';
    if (action === 'rework') return 'needs_rework';
  }
  throw new Error('Invalid chore transition');
}
