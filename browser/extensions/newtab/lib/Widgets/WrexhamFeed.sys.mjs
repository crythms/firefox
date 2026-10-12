/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** @import {Store} from "resource://newtab/lib/Store.sys.mjs" */

import {
  actionTypes as at,
  actionCreators as ac,
} from "resource://newtab/common/Actions.mjs";
import {
  WIDGET_REGISTRY,
  isWidgetEnabled,
} from "resource://newtab/common/WidgetsRegistry.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  buildMockData: "resource://newtab/lib/Widgets/WrexhamMockData.sys.mjs",
});

const PREF_WIDGETS_ENABLED = "widgets.enabled";
const PREF_MOCK_SCENARIO = "widgets.wrexham.mockScenario";

const WREXHAM_ENTRY = WIDGET_REGISTRY.find(w => w.id === "wrexham");

// Prefs that can change whether the widget is enabled.
const ENABLEMENT_PREFS = new Set([
  PREF_WIDGETS_ENABLED,
  WREXHAM_ENTRY.enabledPref,
  WREXHAM_ENTRY.systemEnabledPref,
  "trainhopConfig",
]);

/**
 * Feed for the Wrexham AFC widget. Runs in the parent process.
 */
export class WrexhamFeed {
  /** @type {Store} */
  store = null;

  get enabled() {
    const prefs = this.store.getState()?.Prefs.values;
    return isWidgetEnabled(WREXHAM_ENTRY, prefs, prefs?.[PREF_WIDGETS_ENABLED]);
  }

  // Dummy data for now; this is where the Merino sports API call goes.
  async #fetchData() {
    const scenario = this.store.getState()?.Prefs.values[PREF_MOCK_SCENARIO];
    return lazy.buildMockData(scenario, Date.now());
  }

  async update() {
    let data;
    try {
      data = await this.#fetchData();
    } catch (error) {
      console.error("Wrexham widget failed to read its data", error);
      return;
    }
    this.store.dispatch(
      ac.BroadcastToContent({
        type: at.WIDGETS_WREXHAM_UPDATE,
        data,
      })
    );
  }

  async onAction(action) {
    switch (action.type) {
      case at.INIT:
        if (this.enabled) {
          await this.update();
        }
        break;
      case at.PREF_CHANGED:
        if (
          (ENABLEMENT_PREFS.has(action.data?.name) ||
            action.data?.name === PREF_MOCK_SCENARIO) &&
          this.enabled
        ) {
          await this.update();
        }
        break;
    }
  }
}
