;; Reading Wallet Contract
;; Pooled prepaid STX balances for pay-as-you-read settlement.

(define-constant ERR-NOT-AUTHORIZED (err u300))
(define-constant ERR-INVALID-AMOUNT (err u301))
(define-constant ERR-INSUFFICIENT-BALANCE (err u302))
(define-constant ERR-SETTLEMENT-ALREADY-PROCESSED (err u303))
(define-constant ERR-TRANSFER-FAILED (err u304))

(define-data-var owner principal tx-sender)
(define-data-var operator principal tx-sender)

(define-map reader-balances
  { reader: principal }
  { amount: uint }
)

(define-map debit-settlements
  { settlement-id: uint }
  { processed: bool }
)

(define-map payout-settlements
  { settlement-id: uint }
  { processed: bool }
)

(define-private (is-authorized)
  (or (is-eq tx-sender (var-get owner)) (is-eq tx-sender (var-get operator)))
)

(define-private (get-balance-or-zero (reader principal))
  (default-to u0 (get amount (map-get? reader-balances { reader: reader })))
)

(define-read-only (get-owner)
  (ok (var-get owner))
)

(define-read-only (get-operator)
  (ok (var-get operator))
)

(define-read-only (get-reader-balance (reader principal))
  (ok (get-balance-or-zero reader))
)

(define-read-only (get-contract-balance)
  (ok (stx-get-balance (as-contract tx-sender)))
)

(define-public (set-operator (new-operator principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED)
    (var-set operator new-operator)
    (ok true)
  )
)

(define-public (deposit (amount uint))
  (let
    (
      (current (get-balance-or-zero tx-sender))
      (contract-principal (as-contract tx-sender))
    )
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (try! (stx-transfer? amount tx-sender contract-principal))
    (map-set reader-balances
      { reader: tx-sender }
      { amount: (+ current amount) }
    )
    (ok (+ current amount))
  )
)

(define-public (withdraw (amount uint))
  (let
    (
      (current (get-balance-or-zero tx-sender))
      (contract-principal (as-contract tx-sender))
      (next-balance (- current amount))
    )
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= current amount) ERR-INSUFFICIENT-BALANCE)
    (map-set reader-balances
      { reader: tx-sender }
      { amount: next-balance }
    )
    (try! (as-contract (stx-transfer? amount contract-principal tx-sender)))
    (ok next-balance)
  )
)

(define-public (operator-debit (reader principal) (amount uint) (settlement-id uint))
  (let
    (
      (current (get-balance-or-zero reader))
      (next-balance (- current amount))
    )
    (asserts! (is-authorized) ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (is-none (map-get? debit-settlements { settlement-id: settlement-id })) ERR-SETTLEMENT-ALREADY-PROCESSED)
    (asserts! (>= current amount) ERR-INSUFFICIENT-BALANCE)
    (map-set reader-balances
      { reader: reader }
      { amount: next-balance }
    )
    (map-set debit-settlements
      { settlement-id: settlement-id }
      { processed: true }
    )
    (ok next-balance)
  )
)

(define-public (operator-payout (recipient principal) (amount uint) (settlement-id uint))
  (let
    (
      (contract-principal (as-contract tx-sender))
    )
    (asserts! (is-authorized) ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (is-none (map-get? payout-settlements { settlement-id: settlement-id })) ERR-SETTLEMENT-ALREADY-PROCESSED)
    (map-set payout-settlements
      { settlement-id: settlement-id }
      { processed: true }
    )
    (try! (as-contract (stx-transfer? amount contract-principal recipient)))
    (ok true)
  )
)
