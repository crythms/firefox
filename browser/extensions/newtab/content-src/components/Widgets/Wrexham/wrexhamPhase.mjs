/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const PHASES = {
  PREMATCH: "prematch",
  LIVE: "live",
  FULLTIME: "fulltime",
  OFFDAY: "offday",
};

export const TABS = {
  MATCH: "match",
  TABLE: "table",
  FIXTURES: "fixtures",
};

export const TAB_ORDER = [TABS.MATCH, TABS.TABLE, TABS.FIXTURES];

// Merino's World Cup API sent "live" for every in-play state, including half
// time and extra time, and "past" once a match finished.
export const LIVE_STATUSES = new Set(["live", "halftime", "extra time"]);
const FINAL_STATUSES = new Set(["past", "final", "ended"]);

// Text statuses (`status`) that mean the match isn't being played today. The
// World Cup API sent a postponed match as status_type "scheduled".
const NOT_PLAYED_STATUSES = new Set(["Postponed", "Canceled", "Cancelled"]);

// A result stays up for the rest of the fan's day, and for at least this long
// after the final whistle so a late result doesn't vanish at midnight.
export const RESULT_HOLD_MIN_MS = 3 * 60 * 60 * 1000;

// Used for the final whistle when the data doesn't say when the match ended.
const MATCH_LENGTH_MS = 115 * 60 * 1000;

/**
 * When the match ended: `ended_at`, else the time of the last data change
 * (`updated`, epoch seconds), else an estimate from kickoff.
 *
 * @param {object} match
 * @returns {number} A ms epoch.
 */
function getEndedAt(match) {
  if (match.ended_at) {
    return Date.parse(match.ended_at);
  }
  if (Number.isFinite(match.updated)) {
    return match.updated * 1000;
  }
  return Date.parse(match.date) + MATCH_LENGTH_MS;
}

/**
 * Whether a match in play is at half time.
 *
 * @param {object} match
 * @returns {boolean}
 */
export function isHalfTime(match) {
  return match?.status === "Break" || match?.status_type === "halftime";
}

/**
 * The match clock to show, like "67" or "90+3", or null when there's none.
 *
 * @param {object} match
 * @returns {string|null}
 */
export function getMatchClock(match) {
  const clock = match?.clock;
  if (typeof clock !== "string" || clock === "" || clock === "0") {
    return null;
  }
  return clock;
}

function isSameLocalDay(a, b) {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

/**
 * Which state the widget is in.
 *
 * @param {object|null} match - Wrexham's most recent or current match.
 * @param {number} now - The current time, as a ms epoch.
 * @returns {string} One of PHASES.
 */
export function getWrexhamPhase(match, now) {
  if (!match || NOT_PLAYED_STATUSES.has(match.status)) {
    return PHASES.OFFDAY;
  }
  const kickoff = Date.parse(match.date);
  // A delayed kickoff is still today's match; it isn't live until it starts.
  const delayedKickoff =
    match.status === "Delayed" && !Number.isFinite(match.home_score);
  if (LIVE_STATUSES.has(match.status_type) && !delayedKickoff) {
    return PHASES.LIVE;
  }
  if (match.status_type === "scheduled" || delayedKickoff) {
    return isSameLocalDay(kickoff, now) ? PHASES.PREMATCH : PHASES.OFFDAY;
  }
  if (FINAL_STATUSES.has(match.status_type)) {
    const endedAt = getEndedAt(match);
    if (isSameLocalDay(endedAt, now) || now - endedAt < RESULT_HOLD_MIN_MS) {
      return PHASES.FULLTIME;
    }
  }
  return PHASES.OFFDAY;
}

/**
 * The tab the widget opens on. The Match tab leads in every phase: on matchday
 * it has the match, on other days the last result, form and next match.
 *
 * @param {string} _phase - One of PHASES.
 * @returns {string} One of TABS.
 */
export function getDefaultTab(_phase) {
  return TABS.MATCH;
}

/**
 * Whole calendar days from today to a date, in the fan's own time zone: 0 for
 * later today, 1 for tomorrow.
 *
 * @param {number} date - A ms epoch.
 * @param {number} now - The current time, as a ms epoch.
 * @returns {number}
 */
export function getDaysUntil(date, now) {
  const startOfDay = ms => new Date(ms).setHours(0, 0, 0, 0);
  // Rounded so a day with a clock change still counts as one.
  return Math.round(
    (startOfDay(date) - startOfDay(now)) / (24 * 60 * 60 * 1000)
  );
}

/**
 * The other team in one of a team's matches, and whether that team was at
 * home.
 *
 * @param {object} match
 * @param {string} teamKey
 * @returns {{opponent: object, isHome: boolean}|null}
 */
export function getOpponent(match, teamKey) {
  if (match?.home_team?.key === teamKey) {
    return { opponent: match.away_team, isHome: true };
  }
  if (match?.away_team?.key === teamKey) {
    return { opponent: match.home_team, isHome: false };
  }
  return null;
}

/**
 * A match's score from one team's side.
 *
 * @param {object} match
 * @param {string} teamKey
 * @returns {{ours: number, theirs: number}|null}
 */
export function getScoreForTeam(match, teamKey) {
  const side = getOpponent(match, teamKey);
  if (
    !side ||
    !Number.isFinite(match.home_score) ||
    !Number.isFinite(match.away_score)
  ) {
    return null;
  }
  return side.isHome
    ? { ours: match.home_score, theirs: match.away_score }
    : { ours: match.away_score, theirs: match.home_score };
}

/**
 * The match the Match tab shows: today's on matchday, the next one otherwise.
 *
 * @param {object} data - The Wrexham slice's data.
 * @param {string} phase - One of PHASES.
 * @returns {object|null}
 */
export function getMatchForPhase(data, phase) {
  if (phase === PHASES.OFFDAY) {
    return data?.next_match ?? null;
  }
  return data?.focus_match ?? null;
}

/**
 * The result of a finished match from one team's side.
 *
 * @param {object} match
 * @param {string} teamKey
 * @returns {"win"|"draw"|"loss"|null} Null if the team didn't play or there's
 *   no score.
 */
export function getResultForTeam(match, teamKey) {
  if (
    !Number.isFinite(match?.home_score) ||
    !Number.isFinite(match?.away_score)
  ) {
    return null;
  }
  let ours;
  let theirs;
  if (match.home_team?.key === teamKey) {
    ours = match.home_score;
    theirs = match.away_score;
  } else if (match.away_team?.key === teamKey) {
    ours = match.away_score;
    theirs = match.home_score;
  } else {
    return null;
  }
  if (ours > theirs) {
    return "win";
  }
  return ours < theirs ? "loss" : "draw";
}

/**
 * Where a team sits in the table and which way it moved.
 *
 * @param {Array<object>} standings
 * @param {string} teamKey
 * @returns {{position: number, direction: "up"|"down"|"same"}|null} Null
 *   if the team isn't in the table or there's no previous position to compare.
 */
export function getPositionChange(standings, teamKey) {
  const row = standings?.find(entry => entry.team?.key === teamKey);
  if (!row || !Number.isFinite(row.previous_position)) {
    return null;
  }
  let direction = "same";
  if (row.previous_position > row.position) {
    direction = "up";
  } else if (row.previous_position < row.position) {
    direction = "down";
  }
  return { position: row.position, direction };
}
