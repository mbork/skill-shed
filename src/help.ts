// * Help texts

// ** General
const general_help = `\
skill-shed - manage and deploy agent skills

Usage: skill-shed <command> [options]

Commands:
  init    Initialize a new skill directory
  deploy  Deploy a skill to its target directory
  help    Show help for a command

Global config: ~/.skill-shed.env (dotenv format)
  DEFAULT_TARGET_DIRECTORY  Base path for skill deployment (default: ~/.claude/skills/)

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
Usage: skill-shed deploy [skill-dir]

Deploy a skill to its target directory (configured by TARGET_DIRECTORY in .env).

Arguments:
  skill-dir  Path to the skill directory (default: current directory)

Options:
  --help, -h  Show this help message`

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
	help: help_help,
}

// * Exports

export function print_general_help(): void {
	console.log(general_help)
}

export function print_command_help(command: string): void {
	const help = command_help[command]
	if (help) {
		console.log(help)
	} else {
		console.error(`Unknown command: ${command}`)
		console.log(general_help)
	}
}

export function is_known_command(command: string): boolean {
	return command in command_help
}

/** Print help for `command` (or general help if absent/`help`) and exit.
 *  Exits 1 if the command is unknown, 0 otherwise. */
export function help_and_exit(command: string | undefined): never {
	if (!command || command === 'help') {
		print_general_help()
		process.exit(0)
	} else if (is_known_command(command)) {
		print_command_help(command)
		process.exit(0)
	} else {
		console.error(`Unknown command: ${command}`)
		print_general_help()
		process.exit(1)
	}
}
