import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

describe("book-registry", () => {
  it("registers a book and increments the id counter", () => {
    const register = simnet.callPublicFn(
      "book-registry",
      "register-book",
      [
        Cl.stringAscii("The Test Book"),
        Cl.uint(12),
        Cl.uint(3),
        Cl.uint(1000),
        Cl.uint(5000),
      ],
      wallet1
    );

    expect(register.result).toBeOk(Cl.uint(1));

    const nextBookId = simnet.callReadOnlyFn(
      "book-registry",
      "get-next-book-id",
      [],
      wallet1
    );
    expect(nextBookId.result).toBeOk(Cl.uint(2));
  });

  it("rejects invalid totals and prices", () => {
    const zeroPages = simnet.callPublicFn(
      "book-registry",
      "register-book",
      [
        Cl.stringAscii("Broken Book"),
        Cl.uint(0),
        Cl.uint(1),
        Cl.uint(1000),
        Cl.uint(2000),
      ],
      wallet1
    );
    expect(zeroPages.result).toBeErr(Cl.uint(104));

    const zeroPrice = simnet.callPublicFn(
      "book-registry",
      "register-book",
      [
        Cl.stringAscii("Free but blocked"),
        Cl.uint(10),
        Cl.uint(1),
        Cl.uint(0),
        Cl.uint(1000),
      ],
      wallet1
    );
    expect(zeroPrice.result).toBeErr(Cl.uint(102));
  });

  it("only allows the author to update prices", () => {
    const register = simnet.callPublicFn(
      "book-registry",
      "register-book",
      [
        Cl.stringAscii("Author Owned"),
        Cl.uint(8),
        Cl.uint(2),
        Cl.uint(1000),
        Cl.uint(3000),
      ],
      wallet1
    );
    expect(register.result).toBeOk(Cl.uint(1));

    const unauthorized = simnet.callPublicFn(
      "book-registry",
      "update-page-price",
      [Cl.uint(1), Cl.uint(2000)],
      wallet2
    );
    expect(unauthorized.result).toBeErr(Cl.uint(100));

    const authorized = simnet.callPublicFn(
      "book-registry",
      "update-page-price",
      [Cl.uint(1), Cl.uint(2000)],
      wallet1
    );
    expect(authorized.result).toBeOk(Cl.bool(true));
  });
});
