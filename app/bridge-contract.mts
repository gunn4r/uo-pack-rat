// bridge-contract.mts — the bridge protocol this app writes and the limits every packrat-bridge.py enforces on an Organize
// trip, as plain constants with no I/O, so a planner (app/organize.mts) can use them without loading the trip writer
// (app/bridge-trip.mts).

// The protocol of every queue line this app writes (POST /api/bridge, queueTrip). A bridge refuses a line in a newer
// protocol than its own PROTOCOL; raise this, and every shipped capabilities.json's "protocol", when a line's meaning
// changes in a way an older bridge would misread (docs/bridge-protocol.md, Protocol).
export const BRIDGE_PROTOCOL = 1;

// MAX_LINE_BYTES in every packrat-bridge.py. A longer line is refused unread, with no id the page
// could match, so the trip would never report back: it must never be written.
export const TRIP_MAX_BYTES = 16384;
// MAX_TRIP_NAME in every packrat-bridge.py; names are only ever printed on screen.
export const TRIP_NAME_MAX = 40;
