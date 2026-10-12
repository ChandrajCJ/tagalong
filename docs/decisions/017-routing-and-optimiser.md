# 017: Places on plan items, travel times and the shortest order

**Status:** accepted

## Decision
- **Plan items search real places.** The same search as destinations (Photon), with `scope=place`: no town-or-region filter, biased strongly to the trip's location, and limited to the destination's area widened by about 30 km, so day trips are found and the other Time Out Market isn't. Answers carry a short address ("Praça D. Luís I 49, Misericórdia, Lisbon") so two branches can be told apart. The trip's own located ideas are suggested first. Typing without picking still works; it just has no pin.
- **Travel times come from OSRM**, by default the FOSSGIS servers (`routing.openstreetmap.de`, one server each for foot, car and bike). They're free, keyless and fair-use, so: one `/route` call per day and mode, a proper User-Agent, and answers cached for 30 days keyed by mode and the rounded coordinates in order. A changed order is a different key, so nothing needs invalidating. `ROUTING_URL` points elsewhere if we run our own OSRM later.
- **When OSRM is down or slow (5 s), we estimate:** straight-line distance × 1.3 at a typical speed (4.8 km/h walking, 14 cycling, 28 driving in town), marked `estimated` so the app says "about". Estimates aren't cached, so the real answer replaces them as soon as the server is back.
- **A stop without a location breaks the chain.** Travel is shown only between two neighbours on the list that both have a location; the unlocated stop's connectors say nothing. One OSRM call still covers every located stop, and the legs across a gap are dropped.
- **The travel mode is per device and day,** not shared: one person walks while another drives. Until someone picks, it's Walk when the day's stops are all within 3 km of each other, otherwise Drive.
- **"Shortest order" keeps fixed points fixed.** The first stop (usually the hotel), any stop with a start time, and any stop without a location never move; only the stops between two fixed points are reordered, with both ends held. Each stretch is solved exactly (Held–Karp) up to 10 stops, and by nearest-neighbour plus 2-opt beyond. Costs come from an OSRM `/table` duration matrix (one-way streets make it asymmetric, which both methods handle), with the same cache and fallback. Under two minutes saved, it says the order is already about as short as it gets.
- **A new order is saved in one transaction.** `POST /trips/:id/days/:date/order` takes every item on the day with the version you saw. Any changed version, or an item added meanwhile, is a 409 with the day as it is now; an item from another day or trip is a 400. Items still at their old index keep their keys; each run of moved items gets new keys between its neighbours, so only moved items get a new version, a `change_log` row and a place in the single `day.reordered` event.

## Found while testing
- In Lisbon by car, the shortest way from Belém through Alfama, LX Factory and Cais do Sodré isn't west-to-east: one-way streets and a fast road from LX Factory to Alfama make Belém → Cais → LX Factory → Alfama quicker. The solver follows the real matrix, not the map's look.
- The fractional-index library sometimes hands a moved item its old key back, so a two-item swap can change just one item.

## Limits today
- No public-transport times: there's no free, key-less source that covers India.
- The FOSSGIS servers are a shared resource with no guarantee; heavy use would mean running our own OSRM (the Oracle box can).
- A stay booking's address can be picked from the map, but the booking itself stores only the text, not a pin.
