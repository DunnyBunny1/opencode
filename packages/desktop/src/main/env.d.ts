interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
  readonly OPENCODE_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
interface ImportMetaEnv {
  readonly OPENCODE_CUSTOM: boolean
}
