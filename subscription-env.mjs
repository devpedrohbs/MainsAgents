/**
 * Subscription-only environment for the Claude Code and Codex CLIs launched by MainsAgents: variables that would make a CLI
 * bill a paid API (an API key, a third-party cloud provider, or a custom endpoint) are removed, so it can only use the
 * account the person signed in with (`claude auth login` / `codex login` with ChatGPT). Applied to the final spawn env.
 */
export const PAID_API_VARIABLES=Object.freeze([
 'ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY',
 'AWS_BEARER_TOKEN_BEDROCK','ANTHROPIC_VERTEX_PROJECT_ID','ANTHROPIC_FOUNDRY_API_KEY',
 'OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','AZURE_OPENAI_API_KEY',
]);
export function subscriptionOnlyEnv(env){
 const out={...env};
 // Windows env names are case-insensitive: remove every casing.
 for(const key of Object.keys(out))if(PAID_API_VARIABLES.includes(key.toUpperCase()))delete out[key];
 return out;
}
