#!/bin/sh
# Runs the smoke test in a headless GNOME Shell that is fully isolated from
# the desktop session: its own D-Bus, dconf, runtime dir and extension dir.
#   tests/run-smoke.sh            prints PASS/FAIL lines
#   KEEP=1 tests/run-smoke.sh     keeps the temp dir (shell.log) for debugging
set -u

repo=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
mkdir -p "$tmp/config" "$tmp/data/gnome-shell/extensions" "$tmp/run"
chmod 700 "$tmp/run"
ln -s "$repo" "$tmp/data/gnome-shell/extensions/soffit@e3duardo.github.io"
ln -s "$repo/tests/smoke-test@soffit" "$tmp/data/gnome-shell/extensions/smoke-test@soffit"

cat > "$tmp/session.sh" <<'EOF'
tmp=$1
export XDG_CONFIG_HOME=$tmp/config XDG_DATA_HOME=$tmp/data XDG_RUNTIME_DIR=$tmp/run
unset WAYLAND_DISPLAY DISPLAY
ext="gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions"

gnome-shell --headless --virtual-monitor 1280x800 --wayland --no-x11 > "$tmp/shell.log" 2>&1 &
shell=$!
for _ in $(seq 1 60); do [ -S "$tmp/run/wayland-0" ] && break; sleep 0.25; done
sleep 3
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.freedesktop.DBus.Properties.Set org.gnome.Shell OverviewActive "<false>" > /dev/null

WAYLAND_DISPLAY=wayland-0 GDK_BACKEND=wayland gnome-text-editor --new-window > /dev/null 2>&1 &
sleep 3
# Only the test is enabled through the settings; it enables Soffit itself
# (two EnableExtension calls race on enabled-extensions here and the
# second one drops the first).
$ext.EnableExtension smoke-test@soffit > /dev/null

for _ in $(seq 1 60); do grep -q '\[soffit-test\] DONE' "$tmp/shell.log" && break; sleep 0.5; done
$ext.GetExtensionErrors soffit@e3duardo.github.io
kill $shell
EOF

echo "extension errors (empty is good):"
timeout 90 dbus-run-session -- sh "$tmp/session.sh" "$tmp" 2>/dev/null |
    grep -vE '^(GNOME_KEYRING|SSH_AUTH|SpiRegistry)'
grep -E '\[soffit(-test)?\]|JS ERROR' "$tmp/shell.log"

if [ "${KEEP:-}" ]; then
    echo "logs kept in $tmp"
else
    rm -rf "$tmp"
fi
