#!/bin/sh
# tmux-reach recapture: ONE read-only tmux client on the fleet. Keys typed into this window never reach a session
# (read-only) and the client never resizes the fleet panes (ignore-size).
exec /opt/homebrew/bin/tmux attach -f read-only,ignore-size -t vp-vibepet
