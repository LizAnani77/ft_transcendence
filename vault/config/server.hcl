ui            = true
disable_mlock = true

# TTL par défaut
default_lease_ttl = "1h"
max_lease_ttl     = "24h"

storage "raft" {
  path    = "/vault/data"
  node_id = "vault1"
}

listener "tcp" {
  address        = "0.0.0.0:8200"
  tls_disable    = 1
}

# IMPORTANT : schémas doivent matcher le listener
api_addr     = "http://vault:8200"
cluster_addr = "http://vault:8201"

# Audit (ok) -> prévois le volume /vault/logs
audit {
  type = "file"
  path = "/vault/logs/audit.log"
}
