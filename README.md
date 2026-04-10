# skillet

> Universal skills installer for CLI tools

Fetches skills from the [Skills.sh](https://skills.sh) ecosystem and installs them to **Claude Code**, **Qwen Code**, **Gemini CLI**, **Aider**, **OpenAI Codex**, and **Cursor** in one shot. Includes migration between tools, versioned snapshots, and A/B testing.

## Quick Start

```bash
npx skillet find react
npx skillet install react-best-practices
```

Or install globally:

```bash
npm i -g skillet
skillet install web-design-guidelines
skillet list
```

## How It Works

Skills are `.md` files. Each tool reads them from its own `~/.<tool>/skills/` directory. Skillet detects everything on your system and installs to all of them at once.

## Commands

### Core

| Command | Description |
|---------|-------------|
| `skillet agents` | Show detected tools |
| `skillet status` | Skills overview + sync state |
| `skillet find [keyword]` | Search the registry |
| `skillet install <name>` | Install to all detected tools |
| `skillet remove <name>` | Remove a skill |
| `skillet list` | Installed skills per tool |

### Migration

| Command | Description |
|---------|-------------|
| `skillet migrate <from> <to>` | Copy skills between tools |
| `skillet migrate <from> <to> --skill <name>` | Migrate one skill |
| `skillet sync` | Make all tools identical |

### Snapshots

| Command | Description |
|---------|-------------|
| `skillet snapshot [tag]` | Versioned backup of all skills |
| `skillet snapshots` | List saved snapshots |
| `skillet restore <tag>` | Roll back to a snapshot |
| `skillet diff [a] [b]` | Compare two snapshots |

### Misc

| Command | Description |
|---------|-------------|
| `skillet doctor` | Verify skill files exist |
| `skillet browse` | Open skills.sh |

## Examples

```bash
skillet agents
skillet find react
skillet install react-best-practices
skillet install web-design-guidelines --agent claude-code --agent qwen-code
skillet migrate claude-code qwen-code
skillet migrate claude-code gemini-cli --skill react-best-practices
skillet sync
skillet snapshot v1.0.0 --message "baseline"
skillet restore v1.0.0
skillet diff
skillet diff v1.0.0 v1.2.0
skillet doctor
```

## Supported Tools

| Tool | Binary | Skills Directory |
|------|--------|-----------------|
| Claude Code | `claude` | `~/.claude/skills/` |
| Qwen Code | `qwen` | `~/.qwen/skills/` |
| Gemini CLI | `gemini` | `~/.gemini/skills/` |
| Aider | `aider` | `~/.aider/skills/` |
| OpenAI Codex | `codex` | `~/.codex/skills/` |
| Cursor | (GUI) | `~/.cursor/skills/` |
| OpenCode | `opencode` | `~/.opencode/skills/` |
| Kilo | `kilo` | `~/.kilo/skills/` |
| Roo | (ext) | `~/.roo/skills/` |
| Continue | (ext) | `~/.continue/skills/` |

## Skill Sources

Skills come from any GitHub repo with a `skills/` directory:

- **vercel-labs/agent-skills** — Official Vercel skills
- **vercel-labs/skills** — Extended library
- **Any repo** — `skillet install my-skill --repo my-org/my-repo`

## Zero Dependencies

Only Node.js built-in modules. No `node_modules`.

## License

MIT
