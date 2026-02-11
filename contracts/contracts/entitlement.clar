;; Entitlement Smart Contract
;; Tracks page and chapter access rights for readers

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u200))
(define-constant ERR-ALREADY-UNLOCKED (err u201))
(define-constant ERR-INVALID-PAYMENT (err u202))

;; Data maps for tracking access

(define-map page-access
  { reader: principal, book-id: uint, page-num: uint }
  { unlocked-at: uint }  ;; Block height
)

(define-map chapter-access
  { reader: principal, book-id: uint, chapter-num: uint }
  { unlocked-at: uint }  ;; Block height
)

;; Read-only functions

(define-read-only (has-page-access (reader principal) (book-id uint) (page-num uint))
  (is-some (map-get? page-access { reader: reader, book-id: book-id, page-num: page-num }))
)

(define-read-only (has-chapter-access (reader principal) (book-id uint) (chapter-num uint))
  (is-some (map-get? chapter-access { reader: reader, book-id: book-id, chapter-num: chapter-num }))
)

(define-read-only (get-page-unlock-height (reader principal) (book-id uint) (page-num uint))
  (match (map-get? page-access { reader: reader, book-id: book-id, page-num: page-num })
    entry (ok (get unlocked-at entry))
    (err u404)
  )
)

(define-read-only (get-chapter-unlock-height (reader principal) (book-id uint) (chapter-num uint))
  (match (map-get? chapter-access { reader: reader, book-id: book-id, chapter-num: chapter-num })
    entry (ok (get unlocked-at entry))
    (err u404)
  )
)

;; Public functions

(define-public (unlock-page (reader principal) (book-id uint) (page-num uint))
  (let
    (
      (current-height stacks-block-height)
    )
    ;; Check if already unlocked
    (asserts! (not (has-page-access reader book-id page-num)) ERR-ALREADY-UNLOCKED)
    
    ;; Record the unlock
    (map-set page-access
      { reader: reader, book-id: book-id, page-num: page-num }
      { unlocked-at: current-height }
    )
    
    (ok true)
  )
)

(define-public (unlock-chapter (reader principal) (book-id uint) (chapter-num uint))
  (let
    (
      (current-height stacks-block-height)
    )
    ;; Check if already unlocked
    (asserts! (not (has-chapter-access reader book-id chapter-num)) ERR-ALREADY-UNLOCKED)
    
    ;; Record the unlock
    (map-set chapter-access
      { reader: reader, book-id: book-id, chapter-num: chapter-num }
      { unlocked-at: current-height }
    )
    
    (ok true)
  )
)

;; Allow readers to unlock their own content (in case backend verification happens off-chain)
(define-public (self-unlock-page (book-id uint) (page-num uint))
  (unlock-page tx-sender book-id page-num)
)

(define-public (self-unlock-chapter (book-id uint) (chapter-num uint))
  (unlock-chapter tx-sender book-id chapter-num)
)
