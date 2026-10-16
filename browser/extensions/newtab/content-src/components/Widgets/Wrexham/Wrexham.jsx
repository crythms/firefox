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
import { usePageVisible } from "../usePageVisible";
import {
  PHASES,
  TABS,
  TAB_ORDER,
  getCountdown,
  getDaysUntil,
  getMatchClock,
  getMatchForPhase,
  getMatchState,
  getMonogramColors,
  getPenalties,
  getResultForTeam,
  getRowMovement,
  getTableZone,
  getWrexhamPhase,
  isExtraTime,
  isHalfTime,
} from "./wrexhamPhase.mjs";

const TICK_MS = 30 * 1000;

// Re-renders while enabled so times derived from Date.now() stay current.
function useTick(enabled) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const interval = setInterval(() => setTick(tick => tick + 1), TICK_MS);
    return () => clearInterval(interval);
  }, [enabled]);
}

/**
 * Watches for goals and the final whistle, for the live region and the score
 * animations. Nothing fires on the first render.
 *
 * @returns {{announcement: object|null, change: {count: number,
 *   scorerKey: string|null}}} count is how many score changes this page has
 *   seen; scorerKey is the team that scored the latest, if only one did.
 */
function useScoreChanges(match, phase, teamKey) {
  const previous = useRef(null);
  const [announcement, setAnnouncement] = useState(null);
  const [change, setChange] = useState({ count: 0, scorerKey: null });
  const id = match?.id;
  const home = match?.home_score;
  const away = match?.away_score;

  useEffect(() => {
    const prev = previous.current;
    previous.current = { id, home, away, phase };
    // Kickoff, when the score first appears, isn't a change.
    if (
      !prev ||
      prev.id !== id ||
      !Number.isFinite(home) ||
      !Number.isFinite(prev.home)
    ) {
      return;
    }
    const args = {
      home: match.home_team?.name ?? "",
      away: match.away_team?.name ?? "",
      homeScore: home,
      awayScore: away,
    };
    if (phase === PHASES.FULLTIME && prev.phase === PHASES.LIVE) {
      setAnnouncement(current => ({
        seq: (current?.seq ?? 0) + 1,
        l10nId: "newtab-wrexham-widget-announce-full-time",
        args: { ...args, result: getResultForTeam(match, teamKey) },
      }));
      return;
    }
    if (home === prev.home && away === prev.away) {
      return;
    }
    let scorer = null;
    if (home > prev.home && away === prev.away) {
      scorer = match.home_team;
    } else if (away > prev.away && home === prev.home) {
      scorer = match.away_team;
    }
    setAnnouncement(current => ({
      seq: (current?.seq ?? 0) + 1,
      l10nId: scorer
        ? "newtab-wrexham-widget-announce-goal"
        : "newtab-wrexham-widget-announce-score",
      args: scorer ? { ...args, team: scorer.name ?? "" } : args,
    }));
    setChange(current => ({
      count: current.count + 1,
      scorerKey: scorer?.key ?? null,
    }));
    // The match object changes with every update; only these values matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, home, away, phase]);

  return { announcement, change };
}

const USER_ACTION_TYPES = {
  CHANGE_MATCH: "change_match",
  CHANGE_SIZE: "change_size",
  CHANGE_TAB: "change_tab",
  LEARN_MORE: "learn_more",
  MANAGE_WALLPAPER: "manage_wallpaper",
  OPEN_LINK: "open_link",
  REFRESH: "refresh",
};

const WREXHAM_ENTRY = WIDGET_REGISTRY.find(w => w.id === "wrexham");

const CREST_URL =
  "chrome://newtab/content/data/content/assets/wrexham/crest.svg";

// From the design; the club still has to confirm them.
export const WREXHAM_LINKS = {
  match: "https://www.wrexhamafc.co.uk/matches",
  table: "https://www.wrexhamafc.co.uk/matches",
  fixtures: "https://www.wrexhamafc.co.uk/matches",
};

const TABLE_ZONES = ["promotion", "playoffs", "relegation"];

const CONFETTI_PIECES = 8;

// Today's or the next match, then up to this many more to swipe through.
const EXTRA_MATCHES = 2;

const NO_CHANGE = { count: 0, scorerKey: null };

const STATE_L10N_IDS = {
  live: "newtab-wrexham-widget-badge-live",
  halftime: "newtab-wrexham-widget-badge-half-time",
  fulltime: "newtab-wrexham-widget-badge-full-time",
  delayed: "newtab-wrexham-widget-badge-delayed",
  suspended: "newtab-wrexham-widget-badge-suspended",
  postponed: "newtab-wrexham-widget-badge-postponed",
};

const MATCH_LINK_L10N_IDS = {
  [PHASES.PREMATCH]: "newtab-wrexham-widget-link-match-details",
  [PHASES.LIVE]: "newtab-wrexham-widget-link-match-centre",
  [PHASES.FULLTIME]: "newtab-wrexham-widget-link-match-report",
  [PHASES.OFFDAY]: "newtab-wrexham-widget-link-match-details",
};

// States that name the competition rather than the venue.
const NOTICE_STATES = new Set(["delayed", "suspended", "postponed"]);

// about:newtab has no dir attribute on <html>.
function isRtl() {
  return getComputedStyle(document.documentElement).direction === "rtl";
}

const goalDifferenceFormat = new Intl.NumberFormat(undefined, {
  signDisplay: "exceptZero",
});

function getMatchLink(match) {
  return match?.url || WREXHAM_LINKS.match;
}

function hasScore(phase) {
  return phase === PHASES.LIVE || phase === PHASES.FULLTIME;
}

// Cup ties, and matches that are delayed, suspended or postponed, name the
// competition where other league matches name the venue.
function getMatchPlace(match, state, league) {
  const { competition } = match;
  if (NOTICE_STATES.has(state)) {
    return competition?.name || league?.name || match.venue || "";
  }
  if (competition?.name && league?.key && competition.key !== league.key) {
    return competition.name;
  }
  return match.venue ?? "";
}

function getTeamName(team) {
  return team?.short_name || team?.name;
}

function TeamMark({ team, teamKey, celebrate = 0 }) {
  if (team?.key === teamKey) {
    return (
      <img
        key={celebrate}
        className={`wrexham-team-crest${celebrate ? " wrexham-celebrate" : ""}`}
        src={CREST_URL}
        alt=""
      />
    );
  }
  const colors = getMonogramColors(team?.colors);
  return (
    <span
      className={`wrexham-team-code${colors ? " wrexham-team-code-club" : ""}`}
      style={
        colors
          ? {
              "--wrexham-team-color": colors.background,
              "--wrexham-team-on-color": colors.text,
            }
          : undefined
      }
      aria-hidden="true"
    >
      {team?.key}
    </span>
  );
}

function TeamBlock({ team, teamKey, celebrate }) {
  return (
    <div className="wrexham-team">
      <TeamMark team={team} teamKey={teamKey} celebrate={celebrate} />
      <span className="wrexham-team-name">{getTeamName(team)}</span>
    </div>
  );
}

function StatusPill({ state }) {
  if (!state) {
    return null;
  }
  return (
    <span
      className={`wrexham-status wrexham-status-${state}`}
      data-l10n-id={STATE_L10N_IDS[state]}
    />
  );
}

/**
 * The score with the minute, "HT" or a dash between the two sides, and any
 * shootout score outside them. Keyed by the change count, so each goal
 * remounts it and replays its animation.
 *
 * @param {object} props
 * @param {object} props.match
 * @param {string} props.state - From getMatchState.
 * @param {{count: number, scorerKey: string|null}} props.change
 * @param {string} props.teamKey
 * @param {boolean} props.compact - At the medium size, a final score, and a
 *   cup tie's score with its caption under it, have no pill around them.
 */
function ScorePill({ match, state, change, teamKey, compact }) {
  const isFinal = state === "fulltime" || state === "suspended";
  const clock = !isFinal && !isHalfTime(match) && getMatchClock(match);
  const penalties = getPenalties(match);
  const celebrating = change.count > 0 && change.scorerKey === teamKey;
  let middle = null;
  if (isFinal) {
    middle = "–";
  } else if (isHalfTime(match)) {
    middle = <span data-l10n-id="newtab-wrexham-widget-half-time-short" />;
  } else if (clock) {
    middle = (
      <span
        data-l10n-id="newtab-wrexham-widget-clock"
        data-l10n-args={JSON.stringify({ clock })}
      />
    );
  }
  let variant = "live";
  if (
    state === "suspended" ||
    (compact && (isFinal || penalties || isExtraTime(match)))
  ) {
    variant = "plain";
  } else if (isFinal) {
    variant = "final";
  }
  const classNames = ["wrexham-score-pill", `wrexham-score-pill-${variant}`];
  if (penalties) {
    classNames.push("wrexham-score-pill-penalties");
  }
  if (celebrating) {
    classNames.push("wrexham-celebrate");
  } else if (change.count) {
    classNames.push("wrexham-score-changed");
  }
  let labelId = "newtab-wrexham-widget-score-label";
  const labelArgs = {
    home: match.home_team?.name ?? "",
    away: match.away_team?.name ?? "",
    homeScore: match.home_score,
    awayScore: match.away_score,
  };
  if (penalties) {
    labelId = "newtab-wrexham-widget-score-label-penalties";
    labelArgs.homePenalties = penalties.home;
    labelArgs.awayPenalties = penalties.away;
  } else if (clock) {
    labelId = "newtab-wrexham-widget-score-label-clock";
    labelArgs.clock = clock;
  }
  return (
    <span key={change.count} className={classNames.join(" ")}>
      <span
        className="sr-only"
        data-l10n-id={labelId}
        data-l10n-args={JSON.stringify(labelArgs)}
      />
      {penalties && (
        <span className="wrexham-score-penalties" aria-hidden="true">
          ({penalties.home})
        </span>
      )}
      <span className="wrexham-score-digit" aria-hidden="true">
        {match.home_score}
      </span>
      {middle && (
        <span className="wrexham-score-middle" aria-hidden="true">
          {middle}
        </span>
      )}
      <span className="wrexham-score-digit" aria-hidden="true">
        {match.away_score}
      </span>
      {penalties && (
        <span className="wrexham-score-penalties" aria-hidden="true">
          ({penalties.away})
        </span>
      )}
      {celebrating && (
        <>
          <span
            className={`wrexham-plus-one wrexham-plus-one-${match.home_team?.key === teamKey ? "home" : "away"}`}
            aria-hidden="true"
          >
            +1
          </span>
          <span className="wrexham-confetti" aria-hidden="true">
            {Array.from({ length: CONFETTI_PIECES }, (_, index) => (
              <span key={index} />
            ))}
          </span>
        </>
      )}
    </span>
  );
}

// "Extra time" or "Penalties" under the score of a cup tie.
function ScoreCaption({ match }) {
  let l10nId = null;
  if (getPenalties(match)) {
    l10nId = "newtab-wrexham-widget-penalties";
  } else if (isExtraTime(match)) {
    l10nId = "newtab-wrexham-widget-extra-time";
  }
  if (!l10nId) {
    return null;
  }
  return <span className="wrexham-score-caption" data-l10n-id={l10nId} />;
}

function KickoffTime({ match, className }) {
  return (
    <span
      className={className}
      data-l10n-id="newtab-wrexham-widget-kickoff-time"
      data-l10n-args={JSON.stringify({ date: Date.parse(match.date) })}
    />
  );
}

// "Kicks off in 3h 12m" on matchday, "Fri · in 4 days" before then. A delayed
// or postponed match has its label instead.
function KickoffWhen({ match, phase, state, now, className }) {
  if (state) {
    return null;
  }
  const kickoff = Date.parse(match.date);
  if (phase === PHASES.OFFDAY) {
    return (
      <p
        className={className}
        data-l10n-id="newtab-wrexham-widget-relative-day"
        data-l10n-args={JSON.stringify({
          date: kickoff,
          days: getDaysUntil(kickoff, now),
        })}
      />
    );
  }
  const countdown = getCountdown(kickoff, now);
  return (
    <p
      className={className}
      data-l10n-id={
        countdown
          ? "newtab-wrexham-widget-countdown"
          : "newtab-wrexham-widget-countdown-now"
      }
      data-l10n-args={countdown ? JSON.stringify(countdown) : undefined}
    />
  );
}

function MatchMeta({ match, state, league }) {
  const place = getMatchPlace(match, state, league);
  if (state) {
    return (
      <div className="wrexham-match-meta">
        <StatusPill state={state} />
        {place && (
          <p
            className={`wrexham-match-meta-text${NOTICE_STATES.has(state) ? " wrexham-match-meta-competition" : ""}`}
          >
            {place}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="wrexham-match-meta">
      <p
        className="wrexham-match-meta-text"
        data-l10n-id={
          place
            ? "newtab-wrexham-widget-match-meta"
            : "newtab-wrexham-widget-match-date"
        }
        data-l10n-args={JSON.stringify({
          date: Date.parse(match.date),
          venue: place,
        })}
      />
    </div>
  );
}

/**
 * The two teams with the kickoff time or the score between them.
 *
 * @param {object} props
 * @param {object} props.match
 * @param {string} props.phase - One of PHASES.
 * @param {string|null} props.state - From getMatchState.
 * @param {string} props.teamKey
 * @param {{count: number, scorerKey: string|null}} props.change
 * @param {React.ReactNode} [props.below] - Shown under the kickoff time.
 * @param {boolean} [props.compact] - At the medium size.
 */
function MatchTeams({ match, phase, state, teamKey, change, below, compact }) {
  const celebrate =
    change.count > 0 && change.scorerKey === teamKey ? change.count : 0;
  return (
    <div className="wrexham-match-teams">
      <TeamBlock
        team={match.home_team}
        teamKey={teamKey}
        celebrate={celebrate}
      />
      <div className="wrexham-match-centre">
        {hasScore(phase) ? (
          <>
            <ScorePill
              match={match}
              state={state}
              change={change}
              teamKey={teamKey}
              compact={compact}
            />
            <ScoreCaption match={match} />
          </>
        ) : (
          <KickoffTime match={match} className="wrexham-kickoff-time" />
        )}
        {below}
      </div>
      <TeamBlock
        team={match.away_team}
        teamKey={teamKey}
        celebrate={celebrate}
      />
    </div>
  );
}

function MatchPanel({ match, phase, state, teamKey, league, now, change }) {
  if (!match) {
    return (
      <p
        className="wrexham-empty"
        data-l10n-id="newtab-wrexham-widget-no-match"
      />
    );
  }
  // The teams sit higher when the countdown or the day goes under them.
  const showWhen = !hasScore(phase) && !state;
  const classNames = ["wrexham-match", `wrexham-match-${phase}`];
  if (showWhen) {
    classNames.push("wrexham-match-with-when");
  } else if (hasScore(phase) && (getPenalties(match) || isExtraTime(match))) {
    classNames.push("wrexham-match-with-caption");
  }
  return (
    <div className={classNames.join(" ")}>
      <MatchMeta match={match} state={state} league={league} />
      <MatchTeams
        match={match}
        phase={phase}
        state={state}
        teamKey={teamKey}
        change={change}
        below={
          showWhen && (
            <KickoffWhen
              match={match}
              phase={phase}
              state={state}
              now={now}
              className="wrexham-kickoff-when"
            />
          )
        }
      />
    </div>
  );
}

/**
 * Matches side by side in a scroller that snaps to each one, so they can be
 * swiped through.
 *
 * @param {object} props
 * @param {object} props.scrollerRef - Set to the scrolling element.
 * @param {number} props.active - The index of the match in view.
 * @param {Function} props.onActiveChange - Called with the index in view.
 * @param {React.ReactNode} props.children - One element per match.
 */
function MatchSlides({ scrollerRef, active, onActiveChange, children }) {
  const count = React.Children.count(children);
  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller?.clientWidth) {
      return;
    }
    // scrollLeft is negative in right-to-left layouts.
    const index = Math.round(
      Math.abs(scroller.scrollLeft) / scroller.clientWidth
    );
    if (index !== active) {
      onActiveChange(index);
    }
  };
  return (
    <div
      ref={scrollerRef}
      className="wrexham-slides"
      role="group"
      data-l10n-id="newtab-wrexham-widget-matches"
      onScroll={onScroll}
    >
      {React.Children.map(children, (child, index) => (
        <div
          className="wrexham-slide"
          role="group"
          data-l10n-id="newtab-wrexham-widget-match-slide"
          data-l10n-args={JSON.stringify({ index: index + 1, count })}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

const ERROR_L10N_IDS = {
  [TABS.MATCH]: "newtab-wrexham-widget-error-match",
  [TABS.TABLE]: "newtab-wrexham-widget-error-standings",
  [TABS.FIXTURES]: "newtab-wrexham-widget-error-results",
};

/**
 * Says the data couldn't be read.
 *
 * @param {object} props
 * @param {string} props.kind - The tab, one of TABS.
 * @param {string} [props.leagueName]
 * @param {React.ReactNode} [props.refresh] - The Refresh button, when it goes
 *   under the message rather than in the footer.
 */
function ErrorPanel({ kind, leagueName, refresh }) {
  const l10nId =
    kind === TABS.TABLE && !leagueName
      ? "newtab-wrexham-widget-error-table"
      : ERROR_L10N_IDS[kind];
  return (
    <div className="wrexham-error">
      <p
        className="wrexham-error-title"
        data-l10n-id={l10nId}
        data-l10n-args={JSON.stringify({ league: leagueName ?? "" })}
      />
      <p
        className="wrexham-error-body"
        data-l10n-id="newtab-wrexham-widget-error-body"
      />
      {refresh}
    </div>
  );
}

function Movement({ row }) {
  const direction = getRowMovement(row);
  if (!direction) {
    return null;
  }
  if (direction === "same") {
    return (
      <span
        className="wrexham-movement wrexham-movement-same"
        aria-hidden="true"
      />
    );
  }
  return (
    <span className={`wrexham-movement wrexham-movement-${direction}`}>
      <span
        className="sr-only"
        data-l10n-id={`newtab-wrexham-widget-movement-${direction}`}
        data-l10n-args={JSON.stringify({ previous: row.previous_position })}
      />
    </span>
  );
}

function StandingsTable({ rows, zones, teamKey, leagueName, ref }) {
  return (
    <table
      ref={ref}
      className="wrexham-table"
      data-l10n-id="newtab-wrexham-widget-table"
      data-l10n-args={JSON.stringify({ league: leagueName ?? "" })}
    >
      <thead>
        <tr>
          <th
            scope="col"
            colSpan={2}
            className="wrexham-table-club"
            data-l10n-id="newtab-wrexham-widget-table-club"
          />
          <th scope="col" data-l10n-id="newtab-wrexham-widget-table-played" />
          <th
            scope="col"
            data-l10n-id="newtab-wrexham-widget-table-goal-difference"
          />
          <th
            scope="col"
            className="wrexham-table-points"
            data-l10n-id="newtab-wrexham-widget-table-points"
          />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const zone = zones[index];
          const isWrexham = row.team.key === teamKey;
          return (
            <tr
              key={row.team.key}
              className={`wrexham-table-row${isWrexham ? " wrexham-table-row-highlight" : ""}`}
            >
              <td
                className={`wrexham-table-position${zone ? ` wrexham-zone-${zone}` : ""}`}
              >
                <span className="wrexham-table-place">{row.position}</span>
                <Movement row={row} />
                {zone && (
                  <span
                    className="sr-only"
                    data-l10n-id={`newtab-wrexham-widget-zone-${zone}`}
                  />
                )}
              </td>
              <th
                scope="row"
                className="wrexham-table-team"
                title={row.team.name}
              >
                {getTeamName(row.team)}
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

function TablePanel({ standings, teamKey, leagueKey, leagueName }) {
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

  const zones = standings.map(row =>
    getTableZone(leagueKey, row.position, standings.length)
  );
  return (
    <>
      <StandingsTable
        ref={tableRef}
        rows={standings}
        zones={zones}
        teamKey={teamKey}
        leagueName={leagueName}
      />
      {zones.some(Boolean) && (
        // Each zone row carries its own label for screen readers.
        <ul className="wrexham-table-legend" aria-hidden="true">
          {TABLE_ZONES.map(zone => (
            <li
              key={zone}
              className={`wrexham-zone-${zone}`}
              data-l10n-id={`newtab-wrexham-widget-zone-${zone}`}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function FixtureRow({ match, teamKey }) {
  const date = Date.parse(match.date);
  const played = Number.isFinite(match.home_score);
  const penalties = getPenalties(match);
  return (
    <li className={`wrexham-fixture${played ? " wrexham-fixture-played" : ""}`}>
      <TeamMark team={match.home_team} teamKey={teamKey} />
      <span className="wrexham-fixture-team">
        {getTeamName(match.home_team)}
      </span>
      <span className="wrexham-fixture-centre">
        {played ? (
          <span className="wrexham-fixture-main">
            {penalties && (
              <span className="wrexham-fixture-penalties">
                ({penalties.home})
              </span>
            )}
            <span
              data-l10n-id="newtab-wrexham-widget-score"
              data-l10n-args={JSON.stringify({
                home: match.home_score,
                away: match.away_score,
              })}
            />
            {penalties && (
              <span className="wrexham-fixture-penalties">
                ({penalties.away})
              </span>
            )}
          </span>
        ) : (
          <span
            className="wrexham-fixture-main"
            data-l10n-id="newtab-wrexham-widget-fixture-time"
            data-l10n-args={JSON.stringify({ date })}
          />
        )}
        <span
          className="wrexham-fixture-date"
          data-l10n-id="newtab-wrexham-widget-fixture-date"
          data-l10n-args={JSON.stringify({
            date,
            day: new Date(date).getDate(),
          })}
        />
      </span>
      <span className="wrexham-fixture-team wrexham-fixture-away">
        {getTeamName(match.away_team)}
      </span>
      <TeamMark team={match.away_team} teamKey={teamKey} />
    </li>
  );
}

// Wrexham's last results behind a disclosure that starts closed, then the
// next matches, so the list reads in date order.
function FixturesPanel({ results, upcoming, teamKey }) {
  return (
    <div className="wrexham-fixtures">
      {!!results?.length && (
        <details className="wrexham-fixtures-results">
          <summary data-l10n-id="newtab-wrexham-widget-fixtures-results" />
          <ul className="wrexham-fixtures-list">
            {results.map(match => (
              <FixtureRow key={match.id} match={match} teamKey={teamKey} />
            ))}
          </ul>
        </details>
      )}
      <h3
        className="wrexham-fixtures-heading"
        data-l10n-id="newtab-wrexham-widget-fixtures-upcoming"
      />
      {upcoming?.length ? (
        <ul className="wrexham-fixtures-list">
          {upcoming.map(match => (
            <FixtureRow key={match.id} match={match} teamKey={teamKey} />
          ))}
        </ul>
      ) : (
        <p
          className="wrexham-empty"
          data-l10n-id="newtab-wrexham-widget-no-match"
        />
      )}
    </div>
  );
}

function CompactView({ phase, state, match, teamKey, now, change }) {
  if (!match) {
    return (
      <p
        className="wrexham-empty wrexham-compact"
        data-l10n-id="newtab-wrexham-widget-no-match"
      />
    );
  }
  let below = null;
  if (phase === PHASES.PREMATCH) {
    below = (
      <span
        className="wrexham-compact-date"
        data-l10n-id="newtab-wrexham-widget-match-date"
        data-l10n-args={JSON.stringify({ date: Date.parse(match.date) })}
      />
    );
  } else if (phase === PHASES.OFFDAY) {
    below = (
      <KickoffWhen
        match={match}
        phase={phase}
        state={state}
        now={now}
        className="wrexham-compact-date"
      />
    );
  }
  return (
    <div className={`wrexham-compact wrexham-match-${phase}`}>
      <MatchTeams
        match={match}
        phase={phase}
        state={state}
        teamKey={teamKey}
        change={change}
        below={below}
        compact={true}
      />
    </div>
  );
}

/**
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
  const { data, error } = useSelector(state => state.Wrexham);
  const failed = !data && error;

  const widgetSize = resolveWidgetSize(WREXHAM_ENTRY, prefs);
  const isLarge = widgetSize === "large";

  const teamKey = data?.team?.key;
  useTick(usePageVisible() && !!data);
  const now = Date.now();
  const phase = getWrexhamPhase(data?.focus_match, now);
  const match = getMatchForPhase(data, phase);
  const matchState = getMatchState(match, phase);
  const { announcement, change } = useScoreChanges(
    data?.focus_match,
    phase,
    teamKey
  );

  // A picked tab stays for the life of the page, so a kickoff or final whistle
  // never swaps the panel under the user.
  const [selectedTab, setSelectedTab] = useState(null);
  const activeTab = selectedTab ?? TABS.MATCH;
  const tablistRef = useRef(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const slidesRef = useRef(null);
  const slides =
    isLarge && match
      ? [
          match,
          ...(data?.upcoming ?? [])
            .filter(next => next.id !== match.id)
            .slice(0, EXTRA_MATCHES),
        ]
      : [];
  const slideIndex = Math.min(activeSlide, Math.max(slides.length - 1, 0));

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
      setActiveSlide(0);
      recordUserAction(USER_ACTION_TYPES.CHANGE_TAB, {
        source: "widget",
        value: tab,
      });
      handleInteraction();
    },
    [activeTab, recordUserAction, handleInteraction]
  );

  // Called when a swipe brings another match into view.
  const showSlide = useCallback(
    index => {
      setActiveSlide(index);
      recordUserAction(USER_ACTION_TYPES.CHANGE_MATCH, {
        source: "widget",
        value: String(index),
      });
      handleInteraction();
    },
    [recordUserAction, handleInteraction]
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

  const handleWallpapers = () => {
    batch(() => {
      dispatch({ type: at.SHOW_PERSONALIZE });
      recordUserAction(USER_ACTION_TYPES.MANAGE_WALLPAPER, {
        source: "context_menu",
      });
      handleInteraction();
    });
  };

  // The medium size's menu opens a tab by switching to the large size.
  const handleOpenTab = tab => {
    batch(() => {
      setSelectedTab(tab);
      setActiveSlide(0);
      recordUserAction(USER_ACTION_TYPES.CHANGE_TAB, {
        source: "context_menu",
        value: tab,
      });
      handleChangeSize("large");
    });
  };

  const handleRefresh = source => {
    dispatch(ac.OnlyToMain({ type: at.WIDGETS_WREXHAM_REFRESH }));
    recordUserAction(USER_ACTION_TYPES.REFRESH, { source });
    handleInteraction();
  };

  // Only an ordinary match that hasn't started has the filled button. A
  // suspended match has no live match centre to follow.
  const matchFooter = {
    kind: "match",
    href: getMatchLink(match),
    l10nId:
      matchState === "suspended"
        ? "newtab-wrexham-widget-link-match-details"
        : MATCH_LINK_L10N_IDS[phase],
    outline: !!matchState || hasScore(phase),
  };

  let panel;
  let footer;
  if (activeTab === TABS.TABLE) {
    footer = {
      kind: "table",
      href: WREXHAM_LINKS.table,
      l10nId: "newtab-wrexham-widget-link-table",
    };
    panel = data?.standings?.length ? (
      <TablePanel
        standings={data.standings}
        teamKey={teamKey}
        leagueKey={data.league?.key}
        leagueName={data.league?.name}
      />
    ) : null;
  } else if (activeTab === TABS.FIXTURES) {
    footer = {
      kind: "fixtures",
      href: WREXHAM_LINKS.fixtures,
      l10nId: "newtab-wrexham-widget-link-fixtures",
    };
    panel =
      data?.results?.length || data?.upcoming?.length ? (
        <FixturesPanel
          results={data.results}
          upcoming={data.upcoming}
          teamKey={teamKey}
        />
      ) : null;
  } else if (data) {
    const { league } = data;
    panel =
      slides.length > 1 ? (
        <MatchSlides
          scrollerRef={slidesRef}
          active={slideIndex}
          onActiveChange={showSlide}
        >
          {slides.map((slide, index) =>
            index ? (
              <MatchPanel
                key={slide.id}
                match={slide}
                phase={PHASES.OFFDAY}
                state={null}
                teamKey={teamKey}
                league={league}
                now={now}
                change={NO_CHANGE}
              />
            ) : (
              <MatchPanel
                key={slide.id}
                match={slide}
                phase={phase}
                state={matchState}
                teamKey={teamKey}
                league={league}
                now={now}
                change={change}
              />
            )
          )}
        </MatchSlides>
      ) : (
        <MatchPanel
          match={match}
          phase={phase}
          state={matchState}
          teamKey={teamKey}
          league={league}
          now={now}
          change={change}
        />
      );
    footer =
      slideIndex > 0
        ? {
            kind: "match",
            href: getMatchLink(slides[slideIndex]),
            l10nId: "newtab-wrexham-widget-link-match-details",
          }
        : matchFooter;
  }

  const footerLink = (link, source) => (
    <a
      className={`wrexham-footer-link${link.outline ? " wrexham-footer-link-outline" : ""}`}
      href={link.href}
      onClick={() => handleLinkClick(link.kind, source)}
      data-l10n-id={link.l10nId}
    />
  );

  const refreshButton = source => (
    <button
      type="button"
      className="wrexham-footer-link"
      onClick={() => handleRefresh(source)}
      data-l10n-id="newtab-wrexham-widget-error-refresh"
    />
  );

  return (
    <article
      className={`wrexham widget col-4 ${widgetSize}-widget`}
      ref={impressionRef}
      aria-labelledby="wrexham-widget-label"
    >
      <header className="wrexham-header">
        <img className="wrexham-header-crest" src={CREST_URL} alt="" />
        <h2
          id="wrexham-widget-label"
          className="wrexham-title"
          data-l10n-id="newtab-wrexham-widget-title"
        />
        <div className="wrexham-context-menu-wrapper">
          <WidgetMenuButton
            className="wrexham-context-menu-button"
            menuId="wrexham-context-menu"
            l10nId="newtab-wrexham-widget-open-menu-button"
          />
          <panel-list className="panel-list-no-icons" id="wrexham-context-menu">
            {!isLarge &&
              widgetsMayBeMaximized &&
              TAB_ORDER.map(tab => (
                <panel-item
                  key={tab}
                  data-l10n-id={`newtab-wrexham-widget-tab-${tab}`}
                  onClick={() => handleOpenTab(tab)}
                />
              ))}
            <panel-item
              data-l10n-id="newtab-wrexham-menu-wallpapers"
              onClick={handleWallpapers}
            />
            <WidgetMenuFooter
              dispatch={dispatch}
              widgetId={WREXHAM_ENTRY.id}
              widgetEnabledMap={widgetEnabledMap}
              widgetName={WREXHAM_ENTRY.telemetryName}
              enabledPref={WREXHAM_ENTRY.enabledPref}
              widgetSize={widgetSize}
              learnMoreL10nId="newtab-wrexham-menu-learn-more"
              onLearnMore={handleLearnMore}
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

      {/* Rendered from the start so screen readers announce later changes. */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement && (
          <span
            key={announcement.seq}
            data-l10n-id={announcement.l10nId}
            data-l10n-args={JSON.stringify(announcement.args)}
          />
        )}
      </div>

      {failed && !isLarge && (
        <>
          <div className="wrexham-compact">
            <ErrorPanel kind={TABS.MATCH} />
          </div>
          <div className="wrexham-footer">{refreshButton("compact")}</div>
        </>
      )}

      {data && !isLarge && (
        <>
          <CompactView
            phase={phase}
            state={matchState}
            match={match}
            teamKey={teamKey}
            now={now}
            change={change}
          />
          {/* With no state beside it, the button sits under the kickoff time. */}
          <div
            className={`wrexham-footer${matchState ? "" : " wrexham-footer-centered"}`}
          >
            {footerLink(matchFooter, "compact")}
            <StatusPill state={matchState} />
          </div>
        </>
      )}

      {(data || failed) && isLarge && (
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
            {panel ?? (
              <ErrorPanel
                kind={activeTab}
                leagueName={data?.league?.name}
                refresh={refreshButton(activeTab)}
              />
            )}
          </div>
          {panel && (
            <div className="wrexham-footer">
              {footerLink(footer, activeTab)}
            </div>
          )}
        </>
      )}
    </article>
  );
};

export { Wrexham };
