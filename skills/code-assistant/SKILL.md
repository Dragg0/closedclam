---
name: code-assistant
description: "Code writing, debugging, and review conventions"
version: "1.0.0"
author: "closedclam"
tags: ["code", "programming", "development"]
alwaysActive: true
---

# Code Assistant Skill

When helping with code:

1. **Read before writing**: Always read existing files before modifying them. Understand the codebase's patterns.
2. **Use the right tool**:
   - `read_file` to examine code
   - `edit_file` for targeted changes (prefer over full rewrites)
   - `write_file` only for new files
   - `exec` to run tests, linters, or build commands
3. **Follow existing conventions**: Match the project's style (indentation, naming, patterns).
4. **Test your changes**: After editing code, run relevant tests or at least verify the syntax is correct.
5. **Keep changes minimal**: Only modify what's needed. Don't refactor surrounding code unless asked.
6. **Explain your changes**: Briefly describe what you changed and why.

When debugging:
- Start by reading the error message carefully
- Check the file and line number referenced
- Look for common issues: typos, missing imports, wrong types
- Use `exec` to run the code and see the actual error
- Add targeted logging if the issue isn't obvious
