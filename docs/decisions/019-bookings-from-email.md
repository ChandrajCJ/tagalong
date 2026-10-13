# 019: Bookings from email

**Status:** accepted

## Decision
- **Drafts only.** Whatever is found in an email, a pasted text or a ticket PDF is saved as an *import* with one or more *candidates*. A booking exists only after an editor checks a candidate in the booking form and taps **Add**; **Not this** skips it. A wrong guess or a spoofed email therefore can't change a trip.
- **Structured data first, text second.** Airlines and hotels embed schema.org reservations (JSON-LD or microdata, the markup Gmail reads for its cards). When present they're used as they are and marked "high". Otherwise the plain text, or a PDF's text via `unpdf` (pure JS, MIT), is read with simple rules: booking type by keywords, PNR and confirmation codes, flight numbers of known airlines with IATA pairs, IRCTC train numbers, coaches and berths, check-in and check-out, totals in ₹/€/£/$. Text guesses are "medium" (a code and a date) or "low", and the form says what to check. No paid parser and no AI.
- **Times are real instants.** Markup with an offset is exact. A time without one is read at the departure airport (a small table of airports and their zones), or else in the trip's time zone. A flight that lands "before" it leaves lands the next day.
- **Return flights are two candidates.** Each flight number found starts its own; a total is put on the first only.
- **Adding also plans it, by default.** A booking with no plan item hardly shows anywhere in the app. So **Add** also creates a plan item on the booking's day and local time ("Flight BOM → GOI", "Check in at Casa do Alfama"), unless the person turns it off or the booking names an item. A candidate is claimed under a row lock before the booking is made, so a double tap or two people can't add it twice. If saving the booking fails, the candidate is given back.
- **One Gmail inbox, plus-addressed per trip.** Each trip has a random `+code` (made on first use, changeable by the owner). The worker polls over IMAP (`imapflow`) every two minutes with a BullMQ job scheduler, parses with `mailparser`, and marks every email read whether or not it was used, so a bad email isn't retried forever.
- **Who may forward.** An email is used only if its From address belongs to a current owner or editor of the trip **and** the receiving server's own `Authentication-Results` (Gmail's, `mx.google.com`) shows DKIM pass for the From domain, or SPF pass for it. Only the first Authentication-Results from that server is read. Ones from anywhere else, or lower down, could be written by the sender and are ignored. The same Message-ID is read once.
- **Attachments go to Docs.** Up to three ticket PDFs per email are saved to the trip's Docs as tickets, uploaded by the forwarder. If the email's own text finds nothing, the PDFs are read instead.
- **Optional on the server.** Without `IMPORT_IMAP_URL` and `IMPORT_ADDRESS`, the worker doesn't poll and the app shows paste and "read a ticket from Docs" only.

## Found while testing
- IRCTC writes "Train No./Name: 12051 / JAN SHATABDI", so the number is also looked for before a slash.
- "Your reservation at Sunny loft is confirmed" needs the "is confirmed" trimmed off the name.
- Test users' names come from their email, so the chat card reads "sam’s email"; real users set their names in Profile.

## Limits today
- The real Gmail connection hasn't been run yet: the job is tested against a fake mailbox with real raw emails, but IMAP against Gmail needs the inbox set up (docs/DEPLOY.md).
- Screenshots aren't read (no OCR); paste the email text instead.
- Forwarding from an address that isn't the one you sign in with is ignored. That's deliberate, but it can surprise people with a work and a personal address.
- Gmail-style Authentication-Results only. Another provider's inbox would need `IMPORT_AUTHSERV_ID` set to its server name.
