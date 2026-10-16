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

const makeState = ({
  scenario = "offday",
  size = "large",
  data,
  error = false,
} = {}) => ({
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
    initialized: data !== null || error,
    data: data === undefined ? buildMockData(scenario, NOW) : data,
    error,
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
const l10nId = el => el?.getAttribute("data-l10n-id");
const selectedTab = container =>
  container.querySelector("[role='tab'][aria-selected='true']");
const footer = container => container.querySelector(".wrexham-footer-link");
const status = container => container.querySelector(".wrexham-status");
const scorePill = container => container.querySelector(".wrexham-score-pill");
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
    expect(l10nId(container.querySelector("#wrexham-widget-label"))).toBe(
      "newtab-wrexham-widget-title"
    );
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(3);
  });

  it("renders only the header until data arrives", () => {
    const { container } = renderWidget({ data: null });
    expect(container.querySelector(".wrexham-header")).toBeTruthy();
    expect(container.querySelector("[role='tablist']")).toBeNull();
    expect(footer(container)).toBeNull();
  });

  describe("on an off day", () => {
    it("shows the next match with the day it's on", () => {
      const data = buildMockData("offday", NOW);
      const { container } = renderWidget({ data });
      const [next] = data.upcoming;
      const kickoff = Date.parse(next.date);
      expect(selectedTab(container).id).toBe("wrexham-tab-match");
      expect(status(container)).toBeNull();
      expect(args(container.querySelector(".wrexham-match-meta-text"))).toEqual(
        { date: kickoff, venue: "Pride Park" }
      );
      expect(args(container.querySelector(".wrexham-kickoff-time"))).toEqual({
        date: kickoff,
      });
      const when = container.querySelector(".wrexham-kickoff-when");
      expect(l10nId(when)).toBe("newtab-wrexham-widget-relative-day");
      expect(args(when)).toEqual({
        date: kickoff,
        days: getDaysUntil(kickoff, NOW),
      });
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-link-match-details"
      );
    });
  });

  describe("before kickoff", () => {
    it("shows the kickoff time between the teams with a countdown", () => {
      const { container } = renderWidget({ scenario: "prematch" });
      expect(status(container)).toBeNull();
      expect(args(container.querySelector(".wrexham-kickoff-time")).date).toBe(
        new Date(2026, 9, 10, 15).getTime()
      );
      const countdown = container.querySelector(".wrexham-kickoff-when");
      expect(l10nId(countdown)).toBe("newtab-wrexham-widget-countdown");
      expect(args(countdown)).toEqual({ hours: 3, minutes: 0 });
      expect(footer(container).classList).not.toContain(
        "wrexham-footer-link-outline"
      );
    });

    it("keeps the countdown current as time passes", () => {
      // Date.now stays on the spy, which the test moves by hand.
      jest.useFakeTimers({ doNotFake: ["Date"] });
      try {
        const { container } = renderWidget({ scenario: "prematch" });
        const countdown = () =>
          container.querySelector(".wrexham-kickoff-when");
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
      const countdown = container.querySelector(".wrexham-kickoff-when");
      expect(l10nId(countdown)).toBe("newtab-wrexham-widget-countdown-now");
      expect(countdown.hasAttribute("data-l10n-args")).toBe(false);
    });
  });

  describe("during the match", () => {
    it("shows the live score with the minute between the sides", () => {
      const { container } = renderWidget({ scenario: "live" });
      expect(status(container).classList).toContain("wrexham-status-live");
      expect(
        container.querySelector(".wrexham-match-meta-text").textContent
      ).toBe("Pride Park");
      const pill = scorePill(container);
      expect(pill.classList).toContain("wrexham-score-pill-live");
      expect(
        [...pill.querySelectorAll(".wrexham-score-digit")].map(
          digit => digit.textContent
        )
      ).toEqual(["1", "2"]);
      expect(
        args(pill.querySelector("[data-l10n-id='newtab-wrexham-widget-clock']"))
      ).toEqual({ clock: "67" });
      const label = pill.querySelector(".sr-only");
      expect(l10nId(label)).toBe("newtab-wrexham-widget-score-label-clock");
      expect(args(label)).toEqual({
        home: "Derby County",
        away: "Wrexham AFC",
        homeScore: 1,
        awayScore: 2,
        clock: "67",
      });
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-link-match-centre"
      );
      expect(footer(container).classList).toContain(
        "wrexham-footer-link-outline"
      );
    });

    it("shows half time in the pill and in the score", () => {
      const { container } = renderWidget({ scenario: "halftime" });
      expect(status(container).classList).toContain("wrexham-status-halftime");
      const pill = scorePill(container);
      expect(l10nId(pill.querySelector(".wrexham-score-middle span"))).toBe(
        "newtab-wrexham-widget-half-time-short"
      );
      expect(l10nId(pill.querySelector(".sr-only"))).toBe(
        "newtab-wrexham-widget-score-label"
      );
    });

    it("leaves the middle of the score empty when there's no clock", () => {
      const data = buildMockData("live", NOW);
      data.focus_match.clock = "0";
      const { container } = renderWidget({ data });
      expect(container.querySelector(".wrexham-score-middle")).toBeNull();
      expect(l10nId(scorePill(container).querySelector(".sr-only"))).toBe(
        "newtab-wrexham-widget-score-label"
      );
    });

    it("fills the opponent's badge with its club colours", () => {
      const { container } = renderWidget({ scenario: "live" });
      const badge = container.querySelector(".wrexham-team-code");
      expect(badge.classList).toContain("wrexham-team-code-club");
      expect(badge.style.getPropertyValue("--wrexham-team-color")).toBe(
        "#FFFFFF"
      );
      expect(badge.style.getPropertyValue("--wrexham-team-on-color")).toBe(
        "#000000"
      );
    });

    it("keeps the plain badge when the club colours aren't usable", () => {
      const data = buildMockData("live", NOW);
      data.focus_match.home_team.colors = { primary: "white" };
      const { container } = renderWidget({ data });
      const badge = container.querySelector(".wrexham-team-code");
      expect(badge.classList).not.toContain("wrexham-team-code-club");
      expect(badge.hasAttribute("style")).toBe(false);
    });
  });

  describe("after the final whistle", () => {
    it("shows the final score with a dash between the sides", () => {
      const { container } = renderWidget({ scenario: "fulltime" });
      expect(status(container).classList).toContain("wrexham-status-fulltime");
      const pill = scorePill(container);
      expect(pill.classList).toContain("wrexham-score-pill-final");
      expect(pill.querySelector(".wrexham-score-middle").textContent).toBe("–");
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-link-match-report"
      );
      expect(footer(container).classList).toContain(
        "wrexham-footer-link-outline"
      );
    });

    it("shows the final score without a pill at the medium size", () => {
      const { container } = renderWidget({
        scenario: "fulltime",
        size: "medium",
      });
      expect(scorePill(container).classList).toContain(
        "wrexham-score-pill-plain"
      );
    });
  });

  describe("score changes", () => {
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

    it("has an empty polite live region and no animation on first render", () => {
      const { container } = renderWidget({ scenario: "live" });
      const region = liveRegion(container);
      expect(region.getAttribute("aria-atomic")).toBe("true");
      expect(region.children).toHaveLength(0);
      expect(container.querySelector(".wrexham-celebrate")).toBeNull();
      expect(container.querySelector(".wrexham-score-changed")).toBeNull();
    });

    it("announces and celebrates a Wrexham goal", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data });
      rerenderWith({ data: withScore(data, 1, 3) });
      const message = liveRegion(container).firstElementChild;
      expect(l10nId(message)).toBe("newtab-wrexham-widget-announce-goal");
      expect(args(message)).toEqual({
        team: "Wrexham AFC",
        home: "Derby County",
        away: "Wrexham AFC",
        homeScore: 1,
        awayScore: 3,
      });
      const pill = scorePill(container);
      expect(pill.classList).toContain("wrexham-celebrate");
      expect(pill.querySelector(".wrexham-plus-one-away")).toBeTruthy();
      expect(pill.querySelector(".wrexham-confetti")).toBeTruthy();
      expect(
        container.querySelector(".wrexham-team-crest").classList
      ).toContain("wrexham-celebrate");
    });

    it("only highlights the score for an opponent's goal", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data });
      rerenderWith({ data: withScore(data, 2, 2) });
      expect(args(liveRegion(container).firstElementChild).team).toBe(
        "Derby County"
      );
      const pill = scorePill(container);
      expect(pill.classList).toContain("wrexham-score-changed");
      expect(pill.classList).not.toContain("wrexham-celebrate");
      expect(container.querySelector(".wrexham-plus-one")).toBeNull();
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
    });

    it("reads out a corrected score without crediting a team", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({ data });
      rerenderWith({ data: withScore(data, 1, 1) });
      expect(l10nId(liveRegion(container).firstElementChild)).toBe(
        "newtab-wrexham-widget-announce-score"
      );
      expect(container.querySelector(".wrexham-celebrate")).toBeNull();
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
      expect(status(container).classList).toContain("wrexham-status-live");
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
      expect(l10nId(message)).toBe("newtab-wrexham-widget-announce-full-time");
      expect(args(message)).toMatchObject({
        result: "win",
        homeScore: 1,
        awayScore: 2,
      });
    });

    it("announces and celebrates at the medium size too", () => {
      const data = buildMockData("live", NOW);
      const { container, rerenderWith } = renderWidget({
        data,
        size: "medium",
      });
      rerenderWith({ data: withScore(data, 1, 3), size: "medium" });
      expect(liveRegion(container).firstElementChild).toBeTruthy();
      expect(scorePill(container).classList).toContain("wrexham-celebrate");
    });
  });

  describe("delayed, postponed and suspended matches", () => {
    it("labels a delayed kickoff instead of counting down", () => {
      const { container } = renderWidget({ scenario: "delayed" });
      expect(status(container).classList).toContain("wrexham-status-delayed");
      const place = container.querySelector(".wrexham-match-meta-text");
      expect(place.textContent).toBe("EFL Championship");
      expect(place.classList).toContain("wrexham-match-meta-competition");
      expect(footer(container).classList).toContain(
        "wrexham-footer-link-outline"
      );
      expect(container.querySelector(".wrexham-kickoff-time")).toBeTruthy();
      expect(
        container
          .querySelector(".wrexham-slide")
          .querySelector(".wrexham-kickoff-when")
      ).toBeNull();
    });

    it("keeps a postponed match on its day, labelled", () => {
      const { container } = renderWidget({ scenario: "postponed" });
      expect(status(container).classList).toContain("wrexham-status-postponed");
      expect(container.querySelector(".wrexham-kickoff-time")).toBeTruthy();
      expect(
        container
          .querySelector(".wrexham-slide")
          .querySelector(".wrexham-kickoff-when")
      ).toBeNull();
    });

    it("shows a suspended match's score as it stands", () => {
      const { container } = renderWidget({ scenario: "suspended" });
      expect(status(container).classList).toContain("wrexham-status-suspended");
      const pill = scorePill(container);
      expect(pill.classList).toContain("wrexham-score-pill-plain");
      expect(pill.querySelector(".wrexham-score-middle").textContent).toBe("–");
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-link-match-details"
      );
      expect(footer(container).classList).toContain(
        "wrexham-footer-link-outline"
      );
    });
  });

  describe("cup ties", () => {
    it("names the competition and marks extra time", () => {
      const { container } = renderWidget({ scenario: "extratime" });
      expect(
        container.querySelector(".wrexham-match-meta-text").textContent
      ).toBe("Championship Play-off Final");
      expect(l10nId(container.querySelector(".wrexham-score-caption"))).toBe(
        "newtab-wrexham-widget-extra-time"
      );
      expect(
        args(
          scorePill(container).querySelector(
            "[data-l10n-id='newtab-wrexham-widget-clock']"
          )
        )
      ).toEqual({ clock: "105" });
    });

    it("shows the shootout score beside the match score", () => {
      const { container } = renderWidget({ scenario: "penalties" });
      const pill = scorePill(container);
      expect(
        [...pill.querySelectorAll(".wrexham-score-penalties")].map(
          el => el.textContent
        )
      ).toEqual(["(3)", "(4)"]);
      expect(l10nId(container.querySelector(".wrexham-score-caption"))).toBe(
        "newtab-wrexham-widget-penalties"
      );
      const label = pill.querySelector(".sr-only");
      expect(l10nId(label)).toBe("newtab-wrexham-widget-score-label-penalties");
      expect(args(label)).toMatchObject({ homePenalties: 3, awayPenalties: 4 });
    });

    it("keeps the shootout score in the last results", () => {
      const { container } = renderWidget({ scenario: "penalties" });
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      const last = [
        ...container.querySelectorAll(
          ".wrexham-fixtures-results .wrexham-fixture-main"
        ),
      ].at(-1);
      expect(
        [...last.querySelectorAll(".wrexham-fixture-penalties")].map(
          el => el.textContent
        )
      ).toEqual(["(3)", "(4)"]);
    });
  });

  describe("the next matches", () => {
    const slides = container => [
      ...container.querySelectorAll(".wrexham-slide"),
    ];
    // jsdom does no layout, so the scroller is given a width by hand.
    const swipeTo = (container, index) => {
      const scroller = container.querySelector(".wrexham-slides");
      Object.defineProperty(scroller, "clientWidth", { value: 300 });
      scroller.scrollLeft = index * 300;
      fireEvent.scroll(scroller);
    };

    it("lines up today's or the next match with the two after it", () => {
      const data = buildMockData("offday", NOW);
      const { container } = renderWidget({ data });
      expect(slides(container)).toHaveLength(3);
      expect(args(slides(container)[1])).toEqual({ index: 2, count: 3 });
      expect(
        args(slides(container)[1].querySelector(".wrexham-kickoff-time")).date
      ).toBe(Date.parse(data.upcoming[1].date));
      expect(container.querySelector(".wrexham-slide-dot")).toBeNull();
    });

    it("links to the details of the match swiped to", () => {
      const { container, dispatch } = renderWidget({ scenario: "live" });
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-link-match-centre"
      );
      swipeTo(container, 2);
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-link-match-details"
      );
      expect(userEvents(dispatch, "change_match")[0].data).toMatchObject({
        action_value: "2",
      });
    });

    it("keeps the medium size to one match", () => {
      const { container } = renderWidget({
        scenario: "offday",
        size: "medium",
      });
      expect(slides(container)).toHaveLength(0);
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
      expect(scorePill(container)).toBeNull();
      rerenderWith({ scenario: "live" });
      expect(scorePill(container)).toBeTruthy();
    });

    it("keeps the user's tab when the match state changes", () => {
      const { container, rerenderWith } = renderWidget({ scenario: "offday" });
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      rerenderWith({ scenario: "live" });
      expect(selectedTab(container).id).toBe("wrexham-tab-fixtures");
    });
  });

  describe("table", () => {
    const openTable = options => {
      const rendered = renderWidget(options);
      fireEvent.click(rendered.container.querySelector("#wrexham-tab-table"));
      return rendered;
    };

    it("names the table and gives it full column names and row headers", () => {
      const { container } = openTable({ scenario: "offday" });
      const table = container.querySelector(".wrexham-table");
      expect(l10nId(table)).toBe("newtab-wrexham-widget-table");
      expect(args(table)).toEqual({ league: "EFL Championship" });
      const club = container.querySelector("thead th:first-child");
      expect(l10nId(club)).toBe("newtab-wrexham-widget-table-club");
      expect(club.colSpan).toBe(2);
      expect(l10nId(container.querySelector("thead th:nth-child(2)"))).toBe(
        "newtab-wrexham-widget-table-played"
      );
      const rowHeaders = [
        ...container.querySelectorAll("tbody th[scope='row']"),
      ];
      expect(rowHeaders).toHaveLength(24);
      const westHam = rowHeaders.find(th => th.textContent === "West Ham");
      expect(westHam.getAttribute("title")).toBe("West Ham United");
      expect(footer(container).getAttribute("href")).toBe(WREXHAM_LINKS.table);
    });

    it("marks the promotion, play-off and relegation places, with a key", () => {
      const { container } = openTable({ scenario: "offday" });
      const rows = [...container.querySelectorAll("tbody tr")];
      const zoneAt = position =>
        rows[position - 1]
          .querySelector(".wrexham-table-position")
          .className.match(/wrexham-zone-(\w+)/)?.[1] ?? null;
      expect([1, 3, 7, 22].map(zoneAt)).toEqual([
        "promotion",
        "playoffs",
        null,
        "relegation",
      ]);
      expect(l10nId(rows[0].querySelector(".sr-only"))).toBe(
        "newtab-wrexham-widget-zone-promotion"
      );
      expect(
        [...container.querySelectorAll(".wrexham-table-legend li")].map(l10nId)
      ).toEqual([
        "newtab-wrexham-widget-zone-promotion",
        "newtab-wrexham-widget-zone-playoffs",
        "newtab-wrexham-widget-zone-relegation",
      ]);
    });

    it("leaves the table unmarked for a league without known zones", () => {
      const data = buildMockData("offday", NOW);
      data.league = { key: "league-one", name: "League One" };
      const { container } = openTable({ data });
      expect(
        container.querySelector("tbody [class*='wrexham-zone-']")
      ).toBeNull();
      expect(container.querySelector(".wrexham-table-legend")).toBeNull();
    });

    it("shows which way teams moved since the gameweek began", () => {
      const { container } = openTable({ scenario: "fulltime" });
      expect(
        [
          ...container.querySelectorAll(
            ".wrexham-movement-up, .wrexham-movement-down"
          ),
        ].map(arrow => [
          arrow.closest("tr").querySelector("th").textContent,
          l10nId(arrow.firstElementChild),
          args(arrow.firstElementChild),
        ])
      ).toEqual([
        ["Wrexham", "newtab-wrexham-widget-movement-up", { previous: 7 }],
        ["Millwall", "newtab-wrexham-widget-movement-down", { previous: 6 }],
      ]);
      const same = container.querySelector(".wrexham-movement-same");
      expect(same.getAttribute("aria-hidden")).toBe("true");
      expect(same.children).toHaveLength(0);
    });

    it("offers a refresh when the table is missing", () => {
      const data = buildMockData("offday", NOW);
      data.standings = [];
      const { container } = openTable({ data });
      expect(container.querySelector(".wrexham-table")).toBeNull();
      const title = container.querySelector(".wrexham-error-title");
      expect(l10nId(title)).toBe("newtab-wrexham-widget-error-standings");
      expect(args(title)).toEqual({ league: "EFL Championship" });
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-error-refresh"
      );
    });
  });

  describe("fixtures", () => {
    const openFixtures = options => {
      const rendered = renderWidget(options);
      fireEvent.click(
        rendered.container.querySelector("#wrexham-tab-fixtures")
      );
      return rendered;
    };
    const teams = row =>
      [...row.querySelectorAll(".wrexham-fixture-team")].map(
        team => team.textContent
      );

    it("lists the last results, collapsed, then the next matches", () => {
      const { container } = openFixtures({ scenario: "offday" });
      const results = container.querySelector(
        "details.wrexham-fixtures-results"
      );
      expect(results.open).toBe(false);
      const played = [...results.querySelectorAll(".wrexham-fixture")];
      expect(played).toHaveLength(5);
      expect(teams(played.at(-1))).toEqual(["Wrexham", "Southampton"]);
      expect(
        args(
          played.at(-1).querySelector(".wrexham-fixture-main [data-l10n-id]")
        )
      ).toEqual({ home: 2, away: 1 });
      const upcoming = [
        ...container.querySelectorAll(
          ".wrexham-fixtures-heading + .wrexham-fixtures-list .wrexham-fixture"
        ),
      ];
      expect(upcoming).toHaveLength(4);
      expect(teams(upcoming[0])).toEqual(["Derby", "Wrexham"]);
      expect(l10nId(upcoming[0].querySelector(".wrexham-fixture-main"))).toBe(
        "newtab-wrexham-widget-fixture-time"
      );
      const kickoff = Date.parse(buildMockData("offday", NOW).upcoming[0].date);
      expect(args(upcoming[0].querySelector(".wrexham-fixture-date"))).toEqual({
        date: kickoff,
        day: new Date(kickoff).getDate(),
      });
      expect(footer(container).getAttribute("href")).toBe(
        WREXHAM_LINKS.fixtures
      );
    });

    it("offers a refresh when there are no fixtures at all", () => {
      const data = buildMockData("offday", NOW);
      data.results = [];
      data.upcoming = [];
      const { container } = openFixtures({ data });
      expect(l10nId(container.querySelector(".wrexham-error-title"))).toBe(
        "newtab-wrexham-widget-error-results"
      );
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-error-refresh"
      );
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
    it("shows today's match with its date before kickoff", () => {
      const data = buildMockData("prematch", NOW);
      const { container } = renderWidget({ data, size: "medium" });
      expect(container.querySelector("[role='tablist']")).toBeNull();
      expect(container.querySelector(".wrexham-kickoff-time")).toBeTruthy();
      const date = container.querySelector(".wrexham-compact-date");
      expect(l10nId(date)).toBe("newtab-wrexham-widget-match-date");
      expect(args(date)).toEqual({ date: Date.parse(data.focus_match.date) });
      expect(status(container)).toBeNull();
    });

    it("shows the next match with the day it's on", () => {
      const { container } = renderWidget({
        scenario: "offday",
        size: "medium",
      });
      expect(l10nId(container.querySelector(".wrexham-compact-date"))).toBe(
        "newtab-wrexham-widget-relative-day"
      );
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-link-match-details"
      );
      expect(container.querySelector(".wrexham-footer").classList).toContain(
        "wrexham-footer-centered"
      );
    });

    it("puts the match state next to the live match centre link", () => {
      const { container, dispatch } = renderWidget({
        scenario: "live",
        size: "medium",
      });
      expect(scorePill(container)).toBeTruthy();
      const footerRow = container.querySelector(".wrexham-footer");
      expect(footerRow.classList).not.toContain("wrexham-footer-centered");
      expect(footerRow.querySelector(".wrexham-status").classList).toContain(
        "wrexham-status-live"
      );
      fireEvent.click(footer(container));
      expect(userEvents(dispatch, "open_link")[0].data).toMatchObject({
        widget_source: "compact",
        action_value: "match",
      });
    });
  });

  describe("without the optional fields", () => {
    it("shows the match, table and fixtures", () => {
      const { container } = renderWidget({ scenario: "minimal" });
      expect(l10nId(container.querySelector(".wrexham-match-meta-text"))).toBe(
        "newtab-wrexham-widget-match-date"
      );
      expect(container.querySelector(".wrexham-team-code-club")).toBeNull();
      fireEvent.click(container.querySelector("#wrexham-tab-table"));
      expect(container.querySelectorAll("tbody tr")).toHaveLength(24);
      expect(container.querySelector(".wrexham-movement")).toBeNull();
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      expect(container.querySelector("details")).toBeNull();
      expect(container.querySelectorAll(".wrexham-fixture")).toHaveLength(4);
    });

    it("shows the match at the medium size", () => {
      const { container } = renderWidget({
        scenario: "minimal",
        size: "medium",
      });
      expect(container.querySelector(".wrexham-kickoff-time")).toBeTruthy();
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-link-match-details"
      );
    });
  });

  describe("when the data can't be read", () => {
    it("says so on every tab and asks the feed to try again", () => {
      const { container, dispatch } = renderWidget({ data: null, error: true });
      expect(l10nId(container.querySelector(".wrexham-error-title"))).toBe(
        "newtab-wrexham-widget-error-match"
      );
      expect(container.querySelector(".wrexham-footer")).toBeNull();
      expect(footer(container).closest(".wrexham-error")).toBeTruthy();
      fireEvent.click(footer(container));
      expect(
        dispatch.mock.calls.some(
          ([action]) =>
            action?.type === at.WIDGETS_WREXHAM_REFRESH &&
            action.meta?.to === "ActivityStream:Main"
        )
      ).toBe(true);
      expect(userEvents(dispatch, "refresh")).toHaveLength(1);
      fireEvent.click(container.querySelector("#wrexham-tab-table"));
      expect(l10nId(container.querySelector(".wrexham-error-title"))).toBe(
        "newtab-wrexham-widget-error-table"
      );
    });

    it("says so at the medium size", () => {
      const { container } = renderWidget({
        data: null,
        error: true,
        size: "medium",
      });
      expect(l10nId(container.querySelector(".wrexham-error-title"))).toBe(
        "newtab-wrexham-widget-error-match"
      );
      expect(l10nId(footer(container))).toBe(
        "newtab-wrexham-widget-error-refresh"
      );
    });
  });

  describe("context menu", () => {
    const menuItem = (container, id) =>
      container.querySelector(
        `#wrexham-context-menu > panel-item[data-l10n-id='${id}']`
      );

    it("opens the wallpaper picker", () => {
      const { container, dispatch } = renderWidget();
      fireEvent.click(menuItem(container, "newtab-wrexham-menu-wallpapers"));
      expect(
        dispatch.mock.calls.some(
          ([action]) => action?.type === at.SHOW_PERSONALIZE
        )
      ).toBe(true);
      expect(userEvents(dispatch, "manage_wallpaper")).toHaveLength(1);
    });

    it("opens a tab at the large size from the medium size's menu", () => {
      const { container, dispatch } = renderWidget({ size: "medium" });
      fireEvent.click(menuItem(container, "newtab-wrexham-widget-tab-table"));
      const setPref = dispatch.mock.calls.find(
        ([action]) =>
          action?.type === at.SET_PREF &&
          action.data?.name === "widgets.wrexham.size"
      );
      expect(setPref[0].data.value).toBe("large");
      expect(userEvents(dispatch, "change_tab")[0].data).toMatchObject({
        widget_source: "context_menu",
        action_value: "table",
      });
    });

    it("leaves the tabs out of the large size's menu", () => {
      const { container } = renderWidget();
      expect(menuItem(container, "newtab-wrexham-widget-tab-table")).toBeNull();
    });

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
