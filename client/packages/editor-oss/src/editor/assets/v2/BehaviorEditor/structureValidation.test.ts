import {describe, expect, it} from "vitest";

import {validateScript} from "./structureValidation";

const startupAsyncWarnings = (code: string) =>
    validateScript(code, "behavior").filter(marker =>
        marker.message.includes("Startup hook calls async"),
    );

describe("BehaviorEditor structure validation", () => {
    it("warns for the 100 Cars-style unawaited async startup builder call", () => {
        const markers = startupAsyncWarnings(`
let game;
this.init = function(_game) {
  game = _game;
  this._buildTrack = async function() {};
};

this.onStart = function() {
  if (this._built) return;
  this._buildTrack();
};
`);

        expect(markers).toHaveLength(1);
        expect(markers[0]).toMatchObject({
            severity: "Warning",
            startLineNumber: 10,
        });
        expect(markers[0]?.message).toContain("await/return/void");
        expect(markers[0]?.message).toContain("this.erth.runtime.processInBatches(...)");
    });

    it("does not warn when the async method call is awaited", () => {
        const markers = startupAsyncWarnings(`
this._buildTrack = async () => {};
this.onStart = async function() {
  await this._buildTrack();
};
`);

        expect(markers).toEqual([]);
    });

    it("does not warn when the async method call is returned", () => {
        const markers = startupAsyncWarnings(`
this._buildTrack = async function() {};
this.onAdded = function() {
  return this._buildTrack();
};
`);

        expect(markers).toEqual([]);
    });

    it("does not warn when the async method call is explicitly voided", () => {
        const markers = startupAsyncWarnings(`
this._buildTrack = async function() {};
this.onReset = function() {
  void this._buildTrack();
};
`);

        expect(markers).toEqual([]);
    });

    it("does not warn for synchronous same-script methods", () => {
        const markers = startupAsyncWarnings(`
this._buildTrack = function() {};
this.onStart = function() {
  this._buildTrack();
};
`);

        expect(markers).toEqual([]);
    });

    it("does not warn inside nested callbacks from startup hooks", () => {
        const markers = startupAsyncWarnings(`
this._buildTrack = async () => {};
this.onStart = function() {
  setTimeout(() => {
    this._buildTrack();
  }, 0);
};
`);

        expect(markers).toEqual([]);
    });

    it("preserves source line numbers after @import directives are stripped", () => {
        const markers = startupAsyncWarnings(`@import "helpers" as helpers;
this._buildTrack = async () => {};
this.onStart = function() {
  this._buildTrack();
};
`);

        expect(markers).toHaveLength(1);
        expect(markers[0]).toMatchObject({
            startLineNumber: 4,
            startColumn: 3,
        });
    });
});
