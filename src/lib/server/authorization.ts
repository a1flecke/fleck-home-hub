export type Principal = { householdId: string; role: 'parent' | 'kid' };

export function authorize(principal: Principal | null, householdId: string, action: 'read' | 'manage'): boolean {
  return principal !== null && principal.householdId === householdId &&
    (action === 'read' || principal.role === 'parent');
}
