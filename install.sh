#!/bin/sh
# Symlinks this checkout into the user's extension directory and enables it.
# On Wayland, log out and back in afterwards so GNOME Shell loads it.
set -eu

uuid=soffit@e3duardo.github.io
src=$(cd "$(dirname "$0")" && pwd)
dest="$HOME/.local/share/gnome-shell/extensions/$uuid"

mkdir -p "$(dirname "$dest")"
if [ -L "$dest" ]; then
    rm "$dest"
elif [ -e "$dest" ]; then
    echo "$dest exists and is not a symlink; remove it first" >&2
    exit 1
fi
ln -s "$src" "$dest"
echo "linked $dest -> $src"

# gnome-extensions enable refuses extensions the running shell hasn't
# loaded yet, so add it to the enabled list directly.
enabled=$(gsettings get org.gnome.shell enabled-extensions)
case "$enabled" in
    *"'$uuid'"*) ;;
    "@as []") gsettings set org.gnome.shell enabled-extensions "['$uuid']" ;;
    *) gsettings set org.gnome.shell enabled-extensions "${enabled%]}, '$uuid']" ;;
esac
echo "enabled $uuid (takes effect at next login on Wayland)"
