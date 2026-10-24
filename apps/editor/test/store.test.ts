import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDocument, createProject } from "@nexus/ir";
import { Store } from "../src/store.ts";

function freshStore(): Store {
  return new Store(createDocument(createProject({ name: "Test", locale: "en" })));
}

describe("editor store", () => {
  it("starts clean with nothing selected", () => {
    const store = freshStore();
    assert.equal(store.state.dirty, false);
    assert.equal(store.state.selectedId, null);
    assert.equal(store.state.status, "idle");
    assert.equal(store.state.zoom, 1);
  });

  it("records undo snapshots and restores them", () => {
    const store = freshStore();
    store.update((document) => {
      document.project.name = "Renamed";
    });
    assert.equal(store.state.document.project.name, "Renamed");
    assert.equal(store.canUndo(), true);

    store.undo();
    assert.equal(store.state.document.project.name, "Test");
    assert.equal(store.canRedo(), true);

    store.redo();
    assert.equal(store.state.document.project.name, "Renamed");
  });

  it("skips history and dirty marking when asked", () => {
    const store = freshStore();
    store.markSaved();
    store.update(
      (document) => {
        document.project.metadata.view = "ignored";
      },
      { history: false, dirty: false },
    );
    assert.equal(store.state.dirty, false);
    assert.equal(store.canUndo(), false);
  });

  it("marks the document dirty after edits and clean after save", () => {
    const store = freshStore();
    store.update((document) => {
      document.project.metadata.touched = true;
    });
    assert.equal(store.state.dirty, true);
    store.markSaved();
    assert.equal(store.state.dirty, false);
  });

  it("clears redo history once a new edit lands", () => {
    const store = freshStore();
    store.update((document) => {
      document.project.name = "A";
    });
    store.undo();
    store.update((document) => {
      document.project.name = "B";
    });
    assert.equal(store.canRedo(), false);
  });

  it("carries the selected id forward only while the block exists", () => {
    const store = freshStore();
    store.update((document) => {
      document.project.scripts.push({
        id: "start-1",
        type: "control.start",
        fields: {},
        inputs: { body: [] },
      });
    });
    store.select("start-1");
    assert.equal(store.state.selectedId, "start-1");

    store.select(null);
    assert.equal(store.state.selectedId, null);
  });

  it("caps stored logs", () => {
    const store = freshStore();
    for (let index = 0; index < 600; index += 1) {
      store.pushLog({ level: "info", text: `line ${index}` });
    }
    assert.equal(store.state.logs.length, 500);
    assert.equal(store.state.logs.at(-1)?.text, "line 599");
    store.clearLogs();
    assert.equal(store.state.logs.length, 0);
  });

  it("toggles breakpoints without marking the document dirty", () => {
    const store = freshStore();
    const blockId = "block-1";
    const scriptsBefore = JSON.stringify(store.state.document.project.scripts);
    store.toggleBreakpoint(blockId);
    assert.equal(store.breakpoints.has(blockId), true);
    assert.equal(store.state.dirty, false);
    assert.equal(store.canUndo(), false);
    store.toggleBreakpoint(blockId);
    assert.equal(store.breakpoints.has(blockId), false);
    assert.equal(JSON.stringify(store.state.document.project.scripts) === scriptsBefore, true);
  });

  it("clamps zoom into the supported range", () => {
    const store = freshStore();
    store.setZoom(10);
    assert.equal(store.state.zoom, 2);
    store.setZoom(0.01);
    assert.equal(store.state.zoom, 0.4);
  });
});
