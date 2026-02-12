import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

describe("entitlement", () => {
  it("allows readers to self-unlock a page", () => {
    const unlock = simnet.callPublicFn(
      "entitlement",
      "self-unlock-page",
      [Cl.uint(1), Cl.uint(3)],
      wallet1
    );
    expect(unlock.result).toBeOk(Cl.bool(true));

    const hasAccess = simnet.callReadOnlyFn(
      "entitlement",
      "has-page-access",
      [Cl.principal(wallet1), Cl.uint(1), Cl.uint(3)],
      wallet1
    );
    expect(hasAccess.result).toBeBool(true);
  });

  it("rejects unauthorized unlocks for another reader", () => {
    const unlock = simnet.callPublicFn(
      "entitlement",
      "unlock-page",
      [Cl.principal(wallet1), Cl.uint(2), Cl.uint(1)],
      wallet2
    );
    expect(unlock.result).toBeErr(Cl.uint(200));
  });

  it("allows delegated operator unlocks after owner approval", () => {
    const setOperator = simnet.callPublicFn(
      "entitlement",
      "set-operator",
      [Cl.principal(wallet2)],
      deployer
    );
    expect(setOperator.result).toBeOk(Cl.bool(true));

    const delegatedUnlock = simnet.callPublicFn(
      "entitlement",
      "unlock-chapter",
      [Cl.principal(wallet1), Cl.uint(7), Cl.uint(4)],
      wallet2
    );
    expect(delegatedUnlock.result).toBeOk(Cl.bool(true));

    const hasChapterAccess = simnet.callReadOnlyFn(
      "entitlement",
      "has-chapter-access",
      [Cl.principal(wallet1), Cl.uint(7), Cl.uint(4)],
      wallet1
    );
    expect(hasChapterAccess.result).toBeBool(true);
  });
});
