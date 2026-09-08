# ACP Chat UI

The production ACP page now uses the project Vite RPC chat service. A
same-origin localhost POST obtains an in-memory capability token; the token is
required for session/history/send/stop/approval operations. No API credentials
are sent to the browser. Restart Vite after updating server-side RPC methods.

The server owns native Agent processes and project-local history. During active
turns the page polls authoritative snapshots every 150ms, otherwise every 1200ms.
Leaving the page stops polling, not the Agent. Reloading lists saved and active
sessions. This first version transfers full snapshots; pagination/delta transport
is future work. Only ask mode is accepted from browser requests.

Send acknowledgements carry a session ID and clear only the submitted draft.
Identical retries reuse a request ID within this service process. IDs are not
durably deduplicated across server restarts. A local-server restart closes its
owned Agent processes; history remains in the project's .vue-devtools folder.

Opt-in browser smoke test (uses real CLI credentials and model quota):

    PLAYWRIGHT_MODULE=/absolute/path/to/playwright pnpm exec tsx packages/acp/tests/ui/live-send.ts OpenCode

The test uses a temporary Vite project, clicks the real UI, sends a message,
and reloads history. It cleans temporary project data and owned processes;
native CLI test histories are retained.

Presentation-only chat components using the existing devtools UI library and
markstream-vue 1.0.1-beta.3. No Node imports, agent startup, filesystem access,
or fake replies are performed by these components.

AcpChat accepts sessions, selectedId, providers, connected, and isDark. Session
records contain display messages, tool activity, pending requests, and options.
The component keeps only transient per-session drafts and navigation state.
Messages and options for existing sessions remain controlled by the caller.

Events: selectSession, newChat, send, stop, changeOptions, permission, answer.
Each operation on an existing conversation carries its session ID. A null
selected session is an unsaved draft. New chat does not create storage records
or stop another session. The parent must apply confirmed option changes and
provide optionsPending/optionsError for asynchronous or restart-required changes.
Only the six implemented providers are presented in the selector, including the isolated Codex CLI.

Provider models and reasoningEfforts come from capability data, not the UI.
Missing data disables the corresponding controls. Existing conversation agent
selection is locked once messages exist. Stream updates must retain message IDs
and append to content; mark streaming=false when finalized. No private reasoning
is rendered. HTML is escaped and remote Markdown images are disabled.

The production route starts disconnected with no sessions. Preview fixtures are
outside src and are never imported by the production route:

    pnpm exec vitest run --config packages/acp/tests/ui/vitest.config.ts
    pnpm exec vue-tsc --noEmit -p packages/acp/tests/ui/tsconfig.json
    pnpm --filter @vue/devtools-acp dev:ui

With the ACP preview server running, /tests/ui/preview.html shows fixtures;
?empty shows the production empty state and ?long exercises scroll behavior.
The sidebar is a flat 220px list; below 640px of container width it becomes a
focus-trapped, container-local drawer. Dark mode follows the DevTools theme.
