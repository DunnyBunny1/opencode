import { For, Show } from "solid-js"
import { useData, useServer } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { useLanguage } from "@/runtime/i18n/language"
import { speeds, speedVariant, splitSpeed } from "@/providers/models/speed"
import type { ComposerModel } from "./model"

export function ComposerPreferences(props: { model: ComposerModel["model"]["selection"] }) {
  const language = useLanguage()
  const settings = useSettings()
  const location = useWorkspaceLocation()
  const data = useData()
  const server = useServer()
  const project = () => projectSettingsKey(server.ctx.sdk.scope, data.location.info(location().ref)?.project.id)
  const current = () => splitSpeed(props.model.variant.current())
  const available = () =>
    speeds.filter((speed) => {
      const variant = speedVariant(speed, current().reasoning)
      return !variant || props.model.variant.list().includes(variant)
    })

  return (
    <div class="flex items-center gap-3 px-2 text-xs text-v2-text-text-muted">
      <Show when={available().length > 1}>
        <label class="flex items-center gap-1.5">
          {language.t("composer.speed")}
          <select
            class="bg-transparent"
            aria-label={language.t("composer.speed")}
            value={current().speed}
            onChange={(event) => props.model.variant.set(speedVariant(event.currentTarget.value, current().reasoning))}
          >
            <For each={available()}>
              {(speed) => <option value={speed}>{language.t(`composer.speed.${speed}`)}</option>}
            </For>
          </select>
        </label>
      </Show>
      <label class="flex items-center gap-1.5" title={language.t("composer.approvals.help")}>
        <select
          class="bg-transparent"
          aria-label={language.t("composer.approvals")}
          disabled={!project()}
          value={settings.permissions.autoApproves(project()) ? "auto" : "ask"}
          onChange={(event) => {
            const key = project()
            const auto = event.currentTarget.value === "auto"
            if (key) settings.permissions.setAutoApproveOverride(key, auto)
            else settings.permissions.setAutoApproveDefault(auto)
          }}
        >
          <option value="ask">{language.t("composer.approvals.ask")}</option>
          <option value="auto">{language.t("composer.approvals.auto")}</option>
        </select>
      </label>
    </div>
  )
}
