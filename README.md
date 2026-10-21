# Soffit

A macOS-style global menu bar for GNOME Shell.

> **Personal project.** Built for my own Debian + GNOME desktop, shared as-is.
> It is a proof of concept: expect rough edges, and no support or stability
> guarantees.

Instead of reading menus out of each application (which most Linux apps
don't export, especially GTK4 and Wayland-native ones), Soffit keeps a
**static menu definition per app** in `menus/*.json` and runs each item
through a small set of action types: simulated shortcuts, GTK D-Bus actions,
commands and window operations.

## How it works

1. Watches the focused window and resolves it to an app (`.desktop` id and
   window class).
2. Picks the matching definition from `menus/`.
3. Renders the top bar like macOS: the app name in bold, the app's menus,
   and a built-in **Window** menu. Apps without a definition still get the
   app and Window menus.
4. When an item is clicked, the menu closes, focus goes back to the app
   and the action runs.

## Menu definition format

```json
{
  "name": "Files",
  "match": {"appId": ["org.gnome.Nautilus.desktop"], "wmClass": ["org.gnome.Nautilus"]},
  "menus": [
    {
      "label": "File",
      "items": [
        {"label": "New Folder", "shortcut": "Ctrl+Shift+N", "action": {"type": "keys", "keys": "ctrl+shift+n"}},
        {"separator": true},
        {"label": "Preferences", "action": {"type": "dbus", "app": "org.gnome.Nautilus", "name": "preferences"}}
      ]
    }
  ]
}
```

`shortcut` is only the text shown in the menu; `action` is what runs.
An item with `items` instead of `action` becomes a submenu.

| Action | Example | Notes |
|---|---|---|
| `keys` | `{"type": "keys", "keys": "ctrl+shift+p"}` | Space-separated combos make a chord: `"ctrl+k ctrl+o"`. |
| `text` | `{"type": "text", "text": "hello"}` | Types the text into the app. |
| `macro` | `{"type": "macro", "steps": [...]}` | Steps are `keys`, `text` or `{"type": "delay", "ms": 200}`. |
| `dbus` | `{"type": "dbus", "app": "org.gnome.Nautilus", "name": "preferences"}` | Activates a GtkApplication action. List them with `gdbus call --session --dest org.gnome.Nautilus --object-path /org/gnome/Nautilus --method org.gtk.Actions.List`. |
| `command` | `{"type": "command", "argv": ["google-chrome", "chrome://settings"]}` | Runs a program. |
| `window` | `{"type": "window", "op": "minimize"}` | `minimize`, `maximize`, `fullscreen`, `close`. |

Key names: single characters (`a`, `,`), aliases (`comma`, `enter`, `esc`,
`space`...) or any Clutter keysym name (`Return`, `F5`, `Delete`...).
Modifiers: `ctrl`, `shift`, `alt`, `super`.

## Install

Requires GNOME Shell 48.

```sh
./install.sh            # symlinks into ~/.local/share/gnome-shell/extensions and enables it
```

On Wayland the shell only picks up new extensions at login, so log out and
back in once. After that, editing a JSON file only needs the extension to be
toggled off and on again (`gnome-extensions disable/enable
soffit@e3duardo.github.io`).

Logs:

```sh
journalctl -f -o cat /usr/bin/gnome-shell | grep soffit
```

Every focus change prints the detected app id, window class and which
definition matched, which is what you need to write a new `menus/*.json`.

### Testing without touching your session

```sh
dbus-run-session -- gnome-shell --nested --wayland
```

opens a GNOME Shell inside a window; a broken extension only affects that
window.

### Automated smoke test

```sh
tests/run-smoke.sh
```

Starts a headless GNOME Shell isolated from your session (its own D-Bus,
dconf and extension dir), opens GNOME Text Editor and drives Soffit's real
menus: checks the bar, types text, runs a macro and minimizes the window
through the Window menu. Prints `PASS`/`FAIL` lines.

## Hiding the apps' own menus

Soffit doesn't remove menus from inside the apps. Per app:

- **VS Code:** `"window.menuBarVisibility": "hidden"` in settings.
- **Firefox:** the menu bar is already hidden (Alt shows it).
- **LibreOffice:** View → uncheck Menubar.
- **Chrome, GNOME apps:** no menu bar to hide.

## Proof-of-concept checklist

- [ ] The bar follows the focused app (VS Code, Files, Chrome, others).
- [ ] `keys`: shortcuts reach the app after the menu closes.
- [ ] `macro`: VS Code → Edit → Format Document.
- [ ] `dbus`: Files → File → Preferences.
- [ ] `command`: Chrome → Window → Settings.
- [ ] `window`: Window → Minimize / Zoom / Close.
- [ ] Shortcuts with symbols (`ctrl+comma`) work on an ABNT2 keyboard.

## Ideas for later

- Read real menus over D-Bus (`com.canonical.dbusmenu`, `org.gtk.Menus`)
  when an app exports them, with the JSON overriding or completing them.
- macOS look, measured side by side with a real Mac.
- AT-SPI as a last resort for items with no shortcut or API.

## License

MIT
