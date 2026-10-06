# 008: A removed member can't walk back in through an old link

**Status:** accepted

## Decision
- `trips.trip_members` gains **`removed_by`**, set when an owner removes someone and left null when someone leaves by themselves. That's the only way to tell the two apart, since both just set `left_at`.
- Accepting an invite is refused when the person was **removed** and the link was **created at or before** the moment they were removed. Preview returns the same 404 as any dead link, so a token still can't be probed.
- A link created **after** the removal still works: that is an owner deliberately inviting them back, and it's the only way back in.
- Rejoining clears both `left_at` and `removed_by`.

## Why
- One link invites the whole group, so a link is usually still circulating when someone is removed. Without this, removing a person did nothing: they could paste the same link straight back in.
- Keying on the link's age rather than on the person is what makes "undo an accidental removal" possible without a separate re-add endpoint.
- Leaving on your own is not a judgement, so coming back with the same link stays allowed.

## Together with this
The invite screen gained a **one person only** toggle, which sets `max_uses = 1` on the link. The column existed from week 2 but nothing exposed it.

## Limits today
- An owner who removes someone and then reuses an **older** link for an unrelated invite will find the removed person can still not use it. That's the intended trade: links are cheap to create.
