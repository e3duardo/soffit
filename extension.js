// Soffit: a macOS-style global menu bar for GNOME Shell.
//
// The focused window is resolved to an app, the app to a menu definition
// (menus/*.json), and the definition is rendered as buttons on the left of
// the top bar: the app name in bold, then one button per top-level menu.
// Apps without a definition still get the built-in app and Window menus.

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ActionRunner} from './actions.js';
import {findDefinition, loadMenuDefinitions} from './menus.js';

const WINDOW_MENU = {
    label: 'Window',
    items: [
        {label: 'Minimize', action: {type: 'window', op: 'minimize'}},
        {label: 'Zoom', action: {type: 'window', op: 'maximize'}},
        {label: 'Enter Full Screen', action: {type: 'window', op: 'fullscreen'}},
        {separator: true},
        {label: 'Close Window', action: {type: 'window', op: 'close'}},
    ],
};

function appMenuFor(appName) {
    return {
        label: appName,
        bold: true,
        items: [
            {label: `Close ${appName}`, action: {type: 'window', op: 'close'}},
        ],
    };
}

export default class SoffitExtension extends Extension {
    enable() {
        this._definitions = loadMenuDefinitions(this.dir.get_child('menus'));
        this._runner = new ActionRunner();
        this._buttons = [];
        this._window = null;

        this._focusId = global.display.connect('notify::focus-window', () => this._onFocusChanged());
        this._onFocusChanged();
    }

    disable() {
        global.display.disconnect(this._focusId);
        this._clearButtons();
        this._runner.destroy();
        this._runner = null;
        this._definitions = null;
        this._window = null;
    }

    _onFocusChanged() {
        const window = global.display.focus_window;
        // Opening one of our menus can move focus away from the app; keep
        // the last real window as the target instead of clearing the bar.
        if (!window || window === this._window)
            return;
        this._window = window;

        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const appId = app?.get_id() ?? null;
        const wmClass = window.get_wm_class();
        const appName = app?.get_name() ?? wmClass ?? 'Application';
        const definition = findDefinition(this._definitions, {appId, wmClass});

        console.log(`[soffit] focus: app=${appId} class=${wmClass} pid=${window.get_pid()} ` +
            `definition=${definition?.source ?? 'none'}`);

        const menus = [appMenuFor(definition?.name ?? appName), ...(definition?.menus ?? []), WINDOW_MENU];
        this._render(menus);
    }

    _clearButtons() {
        for (const button of this._buttons)
            button.destroy();
        this._buttons = [];
    }

    _render(menus) {
        this._clearButtons();
        menus.forEach((menu, i) => {
            const button = new PanelMenu.Button(0.0, `soffit-${menu.label}`, false);
            button.add_style_class_name('soffit-button');
            button.add_child(new St.Label({
                text: menu.label,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: menu.bold ? 'soffit-label soffit-app-name' : 'soffit-label',
            }));
            this._fillMenu(button.menu, menu.items ?? []);
            // Right after the Activities button.
            Main.panel.addToStatusArea(`${this.uuid}-${i}`, button, 1 + i, 'left');
            this._buttons.push(button);
        });
    }

    _fillMenu(menu, items) {
        for (const item of items) {
            if (item.separator) {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }
            if (item.items) {
                const sub = new PopupMenu.PopupSubMenuMenuItem(item.label);
                this._fillMenu(sub.menu, item.items);
                menu.addMenuItem(sub);
                continue;
            }
            const menuItem = new PopupMenu.PopupMenuItem(item.label);
            if (item.shortcut) {
                menuItem.add_child(new St.Label({
                    text: item.shortcut,
                    x_expand: true,
                    x_align: Clutter.ActorAlign.END,
                    style_class: 'soffit-shortcut',
                }));
            }
            if (item.action) {
                const window = () => this._window;
                menuItem.connect('activate', () => this._runner.run(item.action, window()));
            } else {
                menuItem.setSensitive(false);
            }
            menu.addMenuItem(menuItem);
        }
    }
}
