# Feature request: ACP-powered agent panel with Vue component context

Hi maintainers! Following the contribution guide, I'd like to discuss a feature direction before preparing a pull request.

Would you be open to an optional agent panel in Vue DevTools, using the Agent Client Protocol (ACP) to connect to a locally installed coding agent and attach explicitly selected Vue component context? I have a prototype, but would like to align on product fit, scope, and architecture before taking it further.

## Prototype preview and source

![Vue DevTools agent panel prototype showing project conversations, the agent selector, and message composer](https://raw.githubusercontent.com/CoutinhoTTS/vue-devtools/codex/acp-agent-prototype/packages/acp/docs/acp-panel.png)

The screenshot shows the current new-conversation UI, including the conversation sidebar, agent selector, and composer controls. It is a work-in-progress preview, not a final design or evidence of equal capability across all listed agents.

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

The value is connecting the inspected component instance to an agent conversation, rather than adding a general-purpose chatbot to DevTools.

## Relationship to existing MCP work

I found [#821](https://github.com/vuejs/devtools/issues/821) and the recommendation for [vite-plugin-vue-mcp](https://github.com/webfansplz/vite-plugin-vue-mcp). That project already exposes Vue runtime information and debugging tools to external AI clients.

This proposal focuses on a complementary interaction model: DevTools hosts the conversation and the user selects runtime context directly in the browser. ACP would handle the client/agent session; MCP can provide tools and context to agents. They are different responsibilities, not competing replacements.

I'd welcome guidance on reusing or integrating with the existing MCP work. The current prototype attaches explicit component snapshots; it does not yet forward MCP tools to agents.

## Current prototype

The prototype implementation explores:

- A DevTools agent panel connected to a project-scoped Node service through the Vite integration.
- Component picking, search/mentions, highlighting, and bounded runtime snapshots captured when a message is sent.
- Project-local conversation history and native agent session restoration.
- Response display, tool activity, cancellation, permission prompts, and user questions where supported by the agent.
- Workspace file mentions and agent-reported command completion.

The prototype separates browser UI, shared contracts, and Node-side agent drivers in a private workspace package. It includes fixture-based Node/UI tests, but is not a merge-ready implementation or a claim of cross-platform compatibility.

Local checks also exposed inconsistent test results around history timestamps and persistence-error propagation. These remain prototype limitations to investigate before an upstream PR; validation details are recorded in the implementation notes linked above.

I also explored several agent integrations. Some use ACP; others use their own native protocols. I would not propose treating all of them as ACP-compatible or requiring those adapters in an initial contribution.

## Suggested initial scope

For a first contribution, I would suggest an explicitly enabled, experimental Vite-only integration with one ACP-compatible agent, basic conversation/cancellation/approval handling, and user-selected component context. The exact agent and packaging can follow maintainer preferences.

Additional native-protocol adapters, broader command support, advanced session management, and browser-extension/standalone support could stay outside the initial scope. Autonomous editing workflows would need a separate discussion; an "ask" mode label alone is not a security boundary.

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
4. What minimum scope, security expectations, and validation would you want before reviewing a PR?

If this direction is welcome, I'm happy to continue iterating on the prototype based on your feedback, narrow or restructure the implementation, add the required tests and documentation, and prepare small, reviewable PRs when it is ready. At this stage, I'm asking for feedback on the direction rather than approval to merge the current prototype.
