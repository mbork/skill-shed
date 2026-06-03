// * Help texts

// ** General
const general_help = `\
skill-shed - manage and deploy agent skills

Usage: skill-shed <command> [options]

Commands:
  init    Initialize a new skill directory
  deploy  Deploy a skill to its target directory
  lint    Lint a skill directory for errors and warnings
  help    Show help for a command

Global config: $SKILL_SHED_CONFIG (default: ~/.skill-shed.env, dotenv format)
  DEFAULT_TARGET_DIRECTORY  Base path for skill deployment (default: ~/.agents/skills/)

Run 'skill-shed help <command>' for detailed usage.`

// ** init
const init_help = `\
Usage: skill-shed init [skill-dir] [deploy-dir] [--comments | --no-comments]

Initialize a new skill directory.

Arguments:
  skill-dir   Path to the skill directory (default: current directory)
  deploy-dir  Override the target deploy directory

Options:
  --comments     Create SKILL.source.md (supports HTML comment stripping)
  --no-comments  Create SKILL.md directly (no comment stripping)
  --help, -h     Show this help message`

// ** deploy
const deploy_help = `\
Usage: skill-shed deploy [skill-dir] [--clean | --workdir | --staged | --ref <ref>]

Deploy a skill to its target directory (configured by TARGET_DIRECTORY in .env).

Arguments:
  skill-dir  Path to the skill directory (default: current directory)

Source options (mutually exclusive; default: --clean):
  --clean        Require clean git repo; deploy working tree
  --workdir      Deploy working tree as-is (no cleanliness check)
  --staged       Deploy git index (no cleanliness check)
  --ref <ref>    Deploy a specific git ref (tag, branch, or commit)

Other options:
  --force, -f  Overwrite modified files in target directory;
               do not abort if previous deployment was interrupted
  --help, -h   Show this help message`

// ** lint
const lint_help = `\
Usage: skill-shed lint [skill-dir] [--clean | --workdir | --staged | --ref <ref>]

Lint a skill directory for errors and warnings.

Arguments:
  skill-dir  Path to the skill directory (default: current directory)

Source options (mutually exclusive; default: --clean):
  --clean        Require clean git repo; lint working tree
  --workdir      Lint working tree as-is (no cleanliness check)
  --staged       Lint git index
  --ref <ref>    Lint a specific git ref (tag, branch, or commit)

Other options:
  --check-urls  Probe every http(s) URL over the network; report non-OK ones as warnings
  --help, -h    Show this help message

Environment:
  SKILL_SHED_URL_TIMEOUT_MS  Per-URL timeout in ms for --check-urls (default: 10000)

Exit codes:
  0  No errors (warnings may be present)
  1  One or more errors found`

// ** help
const help_help = `\
Usage: skill-shed help [command]

Show help for a command. Without a command, shows general usage.

Arguments:
  command  The command to show help for (init, deploy, help)

Options:
  --help, -h  Show this help message`

// * Command registry
const command_help: Record<string, string> = {
	init: init_help,
	deploy: deploy_help,
	lint: lint_help,
	help: help_help,
}

// * help_and_exit
// Print help for `command` (or general help if absent/`help`) and exit.
// Exits 1 if the command is unknown, 0 otherwise.
export function help_and_exit(command: string | undefined): never {
	if (!command || command === 'help') {
		console.log(general_help)
		process.exit(0)
	} else if (command in command_help) {
		console.log(command_help[command])
		process.exit(0)
	} else {
		console.error(`Unknown command: ${command}`)
		console.log(general_help)
		process.exit(1)
	}
}
