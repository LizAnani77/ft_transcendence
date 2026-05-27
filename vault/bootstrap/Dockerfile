# /vault/bootstrap/Dockerfile
FROM hashicorp/vault:1.20.2

RUN     apk add --no-cache jq curl

COPY    bootstrap.sh /usr/local/bin/bootstrap.sh
COPY    policies/ /policies/

RUN     chmod 555 /usr/local/bin/bootstrap.sh && \
        chmod 444 /policies/*.hcl

USER    root

ENTRYPOINT ["/bin/sh","-lc","/usr/local/bin/bootstrap.sh"]