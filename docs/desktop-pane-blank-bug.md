# Claude Desktop: closing a maximized plugin pane leaves a blank window

**App:** Claude Desktop, Code tab, Claude Code engine 2.1.317, macOS.

**Steps**
1. Open any mod/plugin pane (e.g. `$.ui.open({ id, title })`).
2. (Optional) maximize the pane.
3. Close the pane with its close (X) button.

**Expected:** the chat transcript comes back.
**Actual:** the content area stays blank. The chat only returns after pressing the minimize/restore toggle.

**Notes**
- The plugin API has no concept of maximize (`Pane` props: `placement: 'dock' | 'inline'`, `bodyColumns`, `scroll`, `view`), so a plugin can't restore the layout itself.
- Closing goes through `ui.close` (origin `person`); the plugin calls `next(e)` and doesn't keep the pane open.
- Happens whether or not the pane was maximized. Minimizing the pane instead returns to the chat correctly.
- The plugin API offers no minimize call (`$.ui` has open, close, focus, place, scroll), so a plugin can't route around it.
