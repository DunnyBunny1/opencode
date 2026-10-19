import { expect, test } from "bun:test"
import { normalizeStatus, parsePullRequest, shouldAutoUpdate } from "./index"

test("workflow maps legacy states and accepts only verified pull request states", () => {
  expect(normalizeStatus("in-progress")).toBe("implementation")
  expect(normalizeStatus("done")).toBe("qa")
  expect(normalizeStatus("ready")).toBe("qa")
  expect(normalizeStatus("unclassified")).toBeUndefined()
  expect(normalizeStatus("planning")).toBe("planning")
  expect(parsePullRequest('[{"number":42,"state":"MERGED","mergedAt":"2026-10-19T12:00:00Z"}]')).toEqual([
    { number: 42, state: "MERGED", mergedAt: "2026-10-19T12:00:00Z" },
  ])
  expect(parsePullRequest('[{"number":7,"state":"OPEN","mergedAt":null}]')).toEqual([
    { number: 7, state: "OPEN", mergedAt: undefined },
  ])
  expect(parsePullRequest('[{"number":"42","state":"MERGED"}]')).toEqual([])
  expect(shouldAutoUpdate(undefined)).toBe(true)
  expect(shouldAutoUpdate("planning")).toBe(true)
  expect(shouldAutoUpdate("qa")).toBe(true)
  expect(shouldAutoUpdate("idea")).toBe(false)
  expect(shouldAutoUpdate("blocked")).toBe(false)
  expect(shouldAutoUpdate("shelved")).toBe(false)
  expect(shouldAutoUpdate("merged")).toBe(false)
})
