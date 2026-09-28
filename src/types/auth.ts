export type UserRole = 'admin' | 'manager' | 'cashier';

export interface UserCredential {
  username: string;
  role: UserRole;
  displayName: string;
}

export interface AuthSession {
  user: UserCredential;
  loginTime: Date;
  sessionToken: string;
}

export function can(role: UserRole, action: 'manage_menu' | 'view_analytics' | 'settings'): boolean {
  return role === 'admin' || role === 'manager';
}
