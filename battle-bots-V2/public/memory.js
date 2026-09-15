// Per-team rolling event log (within a match) plus persisted round outcomes,
// both fed back into the model prompt so bots can adapt.

const MAX_EVENTS = 8;
const MAX_HISTORY = 5;
const STORAGE_KEY = 'bb2-match-history';

let events = {};   // team -> string[]

export function resetMatchMemory(teams) {
    events = {};
    for (const t of teams) events[t] = [];
}

export function pushEvent(team, text) {
    if (!events[team]) events[team] = [];
    events[team].push(text);
    if (events[team].length > MAX_EVENTS) events[team].shift();
}

// Record something every team should know about (a kill, say).
export function pushGlobalEvent(text) {
    for (const team of Object.keys(events)) pushEvent(team, text);
}

export function getEvents(team) {
    return events[team] || [];
}

export function loadHistory() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];   // private mode / blocked storage: history is a nicety, not required
    }
}

export function recordRoundOutcome(entry) {
    try {
        const history = loadHistory();
        history.unshift(entry);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {
        /* ignore */
    }
}

// What a given team is told about previous matches.
export function historyForPrompt(team) {
    return loadHistory().map(h => {
        const outcome = h.winner === team ? 'WON' : (h.winner ? `lost to ${h.winner}` : 'draw');
        return `${h.mode}: you ${outcome} (your orders: "${h.prompts?.[team] ?? 'n/a'}")`;
    });
}
