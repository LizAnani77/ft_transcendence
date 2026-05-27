#!/bin/sh
set -eux

mkdir -p /vault/data /vault/config /vault/logs
chown -R vault:vault /vault/data /vault/config /vault/logs
chmod -R 750 /vault/data /vault/config /vault/logs
