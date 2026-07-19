import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  changeProductFilters,
  changeProductPage,
  createDebouncer,
  DEFAULT_PRODUCT_LIST_STATE,
  deriveProductListViewState,
  parseProductListState,
  serializeProductListState,
} from "./list-state.js";

describe("product list URL state", () => {
  it("parses valid values and safely falls back from invalid values", () => {
    const state = parseProductListState(
      new URLSearchParams(
        "q=maxspect&active=true&categoryId=cat&brandId=brand&page=-4&pageSize=41",
      ),
    );
    assert.deepEqual(state, {
      q: "maxspect",
      active: "active",
      categoryId: "cat",
      brandId: "brand",
      page: 1,
      pageSize: 25,
    });
  });

  it("serializes filters while omitting defaults", () => {
    assert.equal(serializeProductListState(DEFAULT_PRODUCT_LIST_STATE), "");
    assert.equal(
      serializeProductListState({
        ...DEFAULT_PRODUCT_LIST_STATE,
        q: "reef",
        active: "archived",
        page: 2,
        pageSize: 50,
      }),
      "q=reef&active=false&page=2&pageSize=50",
    );
  });

  it("resets the page when filters change and clamps pagination", () => {
    const state = { ...DEFAULT_PRODUCT_LIST_STATE, page: 4 };
    assert.equal(changeProductFilters(state, { brandId: "brand" }).page, 1);
    assert.equal(changeProductPage(state, 8, 5).page, 5);
    assert.equal(changeProductPage(state, 0, 5).page, 1);
  });
});

describe("product list request behavior", () => {
  it("debounces search and only runs the latest scheduled value", () => {
    const callbacks = new Map<number, () => void>();
    let nextId = 0;
    const values: string[] = [];
    const debouncer = createDebouncer(
      (value: string) => values.push(value),
      350,
      ((callback: () => void) => {
        nextId += 1;
        callbacks.set(nextId, callback);
        return nextId;
      }) as unknown as typeof setTimeout,
      ((id: number) => callbacks.delete(id)) as unknown as typeof clearTimeout,
    );

    debouncer.schedule("max");
    debouncer.schedule("maxspect");
    callbacks.forEach((callback) => callback());
    assert.deepEqual(values, ["maxspect"]);
  });

  it("derives loading, empty, populated and API error states", () => {
    assert.equal(
      deriveProductListViewState({
        loading: true,
        error: false,
        itemCount: 0,
        hasFilters: false,
      }),
      "loading",
    );
    assert.equal(
      deriveProductListViewState({
        loading: false,
        error: false,
        itemCount: 0,
        hasFilters: false,
      }),
      "empty",
    );
    assert.equal(
      deriveProductListViewState({
        loading: false,
        error: false,
        itemCount: 0,
        hasFilters: true,
      }),
      "no-results",
    );
    assert.equal(
      deriveProductListViewState({
        loading: false,
        error: false,
        itemCount: 3,
        hasFilters: true,
      }),
      "populated",
    );
    assert.equal(
      deriveProductListViewState({
        loading: false,
        error: true,
        itemCount: 0,
        hasFilters: false,
      }),
      "error",
    );
  });
});
