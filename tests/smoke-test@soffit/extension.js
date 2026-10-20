// Smoke test for Soffit, loaded only inside the throwaway headless shell
// started by tests/run-smoke.sh. Drives the real menus: opens a menu,
// activates an item and checks the effect on a GNOME Text Editor window.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SOFFIT = 'soffit@e3duardo.github.io';
const EDITOR_CLASS = 'org.gnome.TextEditor';

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function waitFor(what, fn, timeoutMs = 15000) {
    for (let waited = 0; waited < timeoutMs; waited += 200) {
        const value = fn();
        if (value)
            return value;
        await sleep(200);
    }
    throw new Error(`timed out waiting for ${what}`);
}

function check(name, ok, detail = '') {
    console.log(`[soffit-test] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

async function clickItem(soffit, menuLabel, itemLabel) {
    const button = soffit._buttons.find(b => b.menu._getMenuItems().length &&
        b.get_first_child()?.text === menuLabel);
    if (!button)
        throw new Error(`no "${menuLabel}" menu`);
    button.menu.open();
    await sleep(300);
    const item = button.menu._getMenuItems().find(i => i.label?.text === itemLabel);
    if (!item)
        throw new Error(`no "${itemLabel}" item in "${menuLabel}"`);
    item.activate(Clutter.get_current_event());
}

export default class SmokeTest extends Extension {
    enable() {
        this._run()
            .catch(e => console.log(`[soffit-test] FAIL ${e.message}`))
            .finally(() => console.log('[soffit-test] DONE'));
    }

    disable() {}

    async _run() {
        const soffit = await waitFor('soffit', () => Main.extensionManager.lookup(SOFFIT)?.stateObj?._runner);
        check('soffit enabled', !!soffit);
        const ext = Main.extensionManager.lookup(SOFFIT).stateObj;

        const editor = await waitFor('editor window', () =>
            global.display.list_all_windows().find(w => w.get_wm_class() === EDITOR_CLASS));
        Main.activateWindow(editor);
        await waitFor('editor focus', () => global.display.focus_window === editor);

        // A definition for the editor, added at runtime so the repo's
        // menus/ stay real-world only.
        ext._definitions.push({
            source: 'smoke-test',
            name: 'Text Editor',
            match: {wmClass: [EDITOR_CLASS]},
            menus: [{label: 'Edit', items: [
                {label: 'Type Text', action: {type: 'text', text: 'Soffit'}},
                {label: 'Select All', action: {type: 'keys', keys: 'ctrl+a'}},
                {label: 'Type With Shortcut', action: {type: 'macro', steps: [
                    {type: 'keys', keys: 'ctrl+a'},
                    {type: 'text', text: 'Macro ok'},
                ]}},
            ]}],
        });
        ext._window = null;
        ext._onFocusChanged();

        const labels = ext._buttons.map(b => b.get_first_child()?.text);
        check('bar shows app + menus', labels.join(',') === 'Text Editor,Edit,Window', labels.join(','));

        const titleBefore = editor.get_title();
        await clickItem(ext, 'Edit', 'Type Text');
        await sleep(1200);
        const titleAfter = editor.get_title();
        check('text action reached the editor', titleAfter !== titleBefore,
            `title "${titleBefore}" -> "${titleAfter}"`);
        check('focus back on editor after menu', global.display.focus_window === editor);

        await clickItem(ext, 'Edit', 'Type With Shortcut');
        await sleep(1500);
        check('macro action ran', editor.get_title() !== titleAfter, `title -> "${editor.get_title()}"`);

        await clickItem(ext, 'Window', 'Minimize');
        await sleep(800);
        check('window action minimized the editor', editor.minimized);
    }
}
