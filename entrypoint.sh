#!/bin/sh
# Copy the mounted SSH key and fix permissions for botuser
if [ -f /tmp/ssh_key ]; then
  cp /tmp/ssh_key /app/.ssh/id_ed25519
  chmod 600 /app/.ssh/id_ed25519
fi

exec "$@"
