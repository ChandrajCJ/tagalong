# 013: Splitting expenses and settling up

**Status:** accepted

## Decision
- **Money is whole minor units, never floats.** Amounts are integers in the smallest unit of their currency (cents; yen and dong have none, see `minorDigits`). Every share comes from `allocate` (`@tagalong/shared`), which rounds down and hands the leftover cents to the largest remainders, ties by user id, so the shares always add up to the total exactly and every phone computes the same split.
- **Four ways to split, one rule.** Equally, exact amounts, percent (stored as basis points) and shares all become weights for `allocate`. Exact amounts must add up to the total and percents to 100%; the server refuses anything else (`bad_split`). What was entered for each person is kept (`expense_splits.value`) so an expense reopens the way it was made.
- **Balances are never stored.** They're worked out from expenses and settlements every time (`computeBalances`), on the server for `GET /trips/:id/money` and on the phone after every live event, so they can't drift. `suggestTransfers` (biggest debtor pays biggest creditor) clears everything in fewer payments than there are people.
- **A rate is frozen when an expense is logged.** Each expense stores its currency, the rate to the trip's currency and the converted amount. Editing the description or the split keeps that rate; only a new currency or a typed rate changes it. Rates come from Frankfurter (the European Central Bank's daily rates, free and keyless) and are cached for a day. Currencies it doesn't cover ask for the rate (`rate_needed`). Tests use fixed fake rates, never the network.
- **Viewers can see the money and record their own payments**, but not add expenses. Paying someone back is your business even if you can't change the plan.
- **People who left stay in the money.** Someone who leaves can still owe or be owed, so they keep appearing ("(left)") and can still be paid back, and their old expenses can be corrected. They can't be added to new ones.
- **Expenses link to where they came from:** a plan item, a booking or a chat message (`item_id`, `booking_id`, `source_message_id`). "Add as expense" on those passes a draft to the Money tab, which opens the sheet prefilled. A plan item's cost is per person, so its draft is that times the number of travellers.

## Also changed
- **Money takes the Docs tab's place in the tab bar**, as in the original design. Six tabs is the most a phone fits; Docs is now "Tickets & files" on the Overview, with its own back button.

## Found while testing
- The balances read "You owes €30" and "You gets back €60". Fixed: "You owe", "You get back".
- With the browser pane hidden, a saved expense's sheet stayed on screen. The page reports itself hidden, which pauses the sheet's closing animation, and the expense saved exactly once. A draft now opens the sheet only once regardless, so a lingering route param can never reopen it.

## Limits today
- **No in-app payments.** "Mark paid" records money that changed hands elsewhere. Paying through Stripe needs an account and a deployed server.
- **Receipts aren't read.** Pulling the amount from a receipt photo belongs with the AI phase.
- The trip's currency can't be changed after creation; there's no screen for it yet, and changing it would mean converting every frozen amount.
