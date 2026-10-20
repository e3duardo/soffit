// Loading menu definitions from menus/*.json and picking the one for a
// window. See README.md for the file format.

import Gio from 'gi://Gio';

const decoder = new TextDecoder();

export function loadMenuDefinitions(dir) {
    const definitions = [];
    let enumerator;
    try {
        enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
        console.error(`[soffit] cannot read ${dir.get_path()}: ${e.message}`);
        return definitions;
    }

    for (const info of enumerator) {
        const name = info.get_name();
        if (!name.endsWith('.json'))
            continue;
        const file = dir.get_child(name);
        try {
            const [, bytes] = file.load_contents(null);
            const definition = JSON.parse(decoder.decode(bytes));
            definition.source = name;
            definitions.push(definition);
        } catch (e) {
            console.error(`[soffit] skipping ${name}: ${e.message}`);
        }
    }
    console.log(`[soffit] loaded ${definitions.length} menu definition(s)`);
    return definitions;
}

// `appId` is the .desktop id (e.g. "code.desktop"), `wmClass` the window
// class (e.g. "Code"). Both are compared case-insensitively.
export function findDefinition(definitions, {appId, wmClass}) {
    const id = (appId ?? '').toLowerCase();
    const cls = (wmClass ?? '').toLowerCase();
    return definitions.find(d => {
        const match = d.match ?? {};
        return (match.appId ?? []).some(a => a.toLowerCase() === id) ||
            (match.wmClass ?? []).some(c => c.toLowerCase() === cls);
    }) ?? null;
}
