import { describe, expect, it } from 'vitest';
import { Cl } from '@stacks/transactions';

const accounts = simnet.getAccounts();
const deployer = accounts.get('deployer')!;
const wallet1 = accounts.get('wallet_1')!;
const wallet2 = accounts.get('wallet_2')!;
const wallet3 = accounts.get('wallet_3')!;

describe('reading-wallet', () => {
  it('allows readers to deposit and withdraw prepaid balance', () => {
    const deposit = simnet.callPublicFn(
      'reading-wallet',
      'deposit',
      [Cl.uint(1000)],
      wallet1
    );

    expect(deposit.result).toBeOk(Cl.uint(1000));

    const balanceAfterDeposit = simnet.callReadOnlyFn(
      'reading-wallet',
      'get-reader-balance',
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balanceAfterDeposit.result).toBeOk(Cl.uint(1000));

    const withdraw = simnet.callPublicFn(
      'reading-wallet',
      'withdraw',
      [Cl.uint(400)],
      wallet1
    );

    expect(withdraw.result).toBeOk(Cl.uint(600));

    const balanceAfterWithdraw = simnet.callReadOnlyFn(
      'reading-wallet',
      'get-reader-balance',
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balanceAfterWithdraw.result).toBeOk(Cl.uint(600));
  });

  it('restricts operator debits and prevents duplicate settlements', () => {
    const deposit = simnet.callPublicFn(
      'reading-wallet',
      'deposit',
      [Cl.uint(3000)],
      wallet1
    );
    expect(deposit.result).toBeOk(Cl.uint(3000));

    const unauthorizedDebit = simnet.callPublicFn(
      'reading-wallet',
      'operator-debit',
      [Cl.principal(wallet1), Cl.uint(500), Cl.uint(1)],
      wallet2
    );
    expect(unauthorizedDebit.result).toBeErr(Cl.uint(300));

    const setOperator = simnet.callPublicFn(
      'reading-wallet',
      'set-operator',
      [Cl.principal(wallet2)],
      deployer
    );
    expect(setOperator.result).toBeOk(Cl.bool(true));

    const debit = simnet.callPublicFn(
      'reading-wallet',
      'operator-debit',
      [Cl.principal(wallet1), Cl.uint(500), Cl.uint(1)],
      wallet2
    );
    expect(debit.result).toBeOk(Cl.uint(2500));

    const duplicateDebit = simnet.callPublicFn(
      'reading-wallet',
      'operator-debit',
      [Cl.principal(wallet1), Cl.uint(200), Cl.uint(1)],
      wallet2
    );
    expect(duplicateDebit.result).toBeErr(Cl.uint(303));
  });

  it('allows operator payouts from pooled contract balance', () => {
    const deposit = simnet.callPublicFn(
      'reading-wallet',
      'deposit',
      [Cl.uint(5000)],
      wallet1
    );
    expect(deposit.result).toBeOk(Cl.uint(5000));

    const setOperator = simnet.callPublicFn(
      'reading-wallet',
      'set-operator',
      [Cl.principal(wallet2)],
      deployer
    );
    expect(setOperator.result).toBeOk(Cl.bool(true));

    const payout = simnet.callPublicFn(
      'reading-wallet',
      'operator-payout',
      [Cl.principal(wallet3), Cl.uint(1000), Cl.uint(77)],
      wallet2
    );
    expect(payout.result).toBeOk(Cl.bool(true));

    const duplicatePayout = simnet.callPublicFn(
      'reading-wallet',
      'operator-payout',
      [Cl.principal(wallet3), Cl.uint(500), Cl.uint(77)],
      wallet2
    );
    expect(duplicatePayout.result).toBeErr(Cl.uint(303));
  });
});
