# vault/Dockerfile
FROM hashicorp/vault:1.20.2

USER root

RUN mkdir -p /vault/logs && chown -R vault:vault /vault/logs

COPY config/server.hcl /vault/config/

USER vault

EXPOSE 8200

CMD ["server"]
