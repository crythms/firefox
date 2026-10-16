/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  actionTypes: "resource://newtab/common/Actions.mjs",
  sinon: "resource://testing-common/Sinon.sys.mjs",
  WrexhamFeed: "resource://newtab/lib/Widgets/WrexhamFeed.sys.mjs",
});

const PREF_WIDGETS_ENABLED = "widgets.enabled";
const PREF_WREXHAM_ENABLED = "widgets.wrexham.enabled";
const PREF_SYSTEM_WREXHAM_ENABLED = "widgets.system.wrexham.enabled";
const PREF_MOCK_SCENARIO = "widgets.wrexham.mockScenario";

function feedWithPrefs(values) {
  const feed = new WrexhamFeed();
  feed.store = {
    getState() {
      return this.state;
    },
    dispatch: sinon.spy(),
    state: { Prefs: { values } },
  };
  return feed;
}

function enabledPrefs(extra = {}) {
  return {
    [PREF_WIDGETS_ENABLED]: true,
    [PREF_WREXHAM_ENABLED]: true,
    [PREF_SYSTEM_WREXHAM_ENABLED]: true,
    ...extra,
  };
}

function broadcasts(feed) {
  return feed.store.dispatch
    .getCalls()
    .map(call => call.args[0])
    .filter(action => action.type === actionTypes.WIDGETS_WREXHAM_UPDATE);
}

add_task(async function test_enabled_reflects_registry() {
  Assert.ok(feedWithPrefs(enabledPrefs()).enabled, "Enabled with all prefs on");
  Assert.ok(
    !feedWithPrefs(enabledPrefs({ [PREF_WREXHAM_ENABLED]: false })).enabled,
    "Disabled when the user pref is off"
  );
  Assert.ok(
    !feedWithPrefs(enabledPrefs({ [PREF_SYSTEM_WREXHAM_ENABLED]: false }))
      .enabled,
    "Disabled when the system pref is off"
  );
  Assert.ok(
    !feedWithPrefs(enabledPrefs({ [PREF_WIDGETS_ENABLED]: false })).enabled,
    "Disabled when the widgets container is off"
  );
  Assert.ok(
    feedWithPrefs(
      enabledPrefs({
        [PREF_SYSTEM_WREXHAM_ENABLED]: false,
        trainhopConfig: { widgetWrexham: { visible: true } },
      })
    ).enabled,
    "Enabled by the widgetWrexham train-hop namespace"
  );
});

add_task(async function test_init_broadcasts_when_enabled() {
  const feed = feedWithPrefs(enabledPrefs({ [PREF_MOCK_SCENARIO]: "live" }));
  await feed.onAction({ type: actionTypes.INIT });

  const sent = broadcasts(feed);
  Assert.equal(sent.length, 1, "Broadcast once on INIT");
  Assert.equal(
    sent[0].data.focus_match.status_type,
    "live",
    "Broadcasts the scenario the pref asks for"
  );
  Assert.equal(sent[0].meta.to, "ActivityStream:Content");
  Assert.equal(sent[0].meta.from, "ActivityStream:Main");
});

add_task(async function test_init_is_silent_when_disabled() {
  const feed = feedWithPrefs(enabledPrefs({ [PREF_WREXHAM_ENABLED]: false }));
  await feed.onAction({ type: actionTypes.INIT });
  Assert.equal(broadcasts(feed).length, 0, "Nothing sent while disabled");
});

add_task(async function test_scenario_change_rebroadcasts() {
  const feed = feedWithPrefs(enabledPrefs({ [PREF_MOCK_SCENARIO]: "offday" }));
  feed.store.state.Prefs.values[PREF_MOCK_SCENARIO] = "fulltime";
  await feed.onAction({
    type: actionTypes.PREF_CHANGED,
    data: { name: PREF_MOCK_SCENARIO, value: "fulltime" },
  });

  const sent = broadcasts(feed);
  Assert.equal(sent.length, 1, "Broadcast on the scenario change");
  Assert.equal(sent[0].data.focus_match.status_type, "past");
});

add_task(async function test_enablement_change_broadcasts() {
  const feed = feedWithPrefs(enabledPrefs({ [PREF_WREXHAM_ENABLED]: false }));
  feed.store.state.Prefs.values[PREF_WREXHAM_ENABLED] = true;
  await feed.onAction({
    type: actionTypes.PREF_CHANGED,
    data: { name: PREF_WREXHAM_ENABLED, value: true },
  });
  Assert.equal(broadcasts(feed).length, 1, "Broadcast once switched on");
});

add_task(async function test_unrelated_pref_is_ignored() {
  const feed = feedWithPrefs(enabledPrefs());
  await feed.onAction({
    type: actionTypes.PREF_CHANGED,
    data: { name: "widgets.stocks.enabled", value: true },
  });
  Assert.equal(broadcasts(feed).length, 0, "No broadcast for other prefs");
});

add_task(async function test_failed_read_broadcasts_error() {
  const feed = feedWithPrefs(enabledPrefs({ [PREF_MOCK_SCENARIO]: "error" }));
  await feed.onAction({ type: actionTypes.INIT });
  Assert.equal(broadcasts(feed).length, 0, "No data to send");
  Assert.ok(
    feed.store.dispatch
      .getCalls()
      .some(call => call.args[0].type === actionTypes.WIDGETS_WREXHAM_ERROR),
    "Tells the page the read failed"
  );
});

add_task(async function test_refresh_reads_again() {
  const feed = feedWithPrefs(enabledPrefs());
  await feed.onAction({ type: actionTypes.WIDGETS_WREXHAM_REFRESH });
  Assert.equal(broadcasts(feed).length, 1, "Broadcast after a refresh");
});
