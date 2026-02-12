;; Book Registry Smart Contract
;; Manages book metadata and pricing for the Pay-As-You-Read platform

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-BOOK-NOT-FOUND (err u101))
(define-constant ERR-INVALID-PRICE (err u102))
(define-constant ERR-BOOK-INACTIVE (err u103))
(define-constant ERR-INVALID-TOTALS (err u104))

;; Data variables
(define-data-var next-book-id uint u1)

;; Data maps
(define-map books
  { book-id: uint }
  {
    author: principal,
    title: (string-ascii 100),
    total-pages: uint,
    total-chapters: uint,
    page-price: uint,        ;; Price in microSTX
    chapter-price: uint,     ;; Price in microSTX
    active: bool
  }
)

;; Read-only functions

(define-read-only (get-book-info (book-id uint))
  (map-get? books { book-id: book-id })
)

(define-read-only (get-page-price (book-id uint))
  (match (get-book-info book-id)
    book (ok (get page-price book))
    ERR-BOOK-NOT-FOUND
  )
)

(define-read-only (get-chapter-price (book-id uint))
  (match (get-book-info book-id)
    book (ok (get chapter-price book))
    ERR-BOOK-NOT-FOUND
  )
)

(define-read-only (get-next-book-id)
  (ok (var-get next-book-id))
)

(define-read-only (is-book-active (book-id uint))
  (match (get-book-info book-id)
    book (ok (get active book))
    ERR-BOOK-NOT-FOUND
  )
)

;; Public functions

(define-public (register-book 
    (title (string-ascii 100))
    (total-pages uint)
    (total-chapters uint)
    (page-price uint)
    (chapter-price uint)
  )
  (let
    (
      (book-id (var-get next-book-id))
    )
    ;; Validate prices
    (asserts! (> page-price u0) ERR-INVALID-PRICE)
    (asserts! (> chapter-price u0) ERR-INVALID-PRICE)
    (asserts! (> total-pages u0) ERR-INVALID-TOTALS)
    (asserts! (> total-chapters u0) ERR-INVALID-TOTALS)
    
    ;; Store book data
    (map-set books
      { book-id: book-id }
      {
        author: tx-sender,
        title: title,
        total-pages: total-pages,
        total-chapters: total-chapters,
        page-price: page-price,
        chapter-price: chapter-price,
        active: true
      }
    )
    
    ;; Increment book ID counter
    (var-set next-book-id (+ book-id u1))
    
    (ok book-id)
  )
)

(define-public (update-page-price (book-id uint) (new-price uint))
  (let
    (
      (book (unwrap! (get-book-info book-id) ERR-BOOK-NOT-FOUND))
    )
    ;; Only author can update
    (asserts! (is-eq tx-sender (get author book)) ERR-NOT-AUTHORIZED)
    (asserts! (> new-price u0) ERR-INVALID-PRICE)
    
    ;; Update price
    (map-set books
      { book-id: book-id }
      (merge book { page-price: new-price })
    )
    
    (ok true)
  )
)

(define-public (update-chapter-price (book-id uint) (new-price uint))
  (let
    (
      (book (unwrap! (get-book-info book-id) ERR-BOOK-NOT-FOUND))
    )
    ;; Only author can update
    (asserts! (is-eq tx-sender (get author book)) ERR-NOT-AUTHORIZED)
    (asserts! (> new-price u0) ERR-INVALID-PRICE)
    
    ;; Update price
    (map-set books
      { book-id: book-id }
      (merge book { chapter-price: new-price })
    )
    
    (ok true)
  )
)

(define-public (set-book-active (book-id uint) (active bool))
  (let
    (
      (book (unwrap! (get-book-info book-id) ERR-BOOK-NOT-FOUND))
    )
    ;; Only author can update
    (asserts! (is-eq tx-sender (get author book)) ERR-NOT-AUTHORIZED)
    
    ;; Update active status
    (map-set books
      { book-id: book-id }
      (merge book { active: active })
    )
    
    (ok true)
  )
)
