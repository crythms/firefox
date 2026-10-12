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
  getMinutesSinceUpdate,
  getMonogramColors,
  getOpponent,
  getPositionChange,
  getResultForTeam,
  getRowMovement,
  getScoreForTeam,
  getTableZone,
  getTeamEvents,
  getWrexhamPhase,
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
 * highlight. Nothing fires on the first render.
 *
 * @returns {{announcement: object|null, flash: number}} flash counts the score
 *   changes seen.
 */
function useScoreChanges(match, phase, teamKey) {
  const previous = useRef(null);
  const [announcement, setAnnouncement] = useState(null);
  const [flash, setFlash] = useState(0);
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
      scorer = args.home;
    } else if (away > prev.away && home === prev.home) {
      scorer = args.away;
    }
    setAnnouncement(current => ({
      seq: (current?.seq ?? 0) + 1,
      l10nId: scorer
        ? "newtab-wrexham-widget-announce-goal"
        : "newtab-wrexham-widget-announce-score",
      args: scorer ? { ...args, team: scorer } : args,
    }));
    setFlash(count => count + 1);
    // The match object changes with every update; only these values matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, home, away, phase]);

  return { announcement, flash };
}

const USER_ACTION_TYPES = {
  CHANGE_SIZE: "change_size",
  CHANGE_TAB: "change_tab",
  LEARN_MORE: "learn_more",
  OPEN_LINK: "open_link",
};

const WREXHAM_ENTRY = WIDGET_REGISTRY.find(w => w.id === "wrexham");

const CREST_URL =
  "chrome://newtab/content/data/content/assets/wrexham/crest.svg";

// Placeholders until the club confirms where each click should land.
export const WREXHAM_LINKS = {
  match: "https://www.wrexhamafc.co.uk/fixtures/",
  table: "https://www.wrexhamafc.co.uk/table/",
  fixtures: "https://www.wrexhamafc.co.uk/fixtures/",
};

const CLUB_TIME_ZONE = "Europe/London";

const TABLE_ZONES = ["promotion", "playoffs", "relegation"];

const MATCH_LINK_L10N_IDS = {
  [PHASES.PREMATCH]: "newtab-wrexham-widget-link-match-preview",
  [PHASES.LIVE]: "newtab-wrexham-widget-link-match-centre",
  [PHASES.FULLTIME]: "newtab-wrexham-widget-link-match-report",
  [PHASES.OFFDAY]: "newtab-wrexham-widget-link-match-preview",
};

// about:newtab has no dir attribute on <html>.
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
 * Shifts a time so that, formatted in the fan's time zone, it reads as the
 * clock in Wrexham. Fluent's DATETIME has no time zone option.
 *
 * @param {number} date - A ms epoch.
 * @returns {number|null} Null if the fan's clock already matches Wrexham's.
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

// Keyed by flash so each score change remounts it and replays the highlight.
function Score({ match, flash = 0 }) {
  return (
    <span
      key={flash}
      className={`wrexham-score${flash ? " wrexham-score-changed" : ""}`}
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

function OpponentText({ match, teamKey, className }) {
  const side = getOpponent(match, teamKey);
  if (!side) {
    return null;
  }
  return (
    <span
      className={className}
      data-l10n-id={
        side.isHome
          ? "newtab-wrexham-widget-opponent-home"
          : "newtab-wrexham-widget-opponent-away"
      }
      data-l10n-args={JSON.stringify({ opponent: side.opponent?.name ?? "" })}
    />
  );
}

function RelativeDay({ date, now, className }) {
  return (
    <span
      className={className}
      data-l10n-id="newtab-wrexham-widget-relative-day"
      data-l10n-args={JSON.stringify({ date, days: getDaysUntil(date, now) })}
    />
  );
}

function FormStrip({ form }) {
  return (
    <ol
      className="wrexham-form"
      data-l10n-id="newtab-wrexham-widget-form-list"
      data-l10n-args={JSON.stringify({ count: form.length })}
    >
      {form.map((result, index) => (
        <li
          // Results have no ids, and the order never changes.
          key={index}
          className={`wrexham-result wrexham-result-${result} wrexham-form-chip`}
        >
          <span
            aria-hidden="true"
            data-l10n-id={`newtab-wrexham-widget-form-${result}`}
          />
          <span
            className="sr-only"
            data-l10n-id={`newtab-wrexham-widget-result-${result}`}
          />
        </li>
      ))}
    </ol>
  );
}

function OffdayPanel({ data, teamKey, now }) {
  const last = data.last_match;
  const lastScore = last && getScoreForTeam(last, teamKey);
  const lastSide = last && getOpponent(last, teamKey);
  const next = data.next_match;
  const nextKickoff = next && Date.parse(next.date);
  return (
    <div className="wrexham-offday">
      {lastScore && lastSide && (
        <>
          <span
            className="wrexham-offday-label"
            data-l10n-id="newtab-wrexham-widget-last-result-label"
          />
          <p className="wrexham-offday-row">
            <ResultChip result={getResultForTeam(last, teamKey)} />
            <span
              data-l10n-id="newtab-wrexham-widget-last-result"
              data-l10n-args={JSON.stringify({
                ours: lastScore.ours,
                theirs: lastScore.theirs,
                opponent: lastSide.opponent?.name ?? "",
              })}
            />
          </p>
        </>
      )}
      {data.form?.length > 0 && (
        <>
          <span
            className="wrexham-offday-label"
            aria-hidden="true"
            data-l10n-id="newtab-wrexham-widget-form-label"
          />
          <FormStrip form={data.form} />
        </>
      )}
      <span
        className="wrexham-offday-label wrexham-offday-next-label"
        data-l10n-id="newtab-wrexham-widget-next-match-label"
      />
      {next ? (
        <div className="wrexham-offday-next">
          <OpponentText
            match={next}
            teamKey={teamKey}
            className="wrexham-offday-opponent"
          />
          <RelativeDay
            date={nextKickoff}
            now={now}
            className="wrexham-offday-when"
          />
          <span
            className="wrexham-offday-time"
            data-l10n-id="newtab-wrexham-widget-kickoff-time"
            data-l10n-args={JSON.stringify({ date: nextKickoff })}
          />
          <KickoffZone kickoff={nextKickoff} />
        </div>
      ) : (
        <p
          className="wrexham-offday-next wrexham-offday-when"
          data-l10n-id="newtab-wrexham-widget-no-match"
        />
      )}
    </div>
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

function KickoffZone({ kickoff }) {
  const clubTime = getClubWallClock(kickoff);
  return (
    <span
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
  );
}

function Kickoff({ match, now }) {
  const kickoff = Date.parse(match.date);
  const countdown = getCountdown(kickoff, now);
  let countdownL10nId = "newtab-wrexham-widget-countdown";
  if (match.status === "Delayed") {
    countdownL10nId = "newtab-wrexham-widget-countdown-delayed";
  } else if (!countdown) {
    countdownL10nId = "newtab-wrexham-widget-countdown-now";
  }
  return (
    <div className="wrexham-kickoff">
      <p
        className="wrexham-countdown"
        data-l10n-id={countdownL10nId}
        data-l10n-args={countdown ? JSON.stringify(countdown) : undefined}
      />
      <p
        className="wrexham-kickoff-time"
        data-l10n-id="newtab-wrexham-widget-kickoff-time"
        data-l10n-args={JSON.stringify({ date: kickoff })}
      />
      <KickoffZone kickoff={kickoff} />
    </div>
  );
}

function UpdatedCue({ match, now }) {
  const minutes = getMinutesSinceUpdate(match, now);
  if (minutes === null) {
    return null;
  }
  return (
    <p
      className="wrexham-updated"
      data-l10n-id="newtab-wrexham-widget-updated"
      data-l10n-args={JSON.stringify({ minutes })}
    />
  );
}

function MatchEvent({ event }) {
  const minute = event.minute_extra
    ? `${event.minute}+${event.minute_extra}`
    : event.minute;
  if (event.kind === "red_card") {
    return (
      <li className="wrexham-event wrexham-event-red-card">
        <span className="wrexham-card-icon" aria-hidden="true" />
        <span
          className="sr-only"
          data-l10n-id="newtab-wrexham-widget-red-card-label"
        />
        <span
          data-l10n-id="newtab-wrexham-widget-red-card"
          data-l10n-args={JSON.stringify({ player: event.player, minute })}
        />
      </li>
    );
  }
  return (
    <li
      className="wrexham-event wrexham-event-goal"
      data-l10n-id="newtab-wrexham-widget-goal"
      data-l10n-args={JSON.stringify({
        player: event.player,
        minute,
        type: event.type ?? "goal",
      })}
    />
  );
}

// Each list is named after its team so screen readers don't rely on the
// column position.
function Goals({ match }) {
  if (!match.goals?.length && !match.red_cards?.length) {
    return null;
  }
  const renderGoals = (teamKey, className, labelId) => {
    const events = getTeamEvents(match, teamKey);
    if (!events.length) {
      return <div className={className} />;
    }
    return (
      <ul className={className} aria-labelledby={labelId}>
        {events.map(event => (
          <MatchEvent
            key={`${event.kind}-${event.player}-${event.minute}`}
            event={event}
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

function MatchPanel({
  match,
  phase,
  teamKey,
  standings,
  leagueName,
  now,
  scoreFlash,
}) {
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
            <Score match={match} flash={scoreFlash} />
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
      {phase === PHASES.FULLTIME && (
        <PositionLine
          standings={standings}
          teamKey={teamKey}
          leagueName={leagueName}
        />
      )}
      {hasScore ? <Goals match={match} /> : <Kickoff match={match} now={now} />}
      {phase === PHASES.LIVE && <UpdatedCue match={match} now={now} />}
    </div>
  );
}

function Movement({ row }) {
  const direction = getRowMovement(row);
  if (direction !== "up" && direction !== "down") {
    return null;
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
        {rows.map((row, index) => {
          const zone = zones[index];
          const classNames = ["wrexham-table-row"];
          if (row.team.key === teamKey) {
            classNames.push("wrexham-table-row-highlight");
          }
          if (index < rows.length - 1 && zone !== zones[index + 1]) {
            classNames.push("wrexham-table-row-divider");
          }
          return (
            <tr key={row.team.key} className={classNames.join(" ")}>
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

  if (!standings?.length) {
    return (
      <p
        className="wrexham-empty"
        data-l10n-id="newtab-wrexham-widget-no-table"
      />
    );
  }

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

function FixtureRow({ match, highlight = false }) {
  const date = Date.parse(match.date);
  return (
    <li
      className={`wrexham-fixture${highlight ? " wrexham-fixture-highlight" : ""}`}
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
}

function FixturesPanel({ gameweek, teamKey, leagueName }) {
  if (!gameweek?.matches?.length) {
    return (
      <p
        className="wrexham-empty"
        data-l10n-id="newtab-wrexham-widget-no-fixtures"
      />
    );
  }
  const ours = gameweek.matches.find(match => getOpponent(match, teamKey));
  const others = gameweek.matches.filter(match => match !== ours);
  const otherRows = (
    <ul className="wrexham-fixtures-list">
      {others.map(match => (
        <FixtureRow key={match.id} match={match} />
      ))}
    </ul>
  );
  return (
    <div className="wrexham-fixtures">
      <h3
        className="wrexham-section-label"
        data-l10n-id="newtab-wrexham-widget-fixtures-heading"
        data-l10n-args={JSON.stringify({ number: gameweek.number })}
      />
      {ours && (
        <ul className="wrexham-fixtures-list">
          <FixtureRow match={ours} highlight={true} />
        </ul>
      )}
      {ours && !!others.length && (
        <details className="wrexham-fixtures-others">
          <summary
            data-l10n-id="newtab-wrexham-widget-fixtures-others"
            data-l10n-args={JSON.stringify({
              league: leagueName ?? "",
              count: others.length,
            })}
          />
          {otherRows}
        </details>
      )}
      {!ours && otherRows}
    </div>
  );
}

function CompactSummary({ data, teamKey }) {
  const last = data.last_match;
  const score = last && getScoreForTeam(last, teamKey);
  const side = last && getOpponent(last, teamKey);
  const row = data.standings?.find(entry => entry.team?.key === teamKey);
  const parts = [];
  if (score && side) {
    parts.push(
      <span
        key="last"
        data-l10n-id="newtab-wrexham-widget-compact-last"
        data-l10n-args={JSON.stringify({
          result: getResultForTeam(last, teamKey),
          ours: score.ours,
          theirs: score.theirs,
          opponent: side.opponent?.name ?? "",
        })}
      />
    );
  }
  if (row) {
    parts.push(
      <span
        key="position"
        data-l10n-id="newtab-wrexham-widget-compact-position"
        data-l10n-args={JSON.stringify({
          position: row.position,
          points: row.points,
        })}
      />
    );
  }
  if (!parts.length) {
    return null;
  }
  return (
    <p className="wrexham-compact-secondary">
      {parts[0]}
      {parts[1] && <span aria-hidden="true"> · </span>}
      {parts[1]}
    </p>
  );
}

function CompactView({ data, phase, match, teamKey, now, scoreFlash }) {
  if (phase === PHASES.OFFDAY) {
    const kickoff = match && Date.parse(match.date);
    return (
      <div className="wrexham-compact wrexham-compact-offday">
        {match ? (
          <>
            <OpponentText
              match={match}
              teamKey={teamKey}
              className="wrexham-compact-primary"
            />
            <p className="wrexham-compact-when">
              <RelativeDay date={kickoff} now={now} />
              <span aria-hidden="true"> · </span>
              <span
                className="wrexham-compact-when-time"
                data-l10n-id="newtab-wrexham-widget-kickoff-time"
                data-l10n-args={JSON.stringify({ date: kickoff })}
              />
            </p>
          </>
        ) : (
          <p
            className="wrexham-compact-when"
            data-l10n-id="newtab-wrexham-widget-no-match"
          />
        )}
        <CompactSummary data={data} teamKey={teamKey} />
      </div>
    );
  }
  if (!match) {
    return null;
  }
  const hasScore = phase === PHASES.LIVE || phase === PHASES.FULLTIME;
  return (
    <div
      className={`wrexham-compact wrexham-compact-match wrexham-match-${phase}`}
    >
      <span className="wrexham-team-name wrexham-compact-home">
        {match.home_team?.name}
      </span>
      <span className="wrexham-match-centre">
        {hasScore ? (
          <Score match={match} flash={scoreFlash} />
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
            className="wrexham-compact-date"
            data-l10n-id="newtab-wrexham-widget-match-date"
            data-l10n-args={JSON.stringify({ date: Date.parse(match.date) })}
          />
        )}
      </span>
      <span className="wrexham-team-name wrexham-compact-away">
        {match.away_team?.name}
      </span>
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
  const { data } = useSelector(state => state.Wrexham);

  const widgetSize = resolveWidgetSize(WREXHAM_ENTRY, prefs);
  const isLarge = widgetSize === "large";

  const teamKey = data?.team?.key;
  useTick(usePageVisible() && !!data);
  const now = Date.now();
  const phase = getWrexhamPhase(data?.focus_match, now);
  const match = getMatchForPhase(data, phase);
  const { announcement, flash } = useScoreChanges(
    data?.focus_match,
    phase,
    teamKey
  );
  const competitionName =
    (phase !== PHASES.OFFDAY && data?.focus_match?.competition?.name) ||
    data?.league?.name;

  // A picked tab stays for the life of the page, so a kickoff or final whistle
  // never swaps the panel under the user.
  const [selectedTab, setSelectedTab] = useState(null);
  const activeTab = selectedTab ?? TABS.MATCH;
  const tablistRef = useRef(null);

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

  const matchFooter = {
    kind: "match",
    href: getMatchLink(match),
    l10nId: MATCH_LINK_L10N_IDS[phase],
  };

  let panel;
  let footer;
  if (activeTab === TABS.TABLE) {
    panel = (
      <TablePanel
        standings={data?.standings}
        teamKey={teamKey}
        leagueKey={data?.league?.key}
        leagueName={data?.league?.name}
      />
    );
    footer = {
      kind: "table",
      href: WREXHAM_LINKS.table,
      l10nId: "newtab-wrexham-widget-link-table",
    };
  } else if (activeTab === TABS.FIXTURES) {
    panel = (
      <FixturesPanel
        gameweek={data?.gameweek}
        teamKey={teamKey}
        leagueName={data?.league?.name}
      />
    );
    footer = {
      kind: "fixtures",
      href: WREXHAM_LINKS.fixtures,
      l10nId: "newtab-wrexham-widget-link-fixtures",
    };
  } else {
    panel =
      phase === PHASES.OFFDAY ? (
        <OffdayPanel data={data ?? {}} teamKey={teamKey} now={now} />
      ) : (
        <MatchPanel
          match={match}
          phase={phase}
          teamKey={teamKey}
          standings={data?.standings}
          leagueName={data?.league?.name}
          now={now}
          scoreFlash={flash}
        />
      );
    footer = matchFooter;
  }

  return (
    <article
      className={`wrexham widget col-4 ${widgetSize}-widget`}
      ref={impressionRef}
      aria-labelledby="wrexham-widget-label"
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

      {data && !isLarge && (
        <>
          <CompactView
            data={data}
            phase={phase}
            match={match}
            teamKey={teamKey}
            now={now}
            scoreFlash={flash}
          />
          <a
            className="wrexham-footer-link"
            href={matchFooter.href}
            onClick={() => handleLinkClick(matchFooter.kind, "compact")}
            data-l10n-id={matchFooter.l10nId}
          />
        </>
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
