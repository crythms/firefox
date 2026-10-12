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

// The World Cup API sent "live" for every in-play state and "past" once a
// match finished; the other values are accepted too.
const LIVE_STATUSES = new Set(["live", "halftime", "extra time"]);
const FINAL_STATUSES = new Set(["past", "final", "ended"]);

// The World Cup API sent a postponed match as status_type "scheduled".
const NOT_PLAYED_STATUSES = new Set(["Postponed", "Canceled", "Cancelled"]);

// A result stays up for the rest of the fan's day, and for at least this long
// after the final whistle so a late result doesn't vanish at midnight.
const RESULT_HOLD_MIN_MS = 3 * 60 * 60 * 1000;

// Used for the final whistle when the data doesn't say when the match ended.
const MATCH_LENGTH_MS = 115 * 60 * 1000;

// Prefers `ended_at`, then `updated` (epoch seconds), then an estimate.
function getEndedAt(match) {
  if (match.ended_at) {
    return Date.parse(match.ended_at);
  }
  if (Number.isFinite(match.updated)) {
    return match.updated * 1000;
  }
  return Date.parse(match.date) + MATCH_LENGTH_MS;
}

export function isHalfTime(match) {
  return match?.status === "Break" || match?.status_type === "halftime";
}

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
 * @param {object|null} match - Wrexham's current or most recent match.
 * @param {number} now - A ms epoch.
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
 * @param {number} kickoff - A ms epoch.
 * @param {number} now - A ms epoch.
 * @returns {{hours: number, minutes: number}|null} Null in the last minute
 *   before kickoff and after it.
 */
export function getCountdown(kickoff, now) {
  const totalMinutes = Math.floor((kickoff - now) / (60 * 1000));
  if (totalMinutes < 1) {
    return null;
  }
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/**
 * @param {object} match - A match with `updated` in epoch seconds.
 * @param {number} now - A ms epoch.
 * @returns {number|null}
 */
export function getMinutesSinceUpdate(match, now) {
  if (!Number.isFinite(match?.updated)) {
    return null;
  }
  return Math.max(0, Math.floor((now - match.updated * 1000) / (60 * 1000)));
}

// A team's goals and red cards, in the order they happened.
export function getTeamEvents(match, teamKey) {
  const goals = (match?.goals ?? [])
    .filter(goal => goal.team_key === teamKey)
    .map(goal => ({ kind: "goal", ...goal }));
  const cards = (match?.red_cards ?? [])
    .filter(card => card.team_key === teamKey)
    .map(card => ({ kind: "red_card", ...card }));
  const order = event => event.minute * 100 + (event.minute_extra ?? 0);
  return [...goals, ...cards].sort((a, b) => order(a) - order(b));
}

// Calendar days from today in the fan's time zone: 0 for today, 1 for tomorrow.
export function getDaysUntil(date, now) {
  const startOfDay = ms => new Date(ms).setHours(0, 0, 0, 0);
  // Rounded so a day with a clock change still counts as one.
  return Math.round(
    (startOfDay(date) - startOfDay(now)) / (24 * 60 * 60 * 1000)
  );
}

// isHome is whether `teamKey` was the home side.
export function getOpponent(match, teamKey) {
  if (match?.home_team?.key === teamKey) {
    return { opponent: match.away_team, isHome: true };
  }
  if (match?.away_team?.key === teamKey) {
    return { opponent: match.home_team, isHome: false };
  }
  return null;
}

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

// Today's match on matchday, the next one otherwise.
export function getMatchForPhase(data, phase) {
  if (phase === PHASES.OFFDAY) {
    return data?.next_match ?? null;
  }
  return data?.focus_match ?? null;
}

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
 * @returns {"up"|"down"|"same"|null} Null without a previous position.
 */
export function getRowMovement(row) {
  if (!Number.isFinite(row?.previous_position)) {
    return null;
  }
  if (row.previous_position > row.position) {
    return "up";
  }
  return row.previous_position < row.position ? "down" : "same";
}

export function getPositionChange(standings, teamKey) {
  const row = standings?.find(entry => entry.team?.key === teamKey);
  const direction = getRowMovement(row);
  return direction ? { position: row.position, direction } : null;
}

// Places counted from the top of the table, except relegation, which counts
// from the bottom.
const LEAGUE_ZONES = {
  championship: { promotion: 2, playoffs: 6, relegation: 3 },
};

/**
 * @returns {"promotion"|"playoffs"|"relegation"|null} Null outside the zones
 *   or for a league without known rules.
 */
export function getTableZone(leagueKey, position, teamCount) {
  const zones = LEAGUE_ZONES[leagueKey];
  if (!zones) {
    return null;
  }
  if (position <= zones.promotion) {
    return "promotion";
  }
  if (position <= zones.playoffs) {
    return "playoffs";
  }
  return position > teamCount - zones.relegation ? "relegation" : null;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function getLuminance(hex) {
  const channel = start => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function getContrast(a, b) {
  const [lighter, darker] = [getLuminance(a), getLuminance(b)].sort(
    (x, y) => y - x
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Badge colours from a team's club colours: the secondary colour for the text
 * when it is readable on the primary, otherwise black or white.
 *
 * @param {{primary?: string, secondary?: string}} [colors]
 * @returns {{background: string, text: string}|null} Null without a valid
 *   primary colour.
 */
export function getMonogramColors(colors) {
  const background = colors?.primary;
  if (!HEX_COLOR.test(background ?? "")) {
    return null;
  }
  const secondary = colors.secondary ?? "";
  if (HEX_COLOR.test(secondary) && getContrast(background, secondary) >= 4.5) {
    return { background, text: secondary };
  }
  const text =
    getContrast(background, "#000000") >= getContrast(background, "#ffffff")
      ? "#000000"
      : "#ffffff";
  return { background, text };
}
