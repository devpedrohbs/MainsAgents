# Codex executor isolation — 0.3.60

The desktop app inherited Codex Desktop environment variables when launched by a Codex task. This selected the host app binary and its internal runtime paths, causing Windows sandbox setup to fail while validating a locked `node_repl.exe` (OS error 32), before any user command executed.

The standalone runtime now removes inherited Codex execution transports and session/permission metadata, preserving shared authentication, system tool paths, and its own explicit history directories. An inherited Desktop CLI override is dropped; ordinary user CLI overrides remain supported. `MAINSAGENTS_CODEX_CLI_PATH` is the explicit app-specific override. No sandbox restrictions are disabled or widened.

Validation: environment isolation and runtime history tests passed; a real CLI command using the existing MainsAgents runtime successfully created/read/removed a scratch file in the configured video output folder. A real FFmpeg synthetic cut was verified, while writing outside the permitted folder remained blocked. Neither probe uses model inference or modifies user videos.

Restart the desktop app to replace an already-running executor. Existing chats, credentials, agents, skills, approvals, and edited files are retained.
