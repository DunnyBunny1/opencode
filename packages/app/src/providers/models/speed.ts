export const speeds = ["standard", "fast", "ultrafast"] as const

export function splitSpeed(variant: string | undefined) {
  const match = /^custom-(fast|ultrafast)-(.+)$/.exec(variant ?? "")
  return { speed: match?.[1] ?? "standard", reasoning: match?.[2] ?? variant ?? "default" }
}

export function speedVariant(speed: string, reasoning: string) {
  if (speed !== "standard") return `custom-${speed}-${reasoning}`
  return reasoning === "default" ? undefined : reasoning
}

export function reasoningChoices(variants: string[], speed: string) {
  return ["default", ...variants.filter((variant) => splitSpeed(variant).speed === "standard")].filter((reasoning) => {
    const variant = speedVariant(speed, reasoning)
    return !variant || variants.includes(variant)
  })
}
