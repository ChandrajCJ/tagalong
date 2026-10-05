# 006: Chat push notifications through Expo, batched and presence-aware

**Status:** accepted

## Decision
- When someone sends a chat message, the API queues a `notify` job for every other member (BullMQ queue `notify`). The job id is `notify-<trip>-<user>` with a **20-second delay**, so while one is waiting, more messages don't add more jobs. The worker sends **one summary** ("Priya and Sam: 5 new messages").
- The worker skips anyone **online** (seen by the gateway in the last 60 seconds, from the `online:<trip>` sorted set), anyone who has already **read** those messages, and anyone with no registered phone.
- Pushes go through **Expo's push service** (`exp.host`), which forwards to Apple and Google. A `DeviceNotRegistered` result clears that phone's token.
- The processor lives in `apps/api/src/jobs/notify.ts` (exported as `@tagalong/api/jobs`), so it shares the API's database code and is tested with the API. `apps/worker` only runs it.
- Activity cards (system messages) never trigger pushes.

## Why
- Batching avoids a notification storm when a group is chatting.
- Skipping people who have the app open is the biggest single reduction in noise.
- Expo's service means one integration for both platforms, and no Apple or Google credentials in our code.

## Limits today
- The app needs an Expo project id to get a push token (see the README). Without one, registration quietly does nothing.
- Expo Go on Android can't receive pushes (since SDK 53); Android needs a development build. Expo Go on iPhone can.
