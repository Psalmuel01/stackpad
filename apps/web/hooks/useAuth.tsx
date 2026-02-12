'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { AppConfig, UserSession, showConnect } from '@stacks/connect';

interface AuthContextType {
    userSession: UserSession | null;
    isAuthenticated: boolean;
    userAddress: string | null;
    connectWallet: () => void;
    disconnectWallet: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [userSession, setUserSession] = useState<UserSession | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [userAddress, setUserAddress] = useState<string | null>(null);

    useEffect(() => {
        const appConfig = new AppConfig(['store_write', 'publish_data']);
        const session = new UserSession({ appConfig });
        setUserSession(session);
        const networkKey = getStacksNetworkKey();

        if (session.isUserSignedIn()) {
            setIsAuthenticated(true);
            const userData = session.loadUserData();
            setUserAddress(resolveUserAddress(userData, networkKey));
        } else if (session.isSignInPending()) {
            session.handlePendingSignIn().then((userData) => {
                setIsAuthenticated(true);
                setUserAddress(resolveUserAddress(userData, networkKey));
            }).catch((error) => {
                console.error('Failed to complete pending sign-in:', error);
            });
        }
    }, []);

    const connectWallet = () => {
        if (!userSession) {
            console.error('UserSession not initialized');
            return;
        }

        showConnect({
            appDetails: {
                name: 'Stackpad',
                icon: window.location.origin + '/favicon.ico',
            },
            redirectTo: '/',
            onFinish: () => {
                const userData = userSession.loadUserData();
                setIsAuthenticated(true);
                setUserAddress(resolveUserAddress(userData, getStacksNetworkKey()));
            },
            userSession,
        });
    };

    const disconnectWallet = () => {
        if (userSession) {
            userSession.signUserOut();
        }
        setIsAuthenticated(false);
        setUserAddress(null);
    };

    return (
        <AuthContext.Provider
            value={{
                userSession,
                isAuthenticated,
                userAddress,
                connectWallet,
                disconnectWallet,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

function getStacksNetworkKey(): 'testnet' | 'mainnet' {
    return process.env.NEXT_PUBLIC_STACKS_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

function resolveUserAddress(userData: any, network: 'testnet' | 'mainnet'): string | null {
    const addresses = userData?.profile?.stxAddress as { testnet?: string; mainnet?: string } | undefined;
    if (!addresses) {
        return null;
    }

    return addresses[network] || addresses.testnet || addresses.mainnet || null;
}
