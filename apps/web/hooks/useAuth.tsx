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

        if (session.isUserSignedIn()) {
            setIsAuthenticated(true);
            const userData = session.loadUserData();
            setUserAddress(userData.profile.stxAddress.testnet);
        } else if (session.isSignInPending()) {
            session.handlePendingSignIn().then((userData) => {
                setIsAuthenticated(true);
                setUserAddress(userData.profile.stxAddress.testnet);
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
                name: 'eBook Platform',
                icon: window.location.origin + '/favicon.ico', // Use default favicon
            },
            redirectTo: '/',
            onFinish: () => {
                const userData = userSession.loadUserData();
                setIsAuthenticated(true);
                setUserAddress(userData.profile.stxAddress.testnet);
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
