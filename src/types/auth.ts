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

export type AdminOverrideScope = 'order:void' | 'menu:add' | 'menu:update' | 'menu:delete' | 'settings:write';

export interface AdminOverrideGrant {
    authorizationToken: string;
    adminUsername: string;
    scope: AdminOverrideScope;
}

export function can(role: UserRole, _action: 'manage_menu' | 'view_analytics' | 'settings'): boolean {
    return role === 'admin' || role === 'manager';
}
