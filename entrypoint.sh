#!/bin/sh
# Copy the mounted SSH key and fix permissions
if [ -f /tmp/ssh_key ]; then
  cp /tmp/ssh_key /app/.ssh/id_ed25519
  chmod 600 /app/.ssh/id_ed25519
  echo SSH key copied successfully
else
  echo WARNING: No SSH key found at /tmp/ssh_key
fi

exec " $@\
