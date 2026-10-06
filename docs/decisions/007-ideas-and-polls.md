# 007: Ideas and polls — deciding together, before anything is committed

**Status:** accepted

## Decision
- An **idea** is a separate thing from a plan item (`itinerary.ideas`). It has a title, an optional note and link, and a type. It is not on a day and has no time, because nobody has agreed to it yet.
- **Votes are one row per person per idea** (`itinerary.idea_votes`, primary key `(idea_id, user_id)`, value `up` or `down`). Changing your mind is an upsert; taking your vote back deletes the row. Counts are therefore always exact, and two people voting at once can never collide.
- **Viewers may vote** but not add or edit ideas. Having an opinion isn't editing, and a trip where only editors can vote defeats the point.
- **Promoting** an idea creates an ordinary `itinerary.items` row and stamps `promoted_item_id` on the idea, **in one transaction**. The plan has no special "from an idea" case, and an idea can never be marked promoted without its item existing. Promoting twice returns the same item.
- A **poll** is a chat message of kind `poll` with options attached (`chat.polls`, `chat.poll_options`, `chat.poll_votes`). It lives in the conversation, where the decision is actually being made, rather than on a screen of its own.
- `poll_votes` carries `poll_id` as well as `option_id`, so replacing a single-choice vote is one delete by `(poll_id, user_id)` plus one insert.
- Votes travel over the **existing realtime gateway** as `idea.voted`, `idea.upserted`, `idea.deleted`, `poll.voted` and `poll.closed`. No new service.

## Why
- Every trip has a pile of maybes before it has a plan. Mixing them into the plan makes the plan untrustworthy; keeping them apart means the plan always means "we're doing this".
- One row per person is the simplest thing that gives exact counts, a changeable vote, and faces on the card.
- Making a promoted idea an ordinary item keeps every later feature (bookings, costs, item threads) working without knowing ideas exist.

## A note on the event payloads
An event carries the sender's own view, including their `myVote` and `mine` flags. The app recomputes those from the `voters` list before applying the update, so nobody sees someone else's vote as their own.

## Limits today
- No comments on ideas, and no deadline or reminder on a poll.
- The board is sorted by score on both sides. With a very large board this would be better done in SQL.
