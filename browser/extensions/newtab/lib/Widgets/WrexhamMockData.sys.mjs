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

// The rest of the gameweek, as [home, away, ms offset from Wrexham's kickoff].
const OTHER_FIXTURES = [
  ["WHU", "QPR", -19 * HOUR - 15 * MINUTE],
  ["SOU", "BUR", -2 * HOUR - 30 * MINUTE],
  ["CHA", "BRC", 0],
  ["SWA", "NOR", 0],
  ["WBA", "BIR", 0],
  ["SHU", "LIN", 0],
  ["MID", "WOL", 0],
  ["PNE", "MIL", 0],
  ["HUL", "WAT", 0],
  ["STK", "BLB", 2 * HOUR + 30 * MINUTE],
  ["POR", "LEI", 21 * HOUR],
];

const CHAMPIONSHIP = { key: "championship", name: "Championship" };

function team(key) {
  return { key, name: TEAMS[key] };
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
  status_type = "scheduled",
  status = "Scheduled",
  period = null,
  clock = null,
  home_score = null,
  away_score = null,
  goals = [],
  red_cards = [],
  updated = null,
}) {
  return {
    id,
    date: iso(kickoff),
    venue,
    competition: CHAMPIONSHIP,
    status_type,
    status,
    period,
    clock,
    home_team: team(home),
    away_team: team(away),
    home_score,
    away_score,
    goals,
    red_cards,
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

function buildGameweek(wrexhamMatch) {
  const kickoff = Date.parse(wrexhamMatch.date);
  const others = OTHER_FIXTURES.map(([home, away, offset], index) =>
    buildMatch({ id: 1200 + index, home, away, kickoff: kickoff + offset })
  );
  const matches = [...others, wrexhamMatch].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date)
  );
  return { number: 12, matches };
}

/**
 * @param {string} scenario - prematch, live, halftime, fulltime or offday (the
 *   default).
 * @param {number} now - A ms epoch.
 * @returns {object} The data WrexhamFeed broadcasts as WIDGETS_WREXHAM_UPDATE.
 */
export function buildMockData(scenario, now) {
  const derbyAway = {
    id: 1299,
    home: "DER",
    away: WREXHAM_KEY,
    venue: "Pride Park",
  };
  // team_key is the team the goal counts for, so an own goal by a Derby
  // player counts for Wrexham.
  const derbyGoals = [
    { team_key: WREXHAM_KEY, player: "J. Evans", minute: 12, type: null },
    { team_key: "DER", player: "T. Clarke", minute: 34, type: "penalty" },
    { team_key: WREXHAM_KEY, player: "M. Hart", minute: 58, type: "own_goal" },
  ];
  const derbyRedCards = [{ team_key: "DER", player: "K. Ward", minute: 63 }];

  const lastKickoff = wrexhamWallClock(now, -3, 15);
  const southamptonHome = buildMatch({
    id: 1198,
    home: WREXHAM_KEY,
    away: "SOU",
    venue: "Racecourse Ground",
    kickoff: lastKickoff,
    status_type: "past",
    status: "Final",
    period: "FT",
    clock: "90+3",
    home_score: 2,
    away_score: 1,
    goals: [],
    updated: epochSeconds(lastKickoff + 115 * MINUTE),
  });
  // Oldest first.
  const formBefore = ["draw", "loss", "win", "draw", "win"];

  let focus;
  let next;
  let wrexhamWon = false;
  switch (scenario) {
    case "prematch":
      focus = buildMatch({ ...derbyAway, kickoff: laterToday(now) });
      next = focus;
      break;
    case "live":
      focus = buildMatch({
        ...derbyAway,
        kickoff: now - 67 * MINUTE,
        status_type: "live",
        status: "In Progress",
        period: "2",
        clock: "67",
        home_score: 1,
        away_score: 2,
        goals: derbyGoals,
        red_cards: derbyRedCards,
        updated: epochSeconds(now),
      });
      next = focus;
      break;
    case "halftime":
      focus = buildMatch({
        ...derbyAway,
        kickoff: now - 50 * MINUTE,
        status_type: "live",
        status: "Break",
        period: "1",
        clock: "45+2",
        home_score: 1,
        away_score: 1,
        goals: derbyGoals.slice(0, 2),
        updated: epochSeconds(now),
      });
      next = focus;
      break;
    case "fulltime":
      focus = buildMatch({
        ...derbyAway,
        kickoff: now - 2 * HOUR,
        status_type: "past",
        status: "Final",
        period: "FT",
        clock: "90+4",
        home_score: 1,
        away_score: 2,
        goals: derbyGoals,
        red_cards: derbyRedCards,
        updated: epochSeconds(now - 5 * MINUTE),
      });
      next = null;
      wrexhamWon = true;
      break;
    default:
      focus = southamptonHome;
      next = buildMatch({
        ...derbyAway,
        kickoff: wrexhamWallClock(now, 4, 15),
      });
      break;
  }

  return {
    team: team(WREXHAM_KEY),
    league: CHAMPIONSHIP,
    focus_match: focus,
    next_match: next,
    last_match: wrexhamWon ? focus : southamptonHome,
    form: wrexhamWon ? [...formBefore.slice(1), "win"] : formBefore,
    standings: buildStandings({ wrexhamWon }),
    gameweek: buildGameweek(scenario === "fulltime" ? focus : next),
  };
}
