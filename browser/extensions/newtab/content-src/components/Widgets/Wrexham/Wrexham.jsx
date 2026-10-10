/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector, batch } from "react-redux";
import { actionCreators as ac, actionTypes as at } from "common/Actions.mjs";
import { WIDGET_REGISTRY, resolveWidgetSize } from "common/WidgetsRegistry.mjs";
import { WidgetMenuButton } from "../WidgetMenuButton";
import { WidgetMenuFooter } from "../WidgetMenuFooter";
import { SizeSubmenu } from "../SizeSubmenu";
import { useWidgetTelemetry } from "../useWidgetTelemetry";
import {
  PHASES,
  TABS,
  TAB_ORDER,
  getDefaultTab,
  getMatchClock,
  getMatchForPhase,
  getPositionChange,
  getResultForTeam,
  getWrexhamPhase,
  isHalfTime,
} from "./wrexhamPhase.mjs";

const USER_ACTION_TYPES = {
  CHANGE_SIZE: "change_size",
  CHANGE_TAB: "change_tab",
  LEARN_MORE: "learn_more",
  OPEN_LINK: "open_link",
};

const WREXHAM_ENTRY = WIDGET_REGISTRY.find(w => w.id === "wrexham");

const CREST_URL =
  "chrome://newtab/content/data/content/assets/wrexham/crest.svg";

// Placeholder pages on the club site until the club confirms where each
// click should land. A match's own `url` wins over LINKS.match.
export const WREXHAM_LINKS = {
  match: "https://www.wrexhamafc.co.uk/fixtures/",
  table: "https://www.wrexhamafc.co.uk/table/",
  fixtures: "https://www.wrexhamafc.co.uk/fixtures/",
};

const CLUB_TIME_ZONE = "Europe/London";

// The table draws a line under these places: automatic promotion, play-offs.
const TABLE_DIVIDER_POSITIONS = new Set([2, 6]);

const MATCH_LINK_L10N_IDS = {
  [PHASES.PREMATCH]: "newtab-wrexham-widget-link-match-preview",
  [PHASES.LIVE]: "newtab-wrexham-widget-link-match-centre",
  [PHASES.FULLTIME]: "newtab-wrexham-widget-link-match-report",
  [PHASES.OFFDAY]: "newtab-wrexham-widget-link-match-preview",
};

// Computed direction, not the dir attribute: about:newtab carries none on
// <html>. Only called from event handlers.
function isRtl() {
  return getComputedStyle(document.documentElement).direction === "rtl";
}

function getUtcOffsetMinutes(date, timeZone) {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find(part => part.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
  if (!match) {
    return 0;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/**
 * Shifts a time so that, read in the fan's own time zone, it shows what the
 * clock in Wrexham says. Fluent's DATETIME has no time zone option, and this
 * keeps both kickoff times in the same format.
 *
 * @param {number} date - A ms epoch.
 * @returns {number|null} The shifted ms epoch, or null if the fan's clock
 *   already matches Wrexham's.
 */
function getClubWallClock(date) {
  const localOffset = -new Date(date).getTimezoneOffset();
  const clubOffset = getUtcOffsetMinutes(date, CLUB_TIME_ZONE);
  if (localOffset === clubOffset) {
    return null;
  }
  return date + (clubOffset - localOffset) * 60 * 1000;
}

function getTimeZoneName(date) {
  return (
    new Intl.DateTimeFormat(undefined, { timeZoneName: "longGeneric" })
      .formatToParts(date)
      .find(part => part.type === "timeZoneName")?.value ?? ""
  );
}

const goalDifferenceFormat = new Intl.NumberFormat(undefined, {
  signDisplay: "exceptZero",
});

function getMatchLink(match) {
  return match?.url || WREXHAM_LINKS.match;
}

function TeamMark({ team, teamKey }) {
  if (team?.key === teamKey) {
    return <img className="wrexham-team-crest" src={CREST_URL} alt="" />;
  }
  return (
    <span className="wrexham-team-code" aria-hidden="true">
      {team?.key}
    </span>
  );
}

function TeamBlock({ team, teamKey, nameId }) {
  return (
    <div className="wrexham-team">
      <TeamMark team={team} teamKey={teamKey} />
      <span id={nameId} className="wrexham-team-name">
        {team?.name}
      </span>
    </div>
  );
}

function Score({ match }) {
  return (
    <span
      className="wrexham-score"
      data-l10n-id="newtab-wrexham-widget-score"
      data-l10n-args={JSON.stringify({
        home: match.home_score,
        away: match.away_score,
      })}
    />
  );
}

function LiveClock({ match }) {
  if (isHalfTime(match)) {
    return (
      <span
        className="wrexham-live-clock"
        data-l10n-id="newtab-wrexham-widget-half-time"
      />
    );
  }
  const clock = getMatchClock(match);
  if (!clock) {
    return null;
  }
  return (
    <span
      className="wrexham-live-clock"
      data-l10n-id="newtab-wrexham-widget-clock"
      data-l10n-args={JSON.stringify({ clock })}
    />
  );
}

function ResultChip({ result }) {
  if (!result) {
    return null;
  }
  return (
    <span
      className={`wrexham-result wrexham-result-${result}`}
      data-l10n-id={`newtab-wrexham-widget-result-${result}`}
    />
  );
}

function StatusBadge({ phase, match }) {
  if (!match || phase === PHASES.OFFDAY) {
    return null;
  }
  let l10nId;
  let args;
  if (phase === PHASES.PREMATCH) {
    l10nId = "newtab-wrexham-widget-badge-matchday";
  } else if (phase === PHASES.FULLTIME) {
    l10nId = "newtab-wrexham-widget-badge-full-time";
  } else if (isHalfTime(match)) {
    l10nId = "newtab-wrexham-widget-badge-half-time";
  } else if (getMatchClock(match)) {
    l10nId = "newtab-wrexham-widget-badge-live-clock";
    args = JSON.stringify({ clock: getMatchClock(match) });
  } else {
    l10nId = "newtab-wrexham-widget-badge-live";
  }
  return (
    <span
      className={`wrexham-badge wrexham-badge-${phase}`}
      data-l10n-id={l10nId}
      data-l10n-args={args}
    />
  );
}

function MatchMeta({ match }) {
  return (
    <p
      className="wrexham-match-meta"
      data-l10n-id={
        match.venue
          ? "newtab-wrexham-widget-match-meta"
          : "newtab-wrexham-widget-match-date"
      }
      data-l10n-args={JSON.stringify({
        date: Date.parse(match.date),
        venue: match.venue ?? "",
      })}
    />
  );
}

function Kickoff({ kickoff }) {
  const clubTime = getClubWallClock(kickoff);
  return (
    <div className="wrexham-kickoff">
      <p
        className="wrexham-kickoff-label"
        data-l10n-id="newtab-wrexham-widget-kickoff-label"
      />
      <p
        className="wrexham-kickoff-time"
        data-l10n-id="newtab-wrexham-widget-kickoff-time"
        data-l10n-args={JSON.stringify({ date: kickoff })}
      />
      <p
        className="wrexham-kickoff-zone"
        data-l10n-id={
          clubTime === null
            ? "newtab-wrexham-widget-kickoff-zone"
            : "newtab-wrexham-widget-kickoff-zone-club"
        }
        data-l10n-args={JSON.stringify({
          timeZone: getTimeZoneName(kickoff),
          clubTime,
        })}
      />
    </div>
  );
}

// Each team's scorers sit under that team, and the list is named after it so
// screen readers don't rely on the column position.
function Goals({ match }) {
  if (!match.goals?.length) {
    return null;
  }
  const renderGoals = (teamKey, className, labelId) => {
    const goals = match.goals.filter(goal => goal.team_key === teamKey);
    if (!goals.length) {
      return <div className={className} />;
    }
    return (
      <ul className={className} aria-labelledby={labelId}>
        {goals.map(goal => (
          <li
            key={`${goal.player}-${goal.minute}`}
            data-l10n-id="newtab-wrexham-widget-goal"
            data-l10n-args={JSON.stringify({
              player: goal.player,
              minute: goal.minute,
            })}
          />
        ))}
      </ul>
    );
  };
  return (
    <div className="wrexham-goals">
      {renderGoals(
        match.home_team?.key,
        "wrexham-goals-home",
        "wrexham-home-team-name"
      )}
      {renderGoals(
        match.away_team?.key,
        "wrexham-goals-away",
        "wrexham-away-team-name"
      )}
    </div>
  );
}

function PositionLine({ standings, teamKey, leagueName }) {
  const change = getPositionChange(standings, teamKey);
  if (!change) {
    return null;
  }
  return (
    <p
      className="wrexham-position-line"
      data-l10n-id={`newtab-wrexham-widget-position-${change.direction}`}
      data-l10n-args={JSON.stringify({
        position: change.position,
        league: leagueName,
      })}
    />
  );
}

function MatchPanel({ match, phase, teamKey, standings, leagueName }) {
  if (!match) {
    return (
      <p
        className="wrexham-empty"
        data-l10n-id="newtab-wrexham-widget-no-match"
      />
    );
  }
  const hasScore = phase === PHASES.LIVE || phase === PHASES.FULLTIME;
  return (
    <div className={`wrexham-match wrexham-match-${phase}`}>
      <MatchMeta match={match} />
      <div className="wrexham-match-teams">
        <TeamBlock
          team={match.home_team}
          teamKey={teamKey}
          nameId="wrexham-home-team-name"
        />
        <div className="wrexham-match-centre">
          {hasScore ? (
            <Score match={match} />
          ) : (
            <span
              className="wrexham-versus"
              data-l10n-id="newtab-wrexham-widget-versus"
            />
          )}
          {phase === PHASES.LIVE && <LiveClock match={match} />}
          {phase === PHASES.FULLTIME && (
            <ResultChip result={getResultForTeam(match, teamKey)} />
          )}
        </div>
        <TeamBlock
          team={match.away_team}
          teamKey={teamKey}
          nameId="wrexham-away-team-name"
        />
      </div>
      {hasScore ? (
        <Goals match={match} />
      ) : (
        <Kickoff kickoff={Date.parse(match.date)} />
      )}
      {phase === PHASES.FULLTIME && (
        <PositionLine
          standings={standings}
          teamKey={teamKey}
          leagueName={leagueName}
        />
      )}
    </div>
  );
}

/**
 * The league table, or a slice of it.
 *
 * @param {object} props
 * @param {Array<object>} props.rows - Standings rows to show.
 * @param {string} props.teamKey - Wrexham's key, to highlight its row.
 * @param {string} props.leagueName - Names the table for screen readers.
 * @param {boolean} [props.hidden] - Hides the table from assistive technology,
 *   for when a link around it already summarizes it.
 */
function StandingsTable({ rows, teamKey, leagueName, hidden = false, ref }) {
  return (
    <table
      ref={ref}
      className="wrexham-table"
      data-l10n-id="newtab-wrexham-widget-table"
      data-l10n-args={JSON.stringify({ league: leagueName ?? "" })}
      aria-hidden={hidden || undefined}
    >
      <thead>
        <tr>
          <th
            scope="col"
            className="wrexham-table-position"
            data-l10n-id="newtab-wrexham-widget-table-position"
          />
          <th
            scope="col"
            className="wrexham-table-team"
            data-l10n-id="newtab-wrexham-widget-table-team"
          />
          <th scope="col" data-l10n-id="newtab-wrexham-widget-table-played" />
          <th
            scope="col"
            data-l10n-id="newtab-wrexham-widget-table-goal-difference"
          />
          <th scope="col" data-l10n-id="newtab-wrexham-widget-table-points" />
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const classNames = ["wrexham-table-row"];
          if (row.team.key === teamKey) {
            classNames.push("wrexham-table-row-highlight");
          }
          if (TABLE_DIVIDER_POSITIONS.has(row.position)) {
            classNames.push("wrexham-table-row-divider");
          }
          return (
            <tr key={row.team.key} className={classNames.join(" ")}>
              <td className="wrexham-table-position">{row.position}</td>
              <th scope="row" className="wrexham-table-team">
                {row.team.name}
              </th>
              <td>{row.played}</td>
              <td>{goalDifferenceFormat.format(row.goal_difference)}</td>
              <td className="wrexham-table-points">{row.points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TablePanel({ standings, teamKey, leagueName }) {
  const tableRef = useRef(null);

  // Scroll the tab panel, not the page, so Wrexham's row is in view.
  useEffect(() => {
    const table = tableRef.current;
    const panel = table?.closest(".wrexham-tabpanel");
    const row = table?.querySelector(".wrexham-table-row-highlight");
    if (panel && row) {
      panel.scrollTop =
        row.offsetTop - (panel.clientHeight - row.offsetHeight) / 2;
    }
  }, []);

  if (!standings?.length) {
    return (
      <p
        className="wrexham-empty"
        data-l10n-id="newtab-wrexham-widget-no-table"
      />
    );
  }

  return (
    <StandingsTable
      ref={tableRef}
      rows={standings}
      teamKey={teamKey}
      leagueName={leagueName}
    />
  );
}

function FixturesPanel({ gameweek, teamKey }) {
  if (!gameweek?.matches?.length) {
    return (
      <p
        className="wrexham-empty"
        data-l10n-id="newtab-wrexham-widget-no-fixtures"
      />
    );
  }
  return (
    <div className="wrexham-fixtures">
      <h3
        className="wrexham-section-label"
        data-l10n-id="newtab-wrexham-widget-fixtures-heading"
        data-l10n-args={JSON.stringify({ number: gameweek.number })}
      />
      <ul className="wrexham-fixtures-list">
        {gameweek.matches.map(match => {
          const date = Date.parse(match.date);
          const isOurs =
            match.home_team?.key === teamKey ||
            match.away_team?.key === teamKey;
          return (
            <li
              key={match.id}
              className={`wrexham-fixture${isOurs ? " wrexham-fixture-highlight" : ""}`}
            >
              <span className="wrexham-fixture-team wrexham-fixture-home">
                {match.home_team?.name}
              </span>
              <span className="wrexham-fixture-time">
                <span
                  data-l10n-id="newtab-wrexham-widget-fixture-day"
                  data-l10n-args={JSON.stringify({ date })}
                />
                <span
                  data-l10n-id="newtab-wrexham-widget-fixture-time"
                  data-l10n-args={JSON.stringify({ date })}
                />
              </span>
              <span className="wrexham-fixture-team wrexham-fixture-away">
                {match.away_team?.name}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The medium size has no tabs: the match on matchday, Wrexham's corner of the
// table otherwise. The whole view links to the matching page, and its name
// says where the link goes.
function CompactView({ data, phase, match, teamKey, onLinkClick }) {
  if (phase === PHASES.OFFDAY) {
    const standings = data.standings ?? [];
    const index = standings.findIndex(row => row.team.key === teamKey);
    if (index === -1) {
      return null;
    }
    const start = Math.min(
      Math.max(index - 1, 0),
      Math.max(standings.length - 3, 0)
    );
    // The slice has no column headers, so the link carries a summary instead.
    return (
      <a
        className="wrexham-compact wrexham-compact-table"
        href={WREXHAM_LINKS.table}
        onClick={() => onLinkClick("table", "compact")}
        data-l10n-id="newtab-wrexham-widget-compact-table"
        data-l10n-args={JSON.stringify({
          position: standings[index].position,
          points: standings[index].points,
          league: data.league?.name ?? "",
        })}
      >
        <StandingsTable
          rows={standings.slice(start, start + 3)}
          teamKey={teamKey}
          hidden={true}
        />
      </a>
    );
  }
  if (!match) {
    return null;
  }
  const hasScore = phase === PHASES.LIVE || phase === PHASES.FULLTIME;
  return (
    <a
      className={`wrexham-compact wrexham-compact-match wrexham-match-${phase}`}
      href={getMatchLink(match)}
      onClick={() => onLinkClick("match", "compact")}
    >
      <span className="wrexham-team-name wrexham-compact-home">
        {match.home_team?.name}
      </span>
      <span className="wrexham-match-centre">
        {hasScore ? (
          <Score match={match} />
        ) : (
          <span
            className="wrexham-compact-kickoff"
            data-l10n-id="newtab-wrexham-widget-kickoff-time"
            data-l10n-args={JSON.stringify({ date: Date.parse(match.date) })}
          />
        )}
        {phase === PHASES.LIVE && <LiveClock match={match} />}
        {phase === PHASES.FULLTIME && (
          <ResultChip result={getResultForTeam(match, teamKey)} />
        )}
        {phase === PHASES.PREMATCH && (
          <span
            className="wrexham-kickoff-label"
            data-l10n-id="newtab-wrexham-widget-kickoff-label"
          />
        )}
      </span>
      <span className="wrexham-team-name wrexham-compact-away">
        {match.away_team?.name}
      </span>
      <span className="sr-only" data-l10n-id={MATCH_LINK_L10N_IDS[phase]} />
    </a>
  );
}

/**
 * Wrexham AFC widget: the match on matchday, the Championship table and the
 * next gameweek's fixtures on other days.
 *
 * @param {object} props
 * @param {Function} props.dispatch - Redux dispatch.
 * @param {Function} props.handleUserInteraction - Marks the widget as
 *   interacted with.
 * @param {boolean} props.widgetsMayBeMaximized - Whether the current layout
 *   allows resizing, which gates the Change size submenu.
 * @param {object} props.widgetEnabledMap - Map of widget id to whether it is
 *   currently active, used by the Move submenu.
 */
const Wrexham = ({
  dispatch,
  handleUserInteraction,
  widgetsMayBeMaximized,
  widgetEnabledMap,
}) => {
  const prefs = useSelector(state => state.Prefs.values);
  const { data } = useSelector(state => state.Wrexham);

  const widgetSize = resolveWidgetSize(WREXHAM_ENTRY, prefs);
  const isLarge = widgetSize === "large";

  const teamKey = data?.team?.key;
  const phase = getWrexhamPhase(data?.focus_match, Date.now());
  const match = getMatchForPhase(data, phase);
  const competitionName =
    (phase !== PHASES.OFFDAY && data?.focus_match?.competition?.name) ||
    data?.league?.name;

  // The phase picks the tab until the user picks one or moves focus into the
  // widget. After that the panel stays put for the life of the page, so a
  // kickoff or final whistle doesn't swap it, or drop focus, under them.
  const [selectedTab, setSelectedTab] = useState(null);
  const activeTab = selectedTab ?? getDefaultTab(phase);
  const tablistRef = useRef(null);

  const pinActiveTab = () => {
    if (selectedTab === null) {
      setSelectedTab(activeTab);
    }
  };

  const { impressionRef, recordUserAction } = useWidgetTelemetry({
    dispatch,
    widget: WREXHAM_ENTRY,
    widgetSize,
  });

  const handleInteraction = useCallback(
    () => handleUserInteraction("wrexham"),
    [handleUserInteraction]
  );

  const selectTab = useCallback(
    tab => {
      if (tab === activeTab) {
        return;
      }
      setSelectedTab(tab);
      recordUserAction(USER_ACTION_TYPES.CHANGE_TAB, {
        source: "widget",
        value: tab,
      });
      handleInteraction();
    },
    [activeTab, recordUserAction, handleInteraction]
  );

  const onTabKeyDown = useCallback(
    event => {
      // Leave browser shortcuts such as Alt+Left (Back) alone.
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const index = TAB_ORDER.indexOf(activeTab);
      const offsets = { ArrowLeft: -1, ArrowRight: 1 };
      const count = TAB_ORDER.length;
      let next;
      if (event.key in offsets) {
        // Wraps from the last tab to the first and back.
        next =
          (index + offsets[event.key] * (isRtl() ? -1 : 1) + count) % count;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = count - 1;
      } else {
        return;
      }
      event.preventDefault();
      tablistRef.current
        ?.querySelector(`#wrexham-tab-${TAB_ORDER[next]}`)
        ?.focus();
      selectTab(TAB_ORDER[next]);
    },
    [activeTab, selectTab]
  );

  const handleLinkClick = useCallback(
    (kind, source) => {
      recordUserAction(USER_ACTION_TYPES.OPEN_LINK, { source, value: kind });
      handleInteraction();
    },
    [recordUserAction, handleInteraction]
  );

  const handleChangeSize = useCallback(
    size => {
      batch(() => {
        dispatch(
          ac.OnlyToMain({
            type: at.SET_PREF,
            data: { name: WREXHAM_ENTRY.sizePref, value: size },
          })
        );
        recordUserAction(USER_ACTION_TYPES.CHANGE_SIZE, {
          source: "context_menu",
          value: size,
          size,
        });
        handleInteraction();
      });
    },
    [dispatch, recordUserAction, handleInteraction]
  );

  // The shared footer opens the support link; here we only record the click.
  const handleLearnMore = () => {
    recordUserAction(USER_ACTION_TYPES.LEARN_MORE, { source: "context_menu" });
    handleInteraction();
  };

  let panel;
  let footer;
  if (activeTab === TABS.TABLE) {
    panel = (
      <TablePanel
        standings={data?.standings}
        teamKey={teamKey}
        leagueName={data?.league?.name}
      />
    );
    footer = {
      kind: "table",
      href: WREXHAM_LINKS.table,
      l10nId: "newtab-wrexham-widget-link-table",
    };
  } else if (activeTab === TABS.FIXTURES) {
    panel = <FixturesPanel gameweek={data?.gameweek} teamKey={teamKey} />;
    footer = {
      kind: "fixtures",
      href: WREXHAM_LINKS.fixtures,
      l10nId: "newtab-wrexham-widget-link-fixtures",
    };
  } else {
    panel = (
      <MatchPanel
        match={match}
        phase={phase}
        teamKey={teamKey}
        standings={data?.standings}
        leagueName={data?.league?.name}
      />
    );
    footer = {
      kind: "match",
      href: getMatchLink(match),
      l10nId: MATCH_LINK_L10N_IDS[phase],
    };
  }

  return (
    <article
      className={`wrexham widget col-4 ${widgetSize}-widget`}
      ref={impressionRef}
      aria-labelledby="wrexham-widget-label"
      onFocus={pinActiveTab}
    >
      <header className="wrexham-header">
        <img className="wrexham-header-crest" src={CREST_URL} alt="" />
        <div className="wrexham-heading">
          <h2
            id="wrexham-widget-label"
            className="wrexham-title"
            data-l10n-id="newtab-wrexham-widget-title"
          />
          {competitionName && (
            <p className="wrexham-competition">{competitionName}</p>
          )}
        </div>
        <StatusBadge phase={phase} match={data?.focus_match} />
        <div className="wrexham-context-menu-wrapper">
          <WidgetMenuButton
            className="wrexham-context-menu-button"
            menuId="wrexham-context-menu"
            l10nId="newtab-wrexham-widget-open-menu-button"
          />
          <panel-list className="panel-list-no-icons" id="wrexham-context-menu">
            <WidgetMenuFooter
              dispatch={dispatch}
              widgetId={WREXHAM_ENTRY.id}
              widgetEnabledMap={widgetEnabledMap}
              widgetName={WREXHAM_ENTRY.telemetryName}
              enabledPref={WREXHAM_ENTRY.enabledPref}
              widgetSize={widgetSize}
              learnMoreL10nId="newtab-wrexham-menu-learn-more"
              onLearnMore={handleLearnMore}
              showDivider={false}
              sizeSubmenu={
                widgetsMayBeMaximized ? (
                  <SizeSubmenu
                    submenuId="wrexham-size-submenu"
                    sizes={WREXHAM_ENTRY.validSizes}
                    checkedSize={widgetSize}
                    onChangeSize={handleChangeSize}
                  />
                ) : null
              }
            />
          </panel-list>
        </div>
      </header>

      {data && !isLarge && (
        <CompactView
          data={data}
          phase={phase}
          match={match}
          teamKey={teamKey}
          onLinkClick={handleLinkClick}
        />
      )}

      {data && isLarge && (
        <>
          <div
            className="wrexham-tabs"
            role="tablist"
            ref={tablistRef}
            onKeyDown={onTabKeyDown}
          >
            {TAB_ORDER.map(tab => {
              const isActive = tab === activeTab;
              return (
                <button
                  key={tab}
                  id={`wrexham-tab-${tab}`}
                  className="wrexham-tab"
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  aria-controls="wrexham-tabpanel"
                  tabIndex={isActive ? 0 : -1}
                  data-l10n-id={`newtab-wrexham-widget-tab-${tab}`}
                  onClick={() => selectTab(tab)}
                />
              );
            })}
          </div>
          {/* Keyed so each tab starts its panel scrolled to its own top. */}
          <div
            key={activeTab}
            id="wrexham-tabpanel"
            className={`wrexham-tabpanel wrexham-tabpanel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`wrexham-tab-${activeTab}`}
          >
            {panel}
          </div>
          <a
            className="wrexham-footer-link"
            href={footer.href}
            onClick={() => handleLinkClick(footer.kind, activeTab)}
            data-l10n-id={footer.l10nId}
          />
        </>
      )}
    </article>
  );
};

export { Wrexham };
