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
  const { container, rerender } = render(ui(stateOptions));
  // Swaps in new data, as a feed update would, keeping the same component.
  const rerenderWith = options => rerender(ui(options));
  return { container, dispatch, handleUserInteraction, rerenderWith };
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
    it("opens on the table with Wrexham highlighted and no badge", () => {
      const { container } = renderWidget({ scenario: "offday" });
      expect(selectedTab(container).id).toBe("wrexham-tab-table");
      expect(container.querySelector(".wrexham-badge")).toBeNull();
      expect(
        container.querySelectorAll(".wrexham-table tbody tr")
      ).toHaveLength(24);
      const highlight = container.querySelector(".wrexham-table-row-highlight");
      expect(highlight.textContent).toContain("Wrexham");
      expect(container.querySelector(".wrexham-competition").textContent).toBe(
        "Championship"
      );
    });

    it("links the footer to the full table", () => {
      const { container } = renderWidget({ scenario: "offday" });
      expect(footer(container).getAttribute("href")).toBe(WREXHAM_LINKS.table);
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-table"
      );
    });

    it("previews the next match on the Match tab", () => {
      const { container } = renderWidget({ scenario: "offday" });
      fireEvent.click(container.querySelector("#wrexham-tab-match"));
      expect(container.querySelector(".wrexham-kickoff")).toBeTruthy();
      expect(container.querySelector(".wrexham-match").textContent).toContain(
        "Derby County"
      );
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-preview"
      );
    });

    it("lists the gameweek on the Fixtures tab with Wrexham's fixture highlighted", () => {
      const { container } = renderWidget({ scenario: "offday" });
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      expect(container.querySelectorAll(".wrexham-fixture")).toHaveLength(12);
      expect(
        container.querySelectorAll(".wrexham-fixture-highlight")
      ).toHaveLength(1);
      expect(footer(container).getAttribute("href")).toBe(
        WREXHAM_LINKS.fixtures
      );
    });
  });

  describe("before kickoff", () => {
    it("opens on the match with the Matchday badge and the local kickoff", () => {
      const { container } = renderWidget({ scenario: "prematch" });
      expect(selectedTab(container).id).toBe("wrexham-tab-match");
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
    it("shows the live score, clock and scorers", () => {
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
      expect(container.querySelectorAll(".wrexham-goals li")).toHaveLength(3);
      expect(footer(container).getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-centre"
      );
    });

    it("passes stoppage time through as Merino sends it", () => {
      const data = buildMockData("live", NOW);
      data.focus_match.clock = "90+3";
      const { container } = renderWidget({ data });
      expect(args(container.querySelector(".wrexham-badge"))).toEqual({
        clock: "90+3",
      });
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
      expect(selectedTab(container).id).toBe("wrexham-tab-match");
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
      expect(away.querySelectorAll("li")).toHaveLength(2);
    });

    it("renders no empty list for a team that hasn't scored", () => {
      const data = buildMockData("live", NOW);
      data.focus_match.goals = data.focus_match.goals.filter(
        goal => goal.team_key === "WRE"
      );
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

  describe("postponed and delayed matches", () => {
    it("isn't matchday when today's match is postponed", () => {
      const data = buildMockData("prematch", NOW);
      data.focus_match.status = "Postponed";
      const { container } = renderWidget({ data });
      expect(container.querySelector(".wrexham-badge")).toBeNull();
      expect(selectedTab(container).id).toBe("wrexham-tab-table");
    });

    it("stays on matchday when the kickoff is delayed", () => {
      const data = buildMockData("prematch", NOW);
      data.focus_match.status = "Delayed";
      const { container } = renderWidget({ data });
      expect(
        container.querySelector(".wrexham-badge").getAttribute("data-l10n-id")
      ).toBe("newtab-wrexham-widget-badge-matchday");
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
      expect(tabIndexes).toEqual([-1, 0, -1]);
    });

    it("follows the match state until the user interacts", () => {
      const { container, rerenderWith } = renderWidget({ scenario: "offday" });
      expect(selectedTab(container).id).toBe("wrexham-tab-table");
      rerenderWith({ scenario: "live" });
      expect(selectedTab(container).id).toBe("wrexham-tab-match");
    });

    it("keeps the user's tab when the match state changes", () => {
      const { container, rerenderWith } = renderWidget({ scenario: "offday" });
      fireEvent.click(container.querySelector("#wrexham-tab-fixtures"));
      rerenderWith({ scenario: "live" });
      expect(selectedTab(container).id).toBe("wrexham-tab-fixtures");
    });

    it("keeps the panel still once focus is in the widget", () => {
      const { container, rerenderWith } = renderWidget({ scenario: "offday" });
      act(() => footer(container).focus());
      rerenderWith({ scenario: "live" });
      expect(selectedTab(container).id).toBe("wrexham-tab-table");
    });

    it("doesn't take focus later after Home on the first tab", () => {
      const { container, rerenderWith } = renderWidget({
        scenario: "prematch",
      });
      fireEvent.keyDown(container.querySelector("[role='tablist']"), {
        key: "Home",
      });
      const outside = document.createElement("input");
      document.body.append(outside);
      act(() => outside.focus());
      rerenderWith({ scenario: "offday" });
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });
  });

  describe("table", () => {
    it("names the table and gives it full column names and row headers", () => {
      const { container } = renderWidget({ scenario: "offday" });
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
    it("shows Wrexham's corner of the table on an off day", () => {
      const { container } = renderWidget({
        scenario: "offday",
        size: "medium",
      });
      expect(container.querySelector("[role='tablist']")).toBeNull();
      const link = container.querySelector(".wrexham-compact-table");
      expect(link.getAttribute("href")).toBe(WREXHAM_LINKS.table);
      const rows = link.querySelectorAll("tbody tr");
      expect(rows).toHaveLength(3);
      expect(rows[1].classList).toContain("wrexham-table-row-highlight");
    });

    it("names the table link with a summary instead of the bare cells", () => {
      const { container } = renderWidget({
        scenario: "offday",
        size: "medium",
      });
      const link = container.querySelector(".wrexham-compact-table");
      expect(link.getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-compact-table"
      );
      expect(args(link)).toEqual({
        position: 7,
        points: 18,
        league: "Championship",
      });
      expect(link.querySelector("table").getAttribute("aria-hidden")).toBe(
        "true"
      );
    });

    it("leaves out the table link when Wrexham isn't in the table", () => {
      const data = buildMockData("offday", NOW);
      data.standings = [];
      const { container } = renderWidget({ data, size: "medium" });
      expect(container.querySelector(".wrexham-compact")).toBeNull();
    });

    it("shows the live score on matchday, linked to the match", () => {
      const { container, dispatch } = renderWidget({
        scenario: "live",
        size: "medium",
      });
      const link = container.querySelector(".wrexham-compact-match");
      expect(link.getAttribute("href")).toBe(WREXHAM_LINKS.match);
      expect(link.querySelector(".wrexham-score")).toBeTruthy();
      expect(link.querySelector(".sr-only").getAttribute("data-l10n-id")).toBe(
        "newtab-wrexham-widget-link-match-centre"
      );
      fireEvent.click(link);
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
