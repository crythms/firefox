/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { act, fireEvent, render } from "@testing-library/react";
import { INITIAL_STATE } from "common/Reducers.sys.mjs";
import { actionTypes as at } from "common/Actions.mjs";
import {
  Wrexham,
  WREXHAM_LINKS,
} from "content-src/components/Widgets/Wrexham/Wrexham";
import { getDaysUntil } from "content-src/components/Widgets/Wrexham/wrexhamPhase.mjs";
import { buildMockData } from "lib/Widgets/WrexhamMockData.sys.mjs";
import { WrapWithProvider } from "test/jest/test-utils";

// Midday local time, so every scenario's matchday falls on today.
const NOW = new Date(2026, 9, 10, 12, 0).getTime();

const makeState = ({ scenario = "offday", size = "large", data } = {}) => ({
  ...INITIAL_STATE,
  Prefs: {
    ...INITIAL_STATE.Prefs,
    values: {
      ...INITIAL_STATE.Prefs.values,
      "widgets.system.enabled": true,
      "widgets.system.wrexham.enabled": true,
      "widgets.wrexham.enabled": true,
      "widgets.wrexham.size": size,
    },
  },
  Wrexham: {
    initialized: data !== null,
    data: data === undefined ? buildMockData(scenario, NOW) : data,
  },
});

const renderWidget = (stateOptions = {}, props = {}) => {
  const dispatch = props.dispatch || jest.fn();
  const handleUserInteraction = props.handleUserInteraction || jest.fn();
  const ui = options => (
    <WrapWithProvider state={makeState(options)}>
      <Wrexham
        dispatch={dispatch}
        handleUserInteraction={handleUserInteraction}
        widgetsMayBeMaximized={true}
        widgetEnabledMap={{}}
        {...props}
      />
    </WrapWithProvider>
  );
  const { container, rerender, unmount } = render(ui(stateOptions));
  // Swaps in new data, as a feed update would, keeping the same component.
  const rerenderWith = options => rerender(ui(options));
  return { container, dispatch, handleUserInteraction, rerenderWith, unmount };
};

const args = el => JSON.parse(el.getAttribute("data-l10n-args"));
const selectedTab = container =>
  container.querySelector("[role='tab'][aria-selected='true']");
const footer = container => container.querySelector(".wrexham-footer-link");
const userEvents = (dispatch, userAction) =>
  dispatch.mock.calls
    .map(([action]) => action)
    .filter(
      action =>
        action?.type === at.WIDGETS_USER_EVENT &&
        action.data?.user_action === userAction
    );

describe("Wrexham widget", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders at the large size by default with the header and tabs", () => {
    const { container } = renderWidget({ size: "" });
    const root = container.querySelector("article.wrexham");
    expect(root.className).toContain("large-widget");
    expect(
      container
        .querySelector("#wrexham-widget-label")
        .getAttribute("data-l10n-id")
    ).toBe("newtab-wrexham-widget-title");
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(3);
  });

  it("renders only the header until data arrives", () => {
    const { container } = renderWidget({ data: null });
    expect(container.querySelector(".wrexham-header")).toBeTruthy();
    expect(container.querySelector("[role='tablist']")).toBeNull();
    expect(container.querySelector(".wrexham-footer-link")).toBeNull();
  });

  describe("on an off day", () => {
    it("opens on the Match tab with no badge", () => {
      const { container } = renderWidget({ scenario: "offday" });
      expect(selectedTab(container).id).toBe("wrexham-tab-match");
      expect(container.querySelector(".wrexham-badge")).toBeNull();
      expect(container.querySelector(".wrexham-offday")).toBeTruthy();
      expect(container.querySelector(".wrexham-competition").textContent).toBe(
        "Championship"
      );
    });

    it("shows the last result with its chip, Wrexham's goals first", () => {
      const { container } = renderWidget({ scenario: "offday" });
      const row = container.querySelector(".wrexham-offday-row");
      expect(
        row.querySelector(".wrexham-result").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-result-win");
      expect(
        args(
          row.querySelector(
            "[data-l10n-id='newtab-wrexham-widget-last-result']"
          )
        )
      ).toEqual({ ours: 2, theirs: 1, opponent: "Southampton" });
    });

    it("shows the last five results as a labelled form strip", () => {
      const { container } = renderWidget({ scenario: "offday" });
      const strip = container.querySelector("ol.wrexham-form");
      expect(strip.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-form-list"
      );
      expect(args(strip)).toEqual({ count: 5 });
      const chips = [...strip.querySelectorAll("li")];
      expect(
        chips.map(
          chip => chip.className.match(/wrexham-result-(win|draw|loss)/)[1]
        )
      ).toEqual(["draw", "loss", "win", "draw", "win"]);
      expect(
        chips[0].querySelector(".sr-only").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-result-draw");
    });

    it("shows the next match with a relative day above the kickoff time", () => {
      const data = buildMockData("offday", NOW);
      const { container } = renderWidget({ data });
      const next = container.querySelector(".wrexham-offday-next");
      const opponent = next.querySelector(".wrexham-offday-opponent");
      expect(opponent.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-opponent-away"
      );
      expect(args(opponent)).toEqual({ opponent: "Derby County" });
      const kickoff = Date.parse(data.next_match.date);
      const when = next.querySelector(".wrexham-offday-when");
      expect(args(when)).toEqual({
        date: kickoff,
        days: getDaysUntil(kickoff, NOW),
      });
      const time = next.querySelector(".wrexham-offday-time");
      expect(args(time)).toEqual({ date: kickoff });
      expect(
        when.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-preview"
      );
    });

    it("keeps the Table tab, with Wrexham highlighted", () => {
      const { container } = renderWidget({ scenario: "offday" });
      fireEvent.click(container.querySelector("#wrexham-tab-table"));
      expect(
        container.querySelectorAll(".wrexham-table tbody tr")
      ).toHaveLength(24);
      expect(
        container.querySelector(".wrexham-table-row-highlight").textContent
      ).toContain("Wrexham");
      expect(footer(container).getAttribute("href")).toBe(WREXHAM_LINKS.table);
    });

    it("pins Wrexham's fixture above the others, which start collapsed", () => {
      const { container } = renderWidget({ scenario: "offday" });
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      const fixtures = container.querySelector(".wrexham-fixtures");
      const firstRow = fixtures.querySelector(".wrexham-fixture");
      expect(firstRow.classList).toContain("wrexham-fixture-highlight");
      expect(firstRow.textContent).toContain("Wrexham");
      const others = fixtures.querySelector("details.wrexham-fixtures-others");
      expect(others.open).toBe(false);
      expect(args(others.querySelector("summary"))).toEqual({
        league: "Championship",
        count: 11,
      });
      expect(others.querySelectorAll(".wrexham-fixture")).toHaveLength(11);
      expect(
        container.querySelectorAll(".wrexham-fixture-highlight")
      ).toHaveLength(1);
      expect(footer(container).getAttribute("href")).toBe(
        WREXHAM_LINKS.fixtures
      );
    });

    it("lists every fixture openly when Wrexham aren't in the round", () => {
      const data = buildMockData("offday", NOW);
      data.gameweek.matches = data.gameweek.matches.filter(
        match => match.home_team.key !== "WRE" && match.away_team.key !== "WRE"
      );
      const { container } = renderWidget({ data });
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      expect(container.querySelector("details")).toBeNull();
      expect(container.querySelectorAll(".wrexham-fixture")).toHaveLength(11);
    });
  });

  describe("before kickoff", () => {
    it("counts down to kickoff above the kickoff time", () => {
      const { container } = renderWidget({ scenario: "prematch" });
      const countdown = container.querySelector(".wrexham-countdown");
      expect(countdown.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-countdown"
      );
      expect(args(countdown)).toEqual({ hours: 3, minutes: 0 });
      expect(countdown.nextElementSibling.classList).toContain(
        "wrexham-kickoff-time"
      );
      expect(container.querySelector(".wrexham-kickoff-zone")).toBeTruthy();
    });

    it("keeps the countdown current as time passes", () => {
      // Date.now stays on the spy, which the test moves by hand.
      jest.useFakeTimers({ doNotFake: ["Date"] });
      try {
        const { container } = renderWidget({ scenario: "prematch" });
        const countdown = () => container.querySelector(".wrexham-countdown");
        expect(args(countdown())).toEqual({ hours: 3, minutes: 0 });
        Date.now.mockReturnValue(NOW + 48 * 60 * 1000);
        act(() => jest.advanceTimersByTime(30 * 1000));
        expect(args(countdown())).toEqual({ hours: 2, minutes: 12 });
      } finally {
        jest.useRealTimers();
      }
    });

    it("says the match is kicking off once the time has come", () => {
      const data = buildMockData("prematch", NOW);
      data.focus_match.date = new Date(NOW + 30 * 1000).toISOString();
      const { container } = renderWidget({ data });
      const countdown = container.querySelector(".wrexham-countdown");
      expect(countdown.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-countdown-now"
      );
      expect(countdown.hasAttribute("data-l10n-args")).toBe(false);
    });

    it("shows the Matchday badge and the local kickoff", () => {
      const { container } = renderWidget({ scenario: "prematch" });
      expect(
        container.querySelector(".wrexham-badge").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-badge-matchday");
      const time = container.querySelector(".wrexham-kickoff-time");
      expect(args(time).date).toBe(new Date(2026, 9, 10, 15).getTime());
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-preview"
      );
    });

    it("gives the kickoff time in Wrexham unless the fan's clock matches it", () => {
      const { container } = renderWidget({ scenario: "prematch" });
      const zone = container.querySelector(".wrexham-kickoff-zone");
      const { clubTime } = args(zone);
      const kickoff = new Date(2026, 9, 10, 15);
      const wrexhamClock = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/London",
        hour: "numeric",
        minute: "2-digit",
      }).format(kickoff);
      const localClock = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      if (localClock.format(kickoff) === wrexhamClock) {
        expect(zone.getAttribute("data-l10n-id")).toBe(
          "newtab-wrexham-widget-kickoff-zone"
        );
        expect(clubTime).toBeNull();
      } else {
        expect(zone.getAttribute("data-l10n-id")).toBe(
          "newtab-wrexham-widget-kickoff-zone-club"
        );
        // Read on the fan's clock, the shifted time shows Wrexham's.
        expect(localClock.format(new Date(clubTime))).toBe(wrexhamClock);
      }
    });
  });

  describe("during the match", () => {
    it("shows the live score and clock", () => {
      const { container } = renderWidget({ scenario: "live" });
      const badge = container.querySelector(".wrexham-badge");
      expect(badge.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-badge-live-clock"
      );
      expect(args(badge)).toEqual({ clock: "67" });
      expect(
        args(container.querySelector(".wrexham-match .wrexham-live-clock"))
      ).toEqual({ clock: "67" });
      expect(args(container.querySelector(".wrexham-score"))).toEqual({
        home: 1,
        away: 2,
      });
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-centre"
      );
    });

    it("marks penalties and own goals, and lists red cards in order", () => {
      const { container } = renderWidget({ scenario: "live" });
      const home = container.querySelector(".wrexham-goals-home");
      const away = container.querySelector(".wrexham-goals-away");
      const [penalty, card] = home.querySelectorAll("li");
      expect(args(penalty)).toEqual({
        player: "T. Clarke",
        minute: 34,
        type: "penalty",
      });
      expect(card.classList).toContain("wrexham-event-red-card");
      expect(
        card.querySelector(".wrexham-card-icon").getAttribute("aria-hidden")
      ).toBe("true");
      expect(card.querySelector(".sr-only").getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-red-card-label"
      );
      expect(
        args(
          card.querySelector("[data-l10n-id='newtab-wrexham-widget-red-card']")
        )
      ).toEqual({ player: "K. Ward", minute: 63 });
      expect([...away.querySelectorAll("li")].map(args)).toEqual([
        { player: "J. Evans", minute: 12, type: "goal" },
        { player: "M. Hart", minute: 58, type: "own_goal" },
      ]);
    });

    it("writes stoppage-time goals as minute plus extra", () => {
      const data = buildMockData("live", NOW);
      data.focus_match.goals = [
        { team_key: "WRE", player: "J. Evans", minute: 90, minute_extra: 3 },
      ];
      data.focus_match.red_cards = [];
      const { container } = renderWidget({ data });
      expect(args(container.querySelector(".wrexham-event-goal"))).toEqual({
        player: "J. Evans",
        minute: "90+3",
        type: "goal",
      });
    });

    it("shows how fresh the score is", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data });
      const cue = () => container.querySelector(".wrexham-updated");
      expect(cue().getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-updated"
      );
      expect(args(cue())).toEqual({ minutes: 0 });
      rerenderWith({
        data: {
          ...data,
          focus_match: { ...data.focus_match, updated: NOW / 1000 - 150 },
        },
      });
      expect(args(cue())).toEqual({ minutes: 2 });
    });

    it("shows the freshness cue at half time but not after the match", () => {
      expect(
        renderWidget({ scenario: "halftime" }).container.querySelector(
          ".wrexham-updated"
        )
      ).toBeTruthy();
      expect(
        renderWidget({ scenario: "fulltime" }).container.querySelector(
          ".wrexham-updated"
        )
      ).toBeNull();
    });

    it("shows half time from the Break status", () => {
      const { container } = renderWidget({ scenario: "halftime" });
      expect(
        container.querySelector(".wrexham-badge").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-badge-half-time");
      expect(
        container
          .querySelector(".wrexham-match .wrexham-live-clock")
          .getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-half-time");
    });

    it("shows a plain Live badge when there's no clock", () => {
      const data = buildMockData("live", NOW);
      data.focus_match.clock = "0";
      const { container } = renderWidget({ data });
      expect(
        container.querySelector(".wrexham-badge").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-badge-live");
      expect(
        container.querySelector(".wrexham-match .wrexham-live-clock")
      ).toBeNull();
    });

    it("names each team's list of scorers after the team", () => {
      const { container } = renderWidget({ scenario: "live" });
      const labelOf = list =>
        container.querySelector(`#${list.getAttribute("aria-labelledby")}`)
          .textContent;
      const home = container.querySelector(".wrexham-goals-home");
      const away = container.querySelector(".wrexham-goals-away");
      expect(labelOf(home)).toBe("Derby County");
      expect(labelOf(away)).toBe("Wrexham");
    });

    it("renders no empty list for a team that hasn't scored", () => {
      const data = buildMockData("live", NOW);
      data.focus_match.goals = data.focus_match.goals.filter(
        goal => goal.team_key === "WRE"
      );
      data.focus_match.red_cards = [];
      const { container } = renderWidget({ data });
      expect(container.querySelector("ul.wrexham-goals-home")).toBeNull();
      expect(container.querySelector("div.wrexham-goals-home")).toBeTruthy();
    });
  });

  describe("after the final whistle", () => {
    it("shows the result, the win and the table move", () => {
      const { container } = renderWidget({ scenario: "fulltime" });
      expect(
        container.querySelector(".wrexham-badge").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-badge-full-time");
      expect(
        container.querySelector(".wrexham-result").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-result-win");
      const line = container.querySelector(".wrexham-position-line");
      expect(line.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-position-up"
      );
      expect(args(line)).toEqual({ position: 6, league: "Championship" });
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-report"
      );
    });

    it("puts the table move straight under the result, above the scorers", () => {
      const { container } = renderWidget({ scenario: "fulltime" });
      const teams = container.querySelector(".wrexham-match-teams");
      const line = container.querySelector(".wrexham-position-line");
      expect(teams.nextElementSibling).toBe(line);
      expect(line.nextElementSibling.classList).toContain("wrexham-goals");
    });

    it("leaves out the table move when there's no previous position", () => {
      const data = buildMockData("fulltime", NOW);
      data.standings = data.standings.map(row => ({
        ...row,
        previous_position: null,
      }));
      const { container } = renderWidget({ data });
      expect(container.querySelector(".wrexham-result")).toBeTruthy();
      expect(container.querySelector(".wrexham-position-line")).toBeNull();
    });
  });

  describe("score announcements", () => {
    const liveRegion = container =>
      container.querySelector("[role='status'][aria-live='polite']");
    const withScore = (data, home, away, extra = {}) => ({
      ...data,
      focus_match: {
        ...data.focus_match,
        home_score: home,
        away_score: away,
        ...extra,
      },
    });

    it("has an empty polite live region on first render", () => {
      const { container } = renderWidget({ scenario: "live" });
      const region = liveRegion(container);
      expect(region.getAttribute("aria-atomic")).toBe("true");
      expect(region.classList).toContain("sr-only");
      expect(region.children).toHaveLength(0);
      expect(container.querySelector(".wrexham-score-changed")).toBeNull();
    });

    it("announces a goal and highlights the score", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data });
      rerenderWith({ data: withScore(data, 1, 3) });
      const message = liveRegion(container).firstElementChild;
      expect(message.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-announce-goal"
      );
      expect(args(message)).toEqual({
        team: "Wrexham",
        home: "Derby County",
        away: "Wrexham",
        homeScore: 1,
        awayScore: 3,
      });
      expect(container.querySelector(".wrexham-score").classList).toContain(
        "wrexham-score-changed"
      );
    });

    it("replaces the announcement for each new goal", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data });
      rerenderWith({ data: withScore(data, 1, 3) });
      const first = liveRegion(container).firstElementChild;
      rerenderWith({ data: withScore(data, 2, 3) });
      const second = liveRegion(container).firstElementChild;
      expect(second).not.toBe(first);
      expect(liveRegion(container).children).toHaveLength(1);
      expect(args(second).team).toBe("Derby County");
    });

    it("reads out a corrected score without crediting a team", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data });
      rerenderWith({ data: withScore(data, 1, 1) });
      expect(
        liveRegion(container).firstElementChild.getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-announce-score");
    });

    it("stays quiet at kickoff, when the score first appears", () => {
      const prematch = buildMockData("prematch", NOW);
      const { container, rerenderWith } = renderWidget({ data: prematch });
      rerenderWith({
        data: withScore(prematch, 0, 0, {
          date: new Date(NOW).toISOString(),
          status_type: "live",
          status: "In Progress",
        }),
      });
      expect(container.querySelector(".wrexham-badge-live")).toBeTruthy();
      expect(liveRegion(container).children).toHaveLength(0);
      expect(container.querySelector(".wrexham-score-changed")).toBeNull();
    });

    it("stays quiet when an update doesn't change the score", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data });
      rerenderWith({ data: withScore(data, 1, 2, { clock: "68" }) });
      expect(liveRegion(container).children).toHaveLength(0);
      expect(container.querySelector(".wrexham-score-changed")).toBeNull();
    });

    it("announces the final result when the match ends", () => {
      const live = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data: live });
      rerenderWith({
        data: withScore(live, 1, 2, {
          status_type: "past",
          status: "Final",
          updated: NOW / 1000,
        }),
      });
      const message = liveRegion(container).firstElementChild;
      expect(message.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-announce-full-time"
      );
      expect(args(message)).toMatchObject({
        result: "win",
        homeScore: 1,
        awayScore: 2,
      });
    });

    it("announces goals at the medium size too", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({
        data,
        size: "medium",
      });
      rerenderWith({ data: withScore(data, 1, 3), size: "medium" });
      expect(liveRegion(container).firstElementChild).toBeTruthy();
      expect(
        container.querySelector(".wrexham-compact .wrexham-score").classList
      ).toContain("wrexham-score-changed");
    });
  });

  describe("postponed and delayed matches", () => {
    it("isn't matchday when today's match is postponed", () => {
      const data = buildMockData("prematch", NOW);
      data.focus_match.status = "Postponed";
      const { container } = renderWidget({ data });
      expect(container.querySelector(".wrexham-badge")).toBeNull();
      expect(container.querySelector(".wrexham-offday")).toBeTruthy();
    });

    it("stays on matchday when the kickoff is delayed", () => {
      const data = buildMockData("prematch", NOW);
      data.focus_match.status = "Delayed";
      const { container } = renderWidget({ data });
      expect(
        container.querySelector(".wrexham-badge").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-badge-matchday");
      expect(
        container
          .querySelector(".wrexham-countdown")
          .getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-countdown-delayed");
    });
  });

  describe("tabs", () => {
    it("switches tab on click and records change_tab", () => {
      const { container, dispatch, handleUserInteraction } = renderWidget({
        scenario: "offday",
      });
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      expect(selectedTab(container).id).toBe("wrexham-tab-fixtures");
      expect(
        container
          .querySelector("[role='tabpanel']")
          .getAttribute("aria-labelledby")
      ).toBe("wrexham-tab-fixtures");
      const [event] = userEvents(dispatch, "change_tab");
      expect(event.data).toMatchObject({
        widget_name: "wrexham",
        widget_source: "widget",
        action_value: "fixtures",
      });
      expect(handleUserInteraction).toHaveBeenCalledWith("wrexham");
    });

    it("moves between tabs with the arrow, Home and End keys", () => {
      const { container } = renderWidget({ scenario: "prematch" });
      const tablist = container.querySelector("[role='tablist']");
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
      expect(selectedTab(container).id).toBe("wrexham-tab-table");
      expect(document.activeElement).toBe(selectedTab(container));
      fireEvent.keyDown(tablist, { key: "End" });
      expect(selectedTab(container).id).toBe("wrexham-tab-fixtures");
      fireEvent.keyDown(tablist, { key: "Home" });
      expect(selectedTab(container).id).toBe("wrexham-tab-match");
    });

    it("wraps the arrow keys from one end of the tabs to the other", () => {
      const { container } = renderWidget({ scenario: "prematch" });
      const tablist = container.querySelector("[role='tablist']");
      fireEvent.keyDown(tablist, { key: "ArrowLeft" });
      expect(selectedTab(container).id).toBe("wrexham-tab-fixtures");
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
      expect(selectedTab(container).id).toBe("wrexham-tab-match");
    });

    it("leaves arrow keys with modifiers to the browser", () => {
      const { container } = renderWidget({ scenario: "prematch" });
      const tablist = container.querySelector("[role='tablist']");
      const notPrevented = fireEvent.keyDown(tablist, {
        key: "ArrowLeft",
        altKey: true,
      });
      expect(notPrevented).toBe(true);
      expect(selectedTab(container).id).toBe("wrexham-tab-match");
    });

    it("keeps only the selected tab in the tab order", () => {
      const { container } = renderWidget({ scenario: "offday" });
      const tabIndexes = [...container.querySelectorAll("[role='tab']")].map(
        tab => tab.tabIndex
      );
      expect(tabIndexes).toEqual([0, -1, -1]);
    });

    it("updates the Match tab when the match state changes", () => {
      const { container, rerenderWith } = renderWidget({ scenario: "offday" });
      expect(container.querySelector(".wrexham-offday")).toBeTruthy();
      rerenderWith({ scenario: "live" });
      expect(container.querySelector(".wrexham-offday")).toBeNull();
      expect(container.querySelector(".wrexham-score")).toBeTruthy();
    });

    it("keeps the user's tab when the match state changes", () => {
      const { container, rerenderWith } = renderWidget({ scenario: "offday" });
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      rerenderWith({ scenario: "live" });
      expect(selectedTab(container).id).toBe("wrexham-tab-fixtures");
    });
  });

  describe("table", () => {
    it("names the table and gives it full column names and row headers", () => {
      const { container } = renderWidget({ scenario: "offday" });
      fireEvent.click(container.querySelector("#wrexham-tab-table"));
      const table = container.querySelector(".wrexham-table");
      expect(table.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-table"
      );
      expect(args(table)).toEqual({ league: "Championship" });
      expect(
        container
          .querySelector("thead th:nth-child(3)")
          .getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-table-played");
      expect(container.querySelectorAll("tbody th[scope='row']")).toHaveLength(
        24
      );
    });

    it("shows a message instead of an empty table", () => {
      const data = buildMockData("offday", NOW);
      data.standings = [];
      const { container } = renderWidget({ data });
      fireEvent.click(container.querySelector("#wrexham-tab-table"));
      expect(container.querySelector(".wrexham-table")).toBeNull();
      expect(
        container.querySelector(".wrexham-empty").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-no-table");
    });
  });

  it("records open_link when the footer link is clicked", () => {
    const { container, dispatch } = renderWidget({ scenario: "live" });
    fireEvent.click(footer(container));
    const [event] = userEvents(dispatch, "open_link");
    expect(event.data).toMatchObject({
      widget_source: "match",
      action_value: "match",
    });
  });

  describe("medium size", () => {
    it("shows the next match and a summary line on an off day", () => {
      const data = buildMockData("offday", NOW);
      const { container } = renderWidget({ data, size: "medium" });
      expect(container.querySelector("[role='tablist']")).toBeNull();
      expect(container.querySelector(".wrexham-table")).toBeNull();
      const compact = container.querySelector(".wrexham-compact-offday");
      const opponent = compact.querySelector(".wrexham-compact-primary");
      expect(opponent.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-opponent-away"
      );
      expect(args(opponent)).toEqual({ opponent: "Derby County" });
      const kickoff = Date.parse(data.next_match.date);
      expect(
        args(
          compact.querySelector(
            "[data-l10n-id='newtab-wrexham-widget-relative-day']"
          )
        )
      ).toEqual({ date: kickoff, days: getDaysUntil(kickoff, NOW) });
      expect(args(compact.querySelector(".wrexham-compact-when-time"))).toEqual(
        { date: kickoff }
      );
      expect(
        args(
          compact.querySelector(
            "[data-l10n-id='newtab-wrexham-widget-compact-last']"
          )
        )
      ).toEqual({ result: "win", ours: 2, theirs: 1, opponent: "Southampton" });
      expect(
        args(
          compact.querySelector(
            "[data-l10n-id='newtab-wrexham-widget-compact-position']"
          )
        )
      ).toEqual({ position: 7, points: 18 });
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-preview"
      );
      expect(footer(container).getAttribute("href")).toBe(WREXHAM_LINKS.match);
    });

    it("leaves out the table position when there's no table", () => {
      const data = buildMockData("offday", NOW);
      data.standings = [];
      const { container } = renderWidget({ data, size: "medium" });
      expect(
        container.querySelector(
          "[data-l10n-id='newtab-wrexham-widget-compact-position']"
        )
      ).toBeNull();
      expect(
        container.querySelector(
          "[data-l10n-id='newtab-wrexham-widget-compact-last']"
        )
      ).toBeTruthy();
    });

    it("adds the date to the kickoff time before a match", () => {
      const data = buildMockData("prematch", NOW);
      const { container } = renderWidget({ data, size: "medium" });
      const date = container.querySelector(
        "[data-l10n-id='newtab-wrexham-widget-match-date']"
      );
      expect(args(date)).toEqual({ date: Date.parse(data.focus_match.date) });
    });

    it("shows the live score with a link to the match centre", () => {
      const { container, dispatch } = renderWidget({
        scenario: "live",
        size: "medium",
      });
      expect(
        container.querySelector(".wrexham-compact-match .wrexham-score")
      ).toBeTruthy();
      expect(container.querySelector(".wrexham-compact a")).toBeNull();
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-centre"
      );
      fireEvent.click(footer(container));
      expect(userEvents(dispatch, "open_link")[0].data).toMatchObject({
        widget_source: "compact",
        action_value: "match",
      });
    });
  });

  describe("context menu", () => {
    it("offers medium and large in the size submenu", () => {
      const { container } = renderWidget();
      const sizes = [
        ...container.querySelectorAll("panel-item[data-size]"),
      ].map(el => el.getAttribute("data-size"));
      expect(sizes).toEqual(["medium", "large"]);
    });

    it("picking a size writes the pref and records change_size", () => {
      const { container, dispatch } = renderWidget();
      fireEvent.click(
        container.querySelector(
          "#wrexham-size-submenu panel-item[data-size='medium']"
        )
      );
      const setPref = dispatch.mock.calls.find(
        ([action]) =>
          action?.type === at.SET_PREF &&
          action.data?.name === "widgets.wrexham.size"
      );
      expect(setPref[0].data.value).toBe("medium");
      expect(userEvents(dispatch, "change_size")[0].data).toMatchObject({
        widget_name: "wrexham",
        widget_source: "context_menu",
        widget_size: "medium",
      });
    });
  });
});
