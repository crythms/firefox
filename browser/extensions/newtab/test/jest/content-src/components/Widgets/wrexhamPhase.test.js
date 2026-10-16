/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  PHASES,
  getCountdown,
  getDaysUntil,
  getMatchClock,
  getMatchForPhase,
  getMatchState,
  getPenalties,
  getMonogramColors,
  getResultForTeam,
  getRowMovement,
  getTableZone,
  getWrexhamPhase,
  isExtraTime,
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

  it("is an off day when a scheduled match is cancelled", () => {
    for (const status of ["Canceled", "Cancelled"]) {
      expect(
        getWrexhamPhase(
          match({ status_type: "scheduled", status }),
          localTime(10, 12)
        )
      ).toBe(PHASES.OFFDAY);
    }
  });

  it("keeps a postponed match on its own day", () => {
    const postponed = match({ status_type: "scheduled", status: "Postponed" });
    expect(getWrexhamPhase(postponed, localTime(10, 12))).toBe(PHASES.PREMATCH);
    expect(getWrexhamPhase(postponed, localTime(11, 12))).toBe(PHASES.OFFDAY);
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

describe("getMatchForPhase", () => {
  const data = { focus_match: { id: 1 }, upcoming: [{ id: 2 }, { id: 3 }] };

  it("shows the next match on an off day", () => {
    expect(getMatchForPhase(data, PHASES.OFFDAY)).toBe(data.upcoming[0]);
  });

  it("shows today's match on matchday", () => {
    expect(getMatchForPhase(data, PHASES.LIVE)).toBe(data.focus_match);
  });

  it("copes with no data", () => {
    expect(getMatchForPhase(null, PHASES.OFFDAY)).toBeNull();
  });
});

describe("getMatchState", () => {
  it("labels delays and postponements before kickoff", () => {
    expect(getMatchState(match({ status: "Delayed" }), PHASES.PREMATCH)).toBe(
      "delayed"
    );
    expect(getMatchState(match({ status: "Postponed" }), PHASES.PREMATCH)).toBe(
      "postponed"
    );
    expect(getMatchState(match(), PHASES.PREMATCH)).toBeNull();
    expect(getMatchState(match(), PHASES.OFFDAY)).toBeNull();
  });

  it("labels a match under way or finished", () => {
    expect(getMatchState(match({ status: "In Progress" }), PHASES.LIVE)).toBe(
      "live"
    );
    expect(getMatchState(match({ status: "Break" }), PHASES.LIVE)).toBe(
      "halftime"
    );
    expect(getMatchState(match({ status: "Suspended" }), PHASES.LIVE)).toBe(
      "suspended"
    );
    expect(getMatchState(match(), PHASES.FULLTIME)).toBe("fulltime");
  });
});

describe("cup ties", () => {
  it("spots extra time from the period", () => {
    expect(isExtraTime(match({ period: "ET" }))).toBe(true);
    expect(isExtraTime(match({ period: "2" }))).toBe(false);
  });

  it("reads the shootout score when there is one", () => {
    expect(
      getPenalties(match({ home_penalties: 3, away_penalties: 4 }))
    ).toEqual({ home: 3, away: 4 });
    expect(getPenalties(match())).toBeNull();
  });
});

describe("getResultForTeam", () => {
  it("decides a level match on penalties", () => {
    const shootout = match({
      home_score: 1,
      away_score: 1,
      home_penalties: 3,
      away_penalties: 4,
    });
    expect(getResultForTeam(shootout, "WRE")).toBe("win");
    expect(getResultForTeam(shootout, "DER")).toBe("loss");
  });

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

describe("getRowMovement", () => {
  it("compares the place with the previous one", () => {
    expect(getRowMovement({ position: 6, previous_position: 9 })).toBe("up");
    expect(getRowMovement({ position: 6, previous_position: 5 })).toBe("down");
    expect(getRowMovement({ position: 6, previous_position: 6 })).toBe("same");
    expect(getRowMovement({ position: 6 })).toBeNull();
  });
});

describe("getTableZone", () => {
  it("marks the Championship's promotion, play-off and relegation places", () => {
    const zone = position => getTableZone("championship", position, 24);
    expect([1, 2, 3, 6, 7, 21, 22, 24].map(zone)).toEqual([
      "promotion",
      "promotion",
      "playoffs",
      "playoffs",
      null,
      null,
      "relegation",
      "relegation",
    ]);
  });

  it("marks nothing for a league without known rules", () => {
    expect(getTableZone("league-one", 1, 24)).toBeNull();
  });
});

describe("getMonogramColors", () => {
  it("writes the code in the secondary colour when it's readable", () => {
    expect(
      getMonogramColors({ primary: "#FFFFFF", secondary: "#000000" })
    ).toEqual({ background: "#FFFFFF", text: "#000000" });
  });

  it("falls back to black or white when the secondary colour isn't readable", () => {
    expect(
      getMonogramColors({ primary: "#C8102E", secondary: "#E03030" })
    ).toEqual({ background: "#C8102E", text: "#ffffff" });
    expect(getMonogramColors({ primary: "#F6C343" })).toEqual({
      background: "#F6C343",
      text: "#000000",
    });
  });

  it("is null without a valid primary colour", () => {
    expect(getMonogramColors(undefined)).toBeNull();
    expect(
      getMonogramColors({ primary: "red", secondary: "#000000" })
    ).toBeNull();
  });
});
