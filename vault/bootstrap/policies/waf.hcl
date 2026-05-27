# /vault/bootstrap/policies/waf.hcl

# Autorise l'émission de certificats via le rôle PKI utilisé par tes templates
path "pki/issue/waf-role" {
  capabilities = ["create", "update"]
}

# (facultatif) lecture de la CA/CRL si tu en as besoin
path "pki/cert/*" {
  capabilities = ["read", "list"]
}
