/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  PHASES,
  getCountdown,
  getDaysUntil,
  getMatchClock,
  getMatchForPhase,
  getMinutesSinceUpdate,
  getOpponent,
  getPositionChange,
  getResultForTeam,
  getScoreForTeam,
  getTeamEvents,
  getWrexhamPhase,
  isHalfTime,
} from "content-src/components/Widgets/Wrexham/wrexhamPhase.mjs";

const HOUR = 60 * 60 * 1000;

// Built from local fields so the tests mean the same in any time zone.
const localTime = (day, hour, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

const match = overrides => ({
  date: new Date(localTime(10, 15)).toISOString(),
  status_type: "scheduled",
  home_team: { key: "DER" },
  away_team: { key: "WRE" },
  home_score: null,
  away_score: null,
  ended_at: null,
  ...overrides,
});

describe("getWrexhamPhase", () => {
  it("is an off day with no match", () => {
    expect(getWrexhamPhase(null, localTime(10, 12))).toBe(PHASES.OFFDAY);
  });

  it("is live while the match is in play, at half time or in extra time", () => {
    for (const status_type of ["live", "halftime", "extra time"]) {
      expect(getWrexhamPhase(match({ status_type }), localTime(10, 16))).toBe(
        PHASES.LIVE
      );
    }
  });

  it("is prematch when the match kicks off later the same local day", () => {
    expect(getWrexhamPhase(match(), localTime(10, 0, 1))).toBe(PHASES.PREMATCH);
  });

  it("is an off day when the match is on a later day", () => {
    expect(getWrexhamPhase(match(), localTime(9, 23, 59))).toBe(PHASES.OFFDAY);
  });

  it("holds the result for the rest of the day the match ended", () => {
    const finished = match({
      status_type: "past",
      ended_at: new Date(localTime(10, 17)).toISOString(),
    });
    expect(getWrexhamPhase(finished, localTime(10, 23, 30))).toBe(
      PHASES.FULLTIME
    );
    expect(getWrexhamPhase(finished, localTime(11, 0, 30))).toBe(PHASES.OFFDAY);
  });

  it("holds a late result past midnight for the minimum hold", () => {
    const late = match({
      status_type: "past",
      ended_at: new Date(localTime(10, 23)).toISOString(),
    });
    expect(getWrexhamPhase(late, localTime(11, 1))).toBe(PHASES.FULLTIME);
    expect(getWrexhamPhase(late, localTime(11, 2, 1))).toBe(PHASES.OFFDAY);
  });

  it("still accepts final for a finished match", () => {
    const finished = match({
      status_type: "final",
      ended_at: new Date(localTime(10, 17)).toISOString(),
    });
    expect(getWrexhamPhase(finished, localTime(10, 18))).toBe(PHASES.FULLTIME);
  });

  it("uses the last update as the final whistle when there's no ended_at", () => {
    const finished = match({
      status_type: "past",
      updated: localTime(10, 23) / 1000,
    });
    expect(getWrexhamPhase(finished, localTime(11, 1))).toBe(PHASES.FULLTIME);
    expect(getWrexhamPhase(finished, localTime(11, 2, 1))).toBe(PHASES.OFFDAY);
  });

  it("works out the final whistle from kickoff when the data lacks it", () => {
    const finished = match({
      date: new Date(localTime(10, 22)).toISOString(),
      status_type: "past",
    });
    // Kickoff plus 115 minutes is 23:55, so 2am is inside the hold.
    expect(getWrexhamPhase(finished, localTime(11, 2))).toBe(PHASES.FULLTIME);
  });

  it("is an off day when a scheduled match is postponed or cancelled", () => {
    for (const status of ["Postponed", "Canceled", "Cancelled"]) {
      expect(
        getWrexhamPhase(
          match({ status_type: "scheduled", status }),
          localTime(10, 12)
        )
      ).toBe(PHASES.OFFDAY);
    }
  });

  it("keeps a delayed kickoff on matchday", () => {
    for (const status_type of ["scheduled", "live"]) {
      expect(
        getWrexhamPhase(
          match({ status_type, status: "Delayed" }),
          localTime(10, 15, 10)
        )
      ).toBe(PHASES.PREMATCH);
    }
  });

  it("treats a delay once play has started as live", () => {
    expect(
      getWrexhamPhase(
        match({
          status_type: "live",
          status: "Delayed",
          home_score: 0,
          away_score: 1,
        }),
        localTime(10, 16)
      )
    ).toBe(PHASES.LIVE);
  });
});

describe("isHalfTime", () => {
  it("reads half time from the Break status", () => {
    expect(isHalfTime(match({ status_type: "live", status: "Break" }))).toBe(
      true
    );
    expect(
      isHalfTime(match({ status_type: "live", status: "In Progress" }))
    ).toBe(false);
  });

  it("still accepts a halftime status_type", () => {
    expect(isHalfTime(match({ status_type: "halftime" }))).toBe(true);
  });
});

describe("getMatchClock", () => {
  it("passes the clock through, including stoppage time", () => {
    expect(getMatchClock(match({ clock: "67" }))).toBe("67");
    expect(getMatchClock(match({ clock: "90+3" }))).toBe("90+3");
  });

  it("is null before kickoff or without a clock", () => {
    expect(getMatchClock(match({ clock: "0" }))).toBeNull();
    expect(getMatchClock(match({ clock: "" }))).toBeNull();
    expect(getMatchClock(match())).toBeNull();
    expect(getMatchClock(match({ clock: 67 }))).toBeNull();
  });
});

describe("getCountdown", () => {
  const kickoff = localTime(10, 15);

  it("splits the time left into hours and minutes", () => {
    expect(getCountdown(kickoff, localTime(10, 11, 48))).toEqual({
      hours: 3,
      minutes: 12,
    });
  });

  it("rounds down to the whole minute", () => {
    expect(getCountdown(kickoff, kickoff - 59.5 * 60 * 1000)).toEqual({
      hours: 0,
      minutes: 59,
    });
  });

  it("is null in the last minute and after kickoff", () => {
    expect(getCountdown(kickoff, kickoff - 30 * 1000)).toBeNull();
    expect(getCountdown(kickoff, kickoff + HOUR)).toBeNull();
  });
});

describe("getMinutesSinceUpdate", () => {
  const now = localTime(10, 16);

  it("counts whole minutes from the epoch-seconds update time", () => {
    expect(getMinutesSinceUpdate({ updated: now / 1000 - 150 }, now)).toBe(2);
    expect(getMinutesSinceUpdate({ updated: now / 1000 }, now)).toBe(0);
  });

  it("treats an update stamped slightly ahead of the clock as just now", () => {
    expect(getMinutesSinceUpdate({ updated: now / 1000 + 20 }, now)).toBe(0);
  });

  it("is null without an update time", () => {
    expect(getMinutesSinceUpdate({ updated: null }, now)).toBeNull();
    expect(getMinutesSinceUpdate(null, now)).toBeNull();
  });
});

describe("getTeamEvents", () => {
  const events = match({
    goals: [
      { team_key: "WRE", player: "A", minute: 45, minute_extra: 2 },
      { team_key: "DER", player: "B", minute: 30, type: "penalty" },
      { team_key: "WRE", player: "C", minute: 12, type: "own_goal" },
      { team_key: "WRE", player: "D", minute: 46 },
    ],
    red_cards: [{ team_key: "WRE", player: "E", minute: 45 }],
  });

  it("merges a team's goals and red cards in the order they happened", () => {
    expect(
      getTeamEvents(events, "WRE").map(event => [event.kind, event.player])
    ).toEqual([
      ["goal", "C"],
      ["red_card", "E"],
      ["goal", "A"],
      ["goal", "D"],
    ]);
  });

  it("is empty when the match has no goals or cards", () => {
    expect(getTeamEvents(match({}), "WRE")).toEqual([]);
    expect(getTeamEvents(null, "WRE")).toEqual([]);
  });
});

describe("getDaysUntil", () => {
  it("counts calendar days in the fan's time zone", () => {
    expect(getDaysUntil(localTime(10, 23, 59), localTime(10, 0, 1))).toBe(0);
    expect(getDaysUntil(localTime(11, 0, 1), localTime(10, 23, 59))).toBe(1);
    expect(getDaysUntil(localTime(14, 15), localTime(10, 12))).toBe(4);
  });

  it("is negative for a day that has passed", () => {
    expect(getDaysUntil(localTime(7, 15), localTime(10, 12))).toBe(-3);
  });
});

describe("getOpponent", () => {
  it("names the other team and whether it was a home match", () => {
    const fixture = match();
    expect(getOpponent(fixture, "WRE")).toEqual({
      opponent: { key: "DER" },
      isHome: false,
    });
    expect(getOpponent(fixture, "DER")).toEqual({
      opponent: { key: "WRE" },
      isHome: true,
    });
    expect(getOpponent(fixture, "MID")).toBeNull();
  });
});

describe("getScoreForTeam", () => {
  it("puts the team's own goals first", () => {
    const scored = match({ home_score: 1, away_score: 2 });
    expect(getScoreForTeam(scored, "WRE")).toEqual({ ours: 2, theirs: 1 });
    expect(getScoreForTeam(scored, "DER")).toEqual({ ours: 1, theirs: 2 });
  });

  it("is null before kickoff or for a team that didn't play", () => {
    expect(getScoreForTeam(match(), "WRE")).toBeNull();
    expect(
      getScoreForTeam(match({ home_score: 1, away_score: 0 }), "MID")
    ).toBeNull();
  });
});

describe("getMatchForPhase", () => {
  const data = { focus_match: { id: 1 }, next_match: { id: 2 } };

  it("shows the next match on an off day", () => {
    expect(getMatchForPhase(data, PHASES.OFFDAY)).toBe(data.next_match);
  });

  it("shows today's match on matchday", () => {
    expect(getMatchForPhase(data, PHASES.LIVE)).toBe(data.focus_match);
  });

  it("copes with no data", () => {
    expect(getMatchForPhase(null, PHASES.OFFDAY)).toBeNull();
  });
});

describe("getResultForTeam", () => {
  it("reads the result from the team's side", () => {
    const scored = match({ home_score: 1, away_score: 2 });
    expect(getResultForTeam(scored, "WRE")).toBe("win");
    expect(getResultForTeam(scored, "DER")).toBe("loss");
    expect(
      getResultForTeam(match({ home_score: 0, away_score: 0 }), "WRE")
    ).toBe("draw");
  });

  it("is null without a score or for a team that didn't play", () => {
    expect(getResultForTeam(match(), "WRE")).toBeNull();
    expect(
      getResultForTeam(match({ home_score: 1, away_score: 0 }), "MID")
    ).toBeNull();
  });
});

describe("getPositionChange", () => {
  const row = (position, previous_position) => ({
    position,
    previous_position,
    team: { key: "WRE" },
  });

  it("says which way the team moved", () => {
    expect(getPositionChange([row(6, 7)], "WRE")).toEqual({
      position: 6,
      direction: "up",
    });
    expect(getPositionChange([row(8, 7)], "WRE").direction).toBe("down");
    expect(getPositionChange([row(7, 7)], "WRE").direction).toBe("same");
  });

  it("is null without a previous position to compare", () => {
    expect(getPositionChange([row(6, undefined)], "WRE")).toBeNull();
    expect(getPositionChange([row(6, null)], "WRE")).toBeNull();
  });

  it("is null when the team isn't in the table", () => {
    expect(getPositionChange([row(1, 1)], "MID")).toBeNull();
    expect(getPositionChange(undefined, "WRE")).toBeNull();
  });
});
