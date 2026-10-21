// Running a menu item's action against the window that was focused when
// the menu was opened.
//
// Action types:
//   {"type": "keys",    "keys": "ctrl+shift+p"}
//   {"type": "text",    "text": "Format Document"}
//   {"type": "macro",   "steps": [<keys|text action>, {"type": "delay", "ms": 100}, ...]}
//   {"type": "dbus",    "app": "org.gnome.Nautilus", "name": "preferences", "path": "/optional"}
//   {"type": "command", "argv": ["google-chrome", "chrome://settings"]}
//   {"type": "window",  "op": "minimize" | "maximize" | "fullscreen" | "close"}

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Waiting for the popup menu to close and the target window to take
// keyboard focus back before we type into it (see _refocus).
const REFOCUS_TIMEOUT_MS = 3000;
const POLL_MS = 20;
const SETTLE_MS = 100;
const KEY_GAP_MS = 15;

const MODIFIERS = {
    ctrl: Clutter.KEY_Control_L,
    control: Clutter.KEY_Control_L,
    shift: Clutter.KEY_Shift_L,
    alt: Clutter.KEY_Alt_L,
    super: Clutter.KEY_Super_L,
};

const KEY_ALIASES = {
    comma: ',', period: '.', slash: '/', minus: '-', plus: '+', equal: '=',
    space: ' ', enter: 'Return', esc: 'Escape', del: 'Delete',
};

function keyvalFor(name) {
    const key = KEY_ALIASES[name.toLowerCase()] ?? name;
    if ([...key].length === 1)
        return Clutter.unicode_to_keysym(key.codePointAt(0));
    const keyval = Clutter[`KEY_${key}`];
    if (keyval === undefined)
        throw new Error(`unknown key "${name}"`);
    return keyval;
}

function parseCombo(combo) {
    const parts = combo.split('+').map(p => p.trim()).filter(p => p);
    const key = parts.pop();
    const modifiers = parts.map(m => {
        const keyval = MODIFIERS[m.toLowerCase()];
        if (keyval === undefined)
            throw new Error(`unknown modifier "${m}"`);
        return keyval;
    });
    return {modifiers, keyval: keyvalFor(key)};
}

function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

export class ActionRunner {
    constructor() {
        const seat = Clutter.get_default_backend().get_default_seat();
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    destroy() {
        this._keyboard = null;
    }

    // Actions run one at a time: a second item clicked while the first is
    // still waiting for focus would otherwise interleave its keys with the
    // first one's (a pending Ctrl+A landing in the middle of typed text).
    run(action, window) {
        this._queue = (this._queue ?? Promise.resolve()).then(async () => {
            try {
                await this._run(action, window, true);
            } catch (e) {
                console.error(`[soffit] action ${JSON.stringify(action)} failed: ${e.message}`);
            }
        });
        return this._queue;
    }

    async _run(action, window, refocus) {
        switch (action.type) {
        case 'keys':
        case 'text':
            if (refocus)
                await this._refocus(window);
            if (action.type === 'keys') {
                // "ctrl+k ctrl+o" is a chord: combos separated by spaces.
                for (const combo of action.keys.split(/\s+/).filter(c => c)) {
                    await this._sendCombo(parseCombo(combo));
                }
            } else {
                await this._sendText(action.text);
            }
            break;
        case 'macro':
            if (refocus)
                await this._refocus(window);
            for (const step of action.steps) {
                if (step.type === 'delay')
                    await sleep(step.ms ?? 100);
                else
                    await this._run(step, window, false);
            }
            break;
        case 'dbus':
            this._activateGAction(action);
            break;
        case 'command':
            Gio.Subprocess.new(action.argv, Gio.SubprocessFlags.NONE);
            break;
        case 'window':
            this._windowOp(action.op, window);
            break;
        default:
            throw new Error(`unknown action type "${action.type}"`);
        }
    }

    // Keys sent while the shell holds a modal grab (our closing menu, or any
    // system dialog) never reach the app, so wait until nothing is modal and
    // the window has focus again, and refuse to type if that never happens.
    async _refocus(window) {
        for (let waited = 0; ; waited += POLL_MS) {
            if (window && !window.has_focus())
                Main.activateWindow(window);
            if (Main.modalCount === 0 && (!window || window.has_focus()))
                break;
            if (waited >= REFOCUS_TIMEOUT_MS)
                throw new Error(`shell still modal (${Main.modalCount}) or window unfocused after ${waited}ms; not typing blind`);
            await sleep(POLL_MS);
        }
        await sleep(SETTLE_MS);
    }

    _key(keyval, state) {
        this._keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, state);
    }

    async _sendCombo({modifiers, keyval}) {
        for (const m of modifiers)
            this._key(m, Clutter.KeyState.PRESSED);
        this._key(keyval, Clutter.KeyState.PRESSED);
        this._key(keyval, Clutter.KeyState.RELEASED);
        for (const m of [...modifiers].reverse())
            this._key(m, Clutter.KeyState.RELEASED);
        await sleep(KEY_GAP_MS);
    }

    async _sendText(text) {
        for (const ch of text) {
            const keyval = Clutter.unicode_to_keysym(ch.codePointAt(0));
            this._key(keyval, Clutter.KeyState.PRESSED);
            this._key(keyval, Clutter.KeyState.RELEASED);
            await sleep(KEY_GAP_MS);
        }
    }

    // GtkApplication exports its actions on the session bus even when it
    // exports no menu (e.g. Nautilus: preferences, about, new-window...).
    _activateGAction({app, name, path}) {
        const objectPath = path ?? `/${app.replace(/\./g, '/')}`;
        Gio.DBus.session.call(
            app, objectPath, 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', [name, [], {}]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    console.error(`[soffit] dbus action ${app} ${name}: ${e.message}`);
                }
            });
    }

    _windowOp(op, window) {
        if (!window)
            return;
        const time = global.get_current_time();
        switch (op) {
        case 'minimize':
            window.minimize();
            break;
        case 'maximize':
            if (window.is_maximized())
                window.unmaximize();
            else
                window.maximize();
            break;
        case 'fullscreen':
            if (window.is_fullscreen())
                window.unmake_fullscreen();
            else
                window.make_fullscreen();
            break;
        case 'close':
            window.delete(time);
            break;
        default:
            throw new Error(`unknown window op "${op}"`);
        }
    }
}
