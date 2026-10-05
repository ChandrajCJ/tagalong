# 005: Fractional positions for order, versions for conflicts

**Status:** accepted

## Ordering
Plan items store `position` as a fractional-index string (`positionBetween(before, after)` in `@tagalong/shared`). Moving an item gives it a key between its new neighbours, so a move updates **one row** and never renumbers the list. Two people moving different items can't collide.

Positions must be compared byte by byte. Postgres sorts them with `COLLATE "C"`, and the app uses plain string comparison. The default, language-aware collation puts some keys in the wrong order (caught by a test).

## Conflicts
Every item has a `version`. An edit sends the version it was based on, and the update only applies `WHERE version = :version`. If someone saved first, the API answers **409 with the current item**, and the app shows it: "Someone changed this while you were editing." Nothing is silently overwritten.

## Why not something heavier
Real-time collaborative text editing (CRDTs) would let two people type in the same field at once. For plan items, edits are short and rarely simultaneous, so version checks are simpler and enough. Revisit if that changes.
