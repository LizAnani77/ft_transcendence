# /vault/bootstrap/policies/backend.hcl

# KV v2: lecture du secret d'app + list sur metadata
path "secret/data/backend/*" {
  capabilities = ["read"]
}
path "secret/metadata/backend/*" {
  capabilities = ["list"]
}
