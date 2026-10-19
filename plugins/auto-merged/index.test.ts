import { expect, test } from "bun:test"
import { parseMergedPullRequests, shouldMarkMerged } from "./index"

test("auto-merge only accepts a verified merged PR and preserves deliberate classifications", () => {
  expect(parseMergedPullRequests('[{"number":42,"mergedAt":"2026-10-19T12:00:00Z"}]')).toEqual([
    { number: 42, mergedAt: "2026-10-19T12:00:00Z" },
  ])
  expect(parseMergedPullRequests("[]")).toEqual([])
  expect(parseMergedPullRequests('[{"number":"42","mergedAt":null}]')).toEqual([])
  expect(shouldMarkMerged(undefined)).toBe(true)
  expect(shouldMarkMerged("in-progress")).toBe(true)
  expect(shouldMarkMerged("done")).toBe(true)
  expect(shouldMarkMerged("idea")).toBe(false)
  expect(shouldMarkMerged("blocked")).toBe(false)
  expect(shouldMarkMerged("shelved")).toBe(false)
  expect(shouldMarkMerged("merged")).toBe(false)
})
