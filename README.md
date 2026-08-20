# omp-system-reminder

Inject a configurable high-priority reminder before every Oh My Pi model call, including continuation calls after tool results.

OMP receives the reminder as a `developer` message and translates it to the provider's high-priority instruction representation. The XML wrapper itself is only a label:

```xml
<system-reminder>
Your instruction
</system-reminder>
```

## Install

```bash
omp plugin install github:byigitt/omp-system-reminder
```

Restart OMP after installation. Requires OMP 17.2.12 or newer.

## Persistent configuration

Open the multiline editor:

```text
/system-reminder
```

The edited text is saved immediately, enabled, and loaded automatically in future sessions. The explicit form is equivalent:

```text
/system-reminder edit
```

Enable or disable it persistently without losing the text:

```text
/system-reminder off
/system-reminder on
```

Inspect or reload the active configuration:

```text
/system-reminder show
/system-reminder reload
```

Inline text is also saved and enabled:

```text
/system-reminder Be concise. Lead with the result and skip narration.
```

Configuration is global by default. Add `project` to keep a setting under the current repository:

```text
/system-reminder edit project
/system-reminder off project
/system-reminder on project
```

Project configuration takes precedence over global configuration.

## Automatic writing-style presets

List the built-in presets:

```text
/system-reminder presets
```

Select one persistently:

```text
/system-reminder preset plain-language
/system-reminder preset tldr
/system-reminder preset explain-like-five
```

Add `project` to scope the selection to the current repository:

```text
/system-reminder preset plain-language project
```

`plain-language` follows the same goal as [claudish-to-english](https://github.com/gvzdv/claudish-to-english): simple language, short sentences, preserved facts and technical identifiers, unchanged code blocks, and no canned preamble. This extension applies the style as a high-priority generation instruction; it does not run a second local model or rewrite the displayed answer after generation.

## Other configuration methods

Command-line flag:

```bash
omp --system-reminder "Be concise. Skip preamble and narration."
```

Environment variable:

```bash
OMP_SYSTEM_REMINDER="Be concise. Skip preamble and narration." omp
```

Persistent state is stored as JSON:

```text
<cwd>/.omp/SYSTEM_REMINDER.json
~/.omp/agent/SYSTEM_REMINDER.json
```

Precedence, highest first:

1. `--system-reminder`
2. `OMP_SYSTEM_REMINDER`
3. `<cwd>/.omp/SYSTEM_REMINDER.json`
4. The active user agent directory's `SYSTEM_REMINDER.json`

## Development

```bash
bun test
```

## License

MIT
