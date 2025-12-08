vault {
  address = "http://vault:8200"
}

listener "tcp" {
  address     = "127.0.0.1:8200"
  tls_disable = true
}

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path   = "/bootstrap/role_id"
      secret_id_file_path = "/bootstrap/secret_id"
      remove_secret_id_file_after_reading = false
    }
  }
}

# IMPORTANT pour la rotation/re-render
cache {
  use_auto_auth_token = true
}

template {
  source      = "/config/templates/app.env.ctmpl"
  destination = "/secrets/app.env"
  perms       = "0644"
}
