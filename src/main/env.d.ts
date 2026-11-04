interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css' {}

declare module '*?asset' {
  /** Absolute path to the file, copied beside the main bundle at build time. */
  const path: string
  export default path
}
