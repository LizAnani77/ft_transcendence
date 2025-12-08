vault {
  address = "http://vault:8200"
}

pid_file = "/tmp/vault-agent.pid"

listener "tcp" {
  address     = "127.0.0.1:8201"
  tls_disable = true
}

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path   = "/bootstrap/waf-role-id"
      secret_id_file_path = "/bootstrap/waf-secret-id"
      remove_secret_id_file_after_reading = false
    }
  }
}

cache {
  use_auto_auth_token = true
  min_secret_ttl      = "10s"
}

template {
  source      = "/config/templates/tls.crt.ctmpl"
  destination = "/secrets/tls.crt"
  perms       = "0644"
  command     = "sh -lc 'test -f /run/nginx.pid && kill -HUP $(cat /run/nginx.pid) || true'"
}

template {
  source      = "/config/templates/tls.key.ctmpl"
  destination = "/secrets/tls.key"
  perms       = "0600"
  command     = "sh -lc 'test -f /run/nginx.pid && kill -HUP $(cat /run/nginx.pid) || true'"
}
