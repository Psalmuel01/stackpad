'use client';

import { useState } from 'react';
import { useAuth } from './useAuth';
import { openSTXTransfer } from '@stacks/connect';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';

interface PaymentResult {
    success: boolean;
    txId?: string;
    error?: string;
}

export function usePayment() {
    const { userSession, userAddress } = useAuth();
    const [isPaying, setIsPaying] = useState(false);

    const initiatePayment = async (
        recipientAddress: string,
        amount: bigint,
        memo: string
    ): Promise<PaymentResult> => {
        if (!userSession || !userAddress) {
            return { success: false, error: 'Wallet not connected' };
        }

        return new Promise((resolve) => {
            setIsPaying(true);

            openSTXTransfer({
                recipient: recipientAddress,
                amount: amount.toString(),
                memo,
                network: process.env.NEXT_PUBLIC_STACKS_NETWORK === 'mainnet' ? STACKS_MAINNET : STACKS_TESTNET,
                appDetails: {
                    name: 'Stackpad',
                    icon: window.location.origin + '/favicon.ico',
                },
                onFinish: (data) => {
                    setIsPaying(false);
                    resolve({
                        success: true,
                        txId: data.txId,
                    });
                },
                onCancel: () => {
                    setIsPaying(false);
                    resolve({
                        success: false,
                        error: 'Payment cancelled',
                    });
                },
            });
        });
    };

    return {
        initiatePayment,
        isPaying,
    };
}
