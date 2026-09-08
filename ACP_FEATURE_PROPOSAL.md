# Feature request: ACP-powered agent panel with Vue runtime context

Hi maintainers! Following the contribution guide, I'd like to discuss a feature direction before preparing a pull request.

Would you be open to an optional agent panel in Vue DevTools, using the Agent Client Protocol (ACP) to connect to a locally installed coding agent and attach explicitly selected Vue runtime context through an @ mention picker? The shared prototype already supports selecting Vue component instances through @ mentions or the page inspector, highlighting them, and attaching bounded runtime context to a message. I'd like to discuss that existing workflow and potentially extend it to Pinia stores and Vue Router context, while aligning on product fit, scope, and architecture before taking it further.

## Prototype preview and source

![Vue DevTools agent panel prototype showing project conversations, the agent selector, and message composer](https://raw.githubusercontent.com/CoutinhoTTS/vue-devtools/codex/acp-agent-prototype/packages/acp/docs/acp-panel.png)

The screenshot shows the current new-conversation UI, including the conversation sidebar, agent selector, and composer controls. It is a work-in-progress preview, not a final design or evidence of equal capability across all listed agents.

![Implemented @ component picker with a Home instance highlighted in the running Vue application](https://raw.githubusercontent.com/CoutinhoTTS/vue-devtools/codex/acp-agent-prototype/packages/acp/docs/acp-component-picker.png)

The component-selection screenshot shows functionality already implemented in this branch: the @ candidate list identifies component instances, and the Home candidate is highlighted in the running page. The conversation also contains a previously submitted ElTable component reference. Pinia and Router context selection are not implemented yet.

- [Prototype branch](https://github.com/CoutinhoTTS/vue-devtools/tree/codex/acp-agent-prototype)
- [Prototype changes](https://github.com/CoutinhoTTS/vue-devtools/compare/main...codex/acp-agent-prototype)
- [Implementation notes and local verification commands](https://github.com/CoutinhoTTS/vue-devtools/blob/codex/acp-agent-prototype/packages/acp/README.md)

This branch is shared for discussion and may continue to evolve. It is not a request to merge the prototype as-is.

## Motivation and workflow

When debugging a running Vue application with a coding agent, I often need to move between DevTools and an editor or terminal, identify the relevant component, and manually explain its current runtime state. Source files alone do not capture the state of the particular component instance being inspected.

The workflow I'd like to explore is:

1. Select a component in the running application, or find it through a component mention in DevTools.
2. Attach that specific instance's source location and a bounded snapshot of its current props/data/setup state to a question.
3. Ask something like "Why is this table still showing the previous page after the filter changes?" in a DevTools panel.
4. Follow the agent's response, tool activity, and approval requests without leaving the debugging context.

The value is connecting the inspected application's runtime entities to an agent conversation, rather than adding a general-purpose chatbot to DevTools.

## @ context selection: implemented and planned

### Already implemented in this branch

- Typing @ opens searchable component candidates alongside workspace file/directory references.
- Component candidates identify actual instances, with names, parent paths, and instance identifiers to distinguish repeated components. Browsing a candidate can highlight the corresponding component in the page.
- Users can select a component from the candidate list or pick it directly from the running page. The selection becomes a removable component reference in the composer, not just its name as plain text.
- When the message is sent, the selected instances are revalidated and bounded snapshots are captured, including component identity, source location when available, and summarized props/data/setup state. The current limit is three component references per message; this is not an unrestricted dump of component data.
- Workspace references attach paths, not file contents automatically.

Component selection, highlighting, and context attachment are implemented prototype features. Fine-grained field selection and a preview of the exact payload are proposed refinements, not existing guarantees.

### Proposed extensions, not yet implemented

The same @ interaction could offer additional groups of runtime entities available in the connected Vue application:

- **Pinia stores:** select a store by its store ID and owning application, then explicitly choose state fields to attach. Getter values would only be considered if they can be inspected safely without triggering evaluation.
- **Router context:** select the active route or a registered route, with its name, path, matched records, and explicitly selected params/query/meta fields where applicable. Selecting a RouterLink or RouterView component today is a component reference, not this proposed route-context integration.

For example, a user could select the UserTable component, the users Pinia store, and the current route, then ask: "The URL now points to page 2, but this table still shows page 1. How do these selected states relate?" This would give the agent an explicit set of observations for reasoning across component, store, and route state without assuming that a dependency relationship has already been established.

The proposed interaction would show each selection as a removable, typed reference in the composer, with an inspectable preview of the fields to be shared. At send time, DevTools would revalidate the selected entities and capture a bounded, timestamped snapshot of the approved fields. Reloaded, unmounted, removed, or otherwise stale references would require reselection rather than silently resolving to a different entity. Multiple Vue apps would be distinguished by application identity; unavailable Pinia or Router integrations would be reported as unavailable, not represented by fabricated data.

Selecting a reference would be read-only: it would not call Pinia actions, mutate state, execute getters, or trigger router navigation. Full store dumps, query values, and route metadata would not be sent automatically. Context preview, field selection, redaction, and size limits would be part of the design discussion. Captures across different entities should not be presented as an atomic application snapshot.

This is a proposed extension of the existing component/file mention workflow, not a claim that Pinia and Router mentions already work in the shared branch. Components could remain the initial deliverable, with other context providers added incrementally if maintainers support the direction.

## Relationship to existing MCP work

I found [#821](https://github.com/vuejs/devtools/issues/821) and the recommendation for [vite-plugin-vue-mcp](https://github.com/webfansplz/vite-plugin-vue-mcp). That project already exposes Vue runtime information and debugging tools to external AI clients.

This proposal focuses on a complementary interaction model: DevTools hosts the conversation and the user selects runtime context directly in the browser. ACP would handle the client/agent session; MCP can provide tools and context to agents. They are different responsibilities, not competing replacements.

I'd welcome guidance on reusing or integrating with the existing MCP work. The current prototype attaches explicit component snapshots; it does not yet forward MCP tools to agents.

## Current prototype

The shared branch currently implements:

- A DevTools agent panel connected to a project-scoped Node service through the Vite integration.
- Component selection through @ mentions or page picking, instance highlighting, and bounded runtime snapshots captured when a message is sent.
- Project-local conversation history and native agent session restoration.
- Response display, tool activity, cancellation, permission prompts, and user questions where supported by the agent.
- Workspace file mentions and agent-reported command completion.

The prototype separates browser UI, shared contracts, and Node-side agent drivers in a private workspace package. It includes fixture-based Node/UI tests, but is not a merge-ready implementation or a claim of cross-platform compatibility.

Local checks also exposed inconsistent test results around history timestamps and persistence-error propagation. These remain prototype limitations to investigate before an upstream PR; validation details are recorded in the implementation notes linked above.

I also explored several agent integrations. Some use ACP; others use their own native protocols. I would not propose treating all of them as ACP-compatible or requiring those adapters in an initial contribution.

## Suggested initial scope

For a first contribution, I would suggest an explicitly enabled, experimental Vite-only integration with one ACP-compatible agent, basic conversation/cancellation/approval handling, and user-selected component context. The exact agent and packaging can follow maintainer preferences.

Pinia and Router context providers, additional native-protocol adapters, broader command support, advanced session management, and browser-extension/standalone support could stay outside the initial scope. Autonomous editing workflows would need a separate discussion; an "ask" mode label alone is not a security boundary.

Important requirements to agree on before upstreaming:

- No agent process startup or model calls merely from opening DevTools; users explicitly opt in and initiate the workflow.
- Keep CLI credentials on the server side and do not collect model API keys in the DevTools browser UI.
- Limit access to the trusted local development project, authenticate browser-to-service operations, and review process lifetime and permission handling.
- Make context sharing explicit, bounded, and reviewable. Sensitive-field redaction is only a heuristic and cannot guarantee that application state is free of secrets.
- Explain that a locally running agent may send prompts, source code, and attached state to its configured model provider. Local session storage does not imply local-only inference.
- Keep optional dependencies and runtime cost out of the normal DevTools path when the integration is disabled.

These are proposed upstream requirements, not guarantees that every part of the prototype already satisfies.

## Feedback requested

1. Is this in-DevTools agent workflow a direction you would consider supporting?
2. Would you prefer it as an optional built-in integration, a DevTools plugin, or a separate companion package?
3. Should an initial contribution focus strictly on ACP and build on the existing Vue MCP work for runtime access?
4. Would a unified @ picker for components, Pinia stores, and Router context fit the DevTools experience, with component references delivered first?
5. What minimum scope, security expectations, and validation would you want before reviewing a PR?

If this direction is welcome, I'm happy to continue iterating on the prototype based on your feedback, narrow or restructure the implementation, add the required tests and documentation, and prepare small, reviewable PRs when it is ready. At this stage, I'm asking for feedback on the direction rather than approval to merge the current prototype.
