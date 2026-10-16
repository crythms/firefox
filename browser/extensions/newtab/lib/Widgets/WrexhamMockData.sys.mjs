/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Dummy data for the Wrexham AFC widget until it reads the Merino sports API.
 * Times are relative to `now`, so matchday is always today.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WREXHAM_KEY = "WRE";

const TEAMS = {
  BIR: "Birmingham City",
  BLB: "Blackburn Rovers",
  BRC: "Bristol City",
  BUR: "Burnley",
  CHA: "Charlton Athletic",
  DER: "Derby County",
  HUL: "Hull City",
  LEI: "Leicester City",
  LIN: "Lincoln City",
  MID: "Middlesbrough",
  MIL: "Millwall",
  NOR: "Norwich City",
  PNE: "Preston North End",
  POR: "Portsmouth",
  QPR: "Queens Park Rangers",
  SHU: "Sheffield United",
  SOU: "Southampton",
  STK: "Stoke City",
  SWA: "Swansea City",
  WAT: "Watford",
  WBA: "West Bromwich Albion",
  WHU: "West Ham United",
  WOL: "Wolverhampton Wanderers",
  WRE: "Wrexham AFC",
};

// The shorter names used where space is tight, for the clubs that have one.
const SHORT_NAMES = {
  BLB: "Blackburn",
  DER: "Derby",
  PNE: "Preston",
  QPR: "QPR",
  SHU: "Sheffield Utd",
  SWA: "Swansea",
  WBA: "West Brom",
  WHU: "West Ham",
  WOL: "Wolves",
  WRE: "Wrexham",
};

// Before this gameweek: [key, goal difference, points], in table order.
const BASE_TABLE = [
  ["MID", 12, 24],
  ["WHU", 10, 23],
  ["SHU", 8, 22],
  ["WOL", 6, 22],
  ["NOR", 6, 21],
  ["MIL", 5, 19],
  ["WRE", 4, 18],
  ["SWA", 2, 17],
  ["BRC", 1, 16],
  ["PNE", 0, 15],
  ["WBA", 0, 15],
  ["SOU", -1, 14],
  ["BUR", -1, 14],
  ["CHA", -2, 14],
  ["QPR", -2, 13],
  ["HUL", -3, 13],
  ["BIR", -3, 12],
  ["WAT", -4, 12],
  ["STK", -5, 11],
  ["DER", -6, 10],
  ["LIN", -7, 10],
  ["BLB", -8, 9],
  ["POR", -9, 8],
  ["LEI", -11, 7],
];

const RACECOURSE = "Racecourse Ground";

// Wrexham's last five results, oldest first, as [opponent, Wrexham at home,
// days from now, Wrexham's goals, the opponent's goals].
const RESULTS = [
  ["WBA", true, -24, 0, 0],
  ["MID", false, -17, 0, 2],
  ["HUL", true, -14, 3, 1],
  ["SWA", false, -10, 1, 1],
  ["SOU", true, -3, 2, 1],
];

// Wrexham's matches after Derby away, as [opponent, Wrexham at home, days
// after the Derby match, kickoff hour in Wrexham].
const LATER_FIXTURES = [
  ["NOR", true, 8, 15],
  ["MIL", false, 11, 19],
  ["STK", true, 15, 15],
  ["QPR", false, 22, 15],
];

const CHAMPIONSHIP = { key: "championship", name: "EFL Championship" };

// The extra time and penalties scenarios: a one-off match that isn't part of
// the league, which can go to extra time and penalties.
const PLAY_OFF_FINAL = {
  key: "championship-play-off-final",
  name: "Championship Play-off Final",
};

// Only the opponent's badge shows club colours.
const TEAM_COLORS = {
  DER: { primary: "#FFFFFF", secondary: "#000000" },
};

function team(key) {
  const result = { key, name: TEAMS[key] };
  if (SHORT_NAMES[key]) {
    result.short_name = SHORT_NAMES[key];
  }
  if (TEAM_COLORS[key]) {
    result.colors = TEAM_COLORS[key];
  }
  return result;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

// When the clock in Wrexham reads `hour`:00, `daysAhead` days from `now`. It
// can be an hour out on the days the clocks change.
function wrexhamWallClock(now, daysAhead, hour) {
  const day = new Date(now + daysAhead * DAY);
  const guess = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    hour
  );
  const wrexhamHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "numeric",
      hourCycle: "h23",
    }).format(guess)
  );
  return guess - (wrexhamHour - hour) * HOUR;
}

function laterToday(now) {
  const kickoff = new Date(now);
  kickoff.setMinutes(0, 0, 0);
  kickoff.setHours(kickoff.getHours() + 3);
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  return Math.min(kickoff.getTime(), tomorrow.getTime() - MINUTE);
}

function buildMatch({
  id,
  home,
  away,
  kickoff,
  venue = null,
  competition = CHAMPIONSHIP,
  status_type = "scheduled",
  status = "Scheduled",
  period = null,
  clock = null,
  home_score = null,
  away_score = null,
  home_penalties = null,
  away_penalties = null,
  updated = null,
}) {
  return {
    id,
    date: iso(kickoff),
    venue,
    competition,
    status_type,
    status,
    period,
    clock,
    home_team: team(home),
    away_team: team(away),
    home_score,
    away_score,
    home_penalties,
    away_penalties,
    ended_at: null,
    updated,
    url: null,
  };
}

function epochSeconds(ms) {
  return Math.floor(ms / 1000);
}

function buildStandings({ wrexhamWon }) {
  let rows = BASE_TABLE.map(([key, goal_difference, points]) => ({
    key,
    goal_difference,
    points,
    played: 11,
  }));
  if (wrexhamWon) {
    const wrexham = rows.find(row => row.key === WREXHAM_KEY);
    wrexham.played += 1;
    wrexham.points += 3;
    wrexham.goal_difference += 1;
  }
  const previous = new Map(BASE_TABLE.map(([key], index) => [key, index + 1]));
  rows.sort(
    (a, b) => b.points - a.points || b.goal_difference - a.goal_difference
  );
  return rows.map((row, index) => ({
    position: index + 1,
    previous_position: previous.get(row.key),
    team: team(row.key),
    played: row.played,
    goal_difference: row.goal_difference,
    points: row.points,
  }));
}

function wrexhamMatch({ opponent, home, venue, ...fields }) {
  return buildMatch({
    ...fields,
    home: home ? WREXHAM_KEY : opponent,
    away: home ? opponent : WREXHAM_KEY,
    venue: venue ?? (home ? RACECOURSE : null),
  });
}

function buildResults(now) {
  return RESULTS.map(([opponent, home, days, ours, theirs], index) => {
    const kickoff = wrexhamWallClock(now, days, 15);
    return wrexhamMatch({
      id: 1190 + index,
      opponent,
      home,
      kickoff,
      status_type: "past",
      status: "Final",
      period: "FT",
      home_score: home ? ours : theirs,
      away_score: home ? theirs : ours,
      updated: epochSeconds(kickoff + 115 * MINUTE),
    });
  });
}

function buildLaterFixtures(derby) {
  const derbyKickoff = Date.parse(derby.date);
  return LATER_FIXTURES.map(([opponent, home, days, hour], index) =>
    wrexhamMatch({
      id: 1300 + index,
      opponent,
      home,
      kickoff: wrexhamWallClock(derbyKickoff, days, hour),
    })
  );
}

// The "minimal" scenario: every field the contract marks optional is left out.
function withoutOptionalFields(data) {
  const plainTeam = ({ key, name }) => ({ key, name });
  const plainMatch = ({ venue: _venue, ended_at: _endedAt, ...match }) => ({
    ...match,
    home_team: plainTeam(match.home_team),
    away_team: plainTeam(match.away_team),
  });
  return {
    ...data,
    team: plainTeam(data.team),
    focus_match: plainMatch(data.focus_match),
    results: [],
    upcoming: data.upcoming.map(plainMatch),
    standings: data.standings.map(
      ({ previous_position: _previous, team: rowTeam, ...row }) => ({
        ...row,
        team: plainTeam(rowTeam),
      })
    ),
  };
}

/**
 * @param {string} scenario - prematch, delayed, postponed, live, halftime,
 *   suspended, extratime, fulltime, penalties, minimal (before kickoff, without
 *   optional fields) or offday (the default).
 * @param {number} now - A ms epoch.
 * @returns {object} The data WrexhamFeed broadcasts as WIDGETS_WREXHAM_UPDATE.
 */
export function buildMockData(scenario, now) {
  const derbyAway = {
    id: 1299,
    opponent: "DER",
    home: false,
    venue: "Pride Park",
  };
  const playOffFinal = {
    id: 1400,
    opponent: "DER",
    home: false,
    venue: "Wembley Stadium",
    competition: PLAY_OFF_FINAL,
  };
  let results = buildResults(now);
  let focus;
  let upcoming;
  let wrexhamWon = false;
  switch (scenario) {
    case "prematch":
    case "minimal":
      focus = wrexhamMatch({ ...derbyAway, kickoff: laterToday(now) });
      upcoming = [focus, ...buildLaterFixtures(focus).slice(0, 3)];
      break;
    case "delayed":
      focus = wrexhamMatch({
        ...derbyAway,
        kickoff: now - 10 * MINUTE,
        status: "Delayed",
      });
      upcoming = [focus, ...buildLaterFixtures(focus).slice(0, 3)];
      break;
    case "postponed":
      // A postponed match stays out of `upcoming` until it has a new date.
      focus = wrexhamMatch({
        ...derbyAway,
        kickoff: laterToday(now),
        status: "Postponed",
      });
      upcoming = buildLaterFixtures(focus).slice(0, 3);
      break;
    case "suspended":
      focus = wrexhamMatch({
        ...derbyAway,
        kickoff: now - 75 * MINUTE,
        status_type: "live",
        status: "Suspended",
        period: "2",
        clock: "67",
        home_score: 1,
        away_score: 2,
        updated: epochSeconds(now - 8 * MINUTE),
      });
      upcoming = buildLaterFixtures(focus);
      break;
    case "extratime":
      focus = wrexhamMatch({
        ...playOffFinal,
        kickoff: now - 115 * MINUTE,
        status_type: "live",
        status: "In Progress",
        period: "ET",
        clock: "105",
        home_score: 1,
        away_score: 1,
        updated: epochSeconds(now),
      });
      upcoming = buildLaterFixtures(focus);
      break;
    case "penalties":
      focus = wrexhamMatch({
        ...playOffFinal,
        kickoff: now - 3 * HOUR,
        status_type: "past",
        status: "Final",
        period: "FT(P)",
        clock: "120",
        home_score: 1,
        away_score: 1,
        home_penalties: 3,
        away_penalties: 4,
        updated: epochSeconds(now - 20 * MINUTE),
      });
      results = [...results.slice(1), focus];
      upcoming = buildLaterFixtures(focus);
      break;
    case "live":
      focus = wrexhamMatch({
        ...derbyAway,
        kickoff: now - 67 * MINUTE,
        status_type: "live",
        status: "In Progress",
        period: "2",
        clock: "67",
        home_score: 1,
        away_score: 2,
        updated: epochSeconds(now),
      });
      upcoming = buildLaterFixtures(focus);
      break;
    case "halftime":
      focus = wrexhamMatch({
        ...derbyAway,
        kickoff: now - 50 * MINUTE,
        status_type: "live",
        status: "Break",
        period: "1",
        clock: "45+2",
        home_score: 1,
        away_score: 1,
        updated: epochSeconds(now),
      });
      upcoming = buildLaterFixtures(focus);
      break;
    case "fulltime":
      focus = wrexhamMatch({
        ...derbyAway,
        kickoff: now - 2 * HOUR,
        status_type: "past",
        status: "Final",
        period: "FT",
        clock: "90+4",
        home_score: 1,
        away_score: 2,
        updated: epochSeconds(now - 5 * MINUTE),
      });
      results = [...results.slice(1), focus];
      upcoming = buildLaterFixtures(focus);
      wrexhamWon = true;
      break;
    default: {
      const derby = wrexhamMatch({
        ...derbyAway,
        kickoff: wrexhamWallClock(now, 4, 15),
      });
      focus = results.at(-1);
      upcoming = [derby, ...buildLaterFixtures(derby).slice(0, 3)];
      break;
    }
  }

  const data = {
    team: team(WREXHAM_KEY),
    league: CHAMPIONSHIP,
    focus_match: focus,
    results,
    upcoming,
    standings: buildStandings({ wrexhamWon }),
  };
  return scenario === "minimal" ? withoutOptionalFields(data) : data;
}
